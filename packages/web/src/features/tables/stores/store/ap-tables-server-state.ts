import {
  BatchUpdateRecordsResponse,
  CreateFieldRequest,
  Field,
  PopulatedRecord,
  Table,
  UpdateTableRequest,
} from '@activepieces/shared';

import { PromiseQueue } from '@/lib/promise-queue';

import { fieldsApi } from '../../api/fields-api';
import { recordsApi } from '../../api/records-api';
import { tablesApi } from '../../api/tables-api';

import { ClientRecordData } from './ap-tables-client-state';

export type TableServerStateEvents = {
  onSavingChange: (isSaving: boolean) => void;
  onRecordCreated: (clientUuid: string, record: PopulatedRecord) => void;
  onFieldCreated: (clientUuid: string, field: Field) => void;
};

export type RecordSaveItem = {
  recordIndex: number;
  cells: {
    fieldIndex: number;
    value: string;
    baseUpdated: string | null;
  }[];
};

export const createServerState = (
  _table: Table,
  _fields: Field[],
  _records: PopulatedRecord[],
  events: TableServerStateEvents,
) => {
  const queue = new PromiseQueue();

  const clonedTable: Table = JSON.parse(JSON.stringify(_table));
  const clonedFields: Field[] = JSON.parse(JSON.stringify(_fields));
  let clonedRecords: PopulatedRecord[] = JSON.parse(JSON.stringify(_records));

  function addPromiseToQueue(promise: () => Promise<void>) {
    queue.add(async () => {
      events.onSavingChange(true);
      await promise();
      events.onSavingChange(queue.size() === 1);
    });
  }
  return {
    deleteField: (fieldIndex: number) => {
      addPromiseToQueue(async () => {
        const fieldId = clonedFields[fieldIndex].id;
        await fieldsApi.delete(clonedFields[fieldIndex].id);
        clonedFields.splice(fieldIndex, 1);
        clonedRecords = clonedRecords.map((record) => {
          return {
            ...record,
            cells: Object.fromEntries(
              Object.entries(record.cells).filter(([key]) => key !== fieldId),
            ),
          };
        });
      });
    },
    createField: (field: CreateFieldRequest, clientUuid: string) => {
      addPromiseToQueue(async () => {
        const serverField = await fieldsApi.create({ ...field });
        clonedFields.push(serverField);
        events.onFieldCreated(clientUuid, serverField);
      });
    },
    createRecord: (record: ClientRecordData) => {
      addPromiseToQueue(async () => {
        const createdRecords = await recordsApi.create({
          tableId: clonedTable.id,
          records: [
            record.values.map((value) => ({
              fieldId: clonedFields[value.fieldIndex].id,
              value: String(value.value),
            })),
          ],
        });

        if (createdRecords.length > 0) {
          clonedRecords.push(...createdRecords);
          events.onRecordCreated(record.uuid, createdRecords[0]);
        }

        events.onSavingChange(queue.size() === 1);
      });
    },
    saveRecords: async (
      items: RecordSaveItem[],
    ): Promise<BatchUpdateRecordsResponse> => {
      events.onSavingChange(true);
      try {
        const response = await queue.addAndWait(async () => {
          const results: BatchUpdateRecordsResponse['results'] = new Array(
            items.length,
          );
          const requestItems: {
            item: RecordSaveItem;
            resultIndex: number;
            recordId: string;
            cells: {
              fieldId: string;
              value: string;
              baseUpdated?: string;
            }[];
          }[] = [];
          items.forEach((item, resultIndex) => {
            const record = clonedRecords[item.recordIndex];
            if (!record) {
              results[resultIndex] = {
                recordId: '',
                status: 'error',
                error: { code: 'NOT_FOUND' },
              };
              return;
            }
            const cells: (typeof requestItems)[number]['cells'] = [];
            const unknownFieldCells: { fieldId: string }[] = [];
            item.cells.forEach((cell) => {
              const field = clonedFields[cell.fieldIndex];
              if (!field) {
                unknownFieldCells.push({ fieldId: '' });
              } else {
                cells.push({
                  fieldId: field.id,
                  value: cell.value,
                  ...(cell.baseUpdated
                    ? { baseUpdated: cell.baseUpdated }
                    : {}),
                });
              }
            });
            if (unknownFieldCells.length > 0) {
              results[resultIndex] = {
                recordId: record.id,
                status: 'error',
                error: {
                  code: 'VALIDATION',
                  cells: unknownFieldCells.map((cell) => ({
                    fieldId: cell.fieldId,
                    code: 'UNKNOWN_FIELD',
                  })),
                },
              };
              return;
            }
            requestItems.push({
              item,
              resultIndex,
              recordId: record.id,
              cells,
            });
          });
          if (requestItems.length > 0) {
            const batchResponse = await recordsApi.batchUpdate({
              tableId: clonedTable.id,
              records: requestItems.map(({ recordId, cells }) => ({
                recordId,
                cells,
              })),
            });
            batchResponse.results.forEach((result, index) => {
              const { item, resultIndex } = requestItems[index];
              if (result.status === 'success' && result.record) {
                clonedRecords[item.recordIndex] = result.record;
              }
              results[resultIndex] = result;
            });
          }
          return { results };
        });
        return response;
      } finally {
        events.onSavingChange(false);
      }
    },
    waitForPendingOperations: (): Promise<void> => {
      return queue.addAndWait(async () => {});
    },
    deleteRecords: (recordIndices: string[]) => {
      addPromiseToQueue(async () => {
        const recordIds = recordIndices.map(
          (index) => clonedRecords[parseInt(index)].id,
        );
        await recordsApi.delete({
          tableId: clonedTable.id,
          ids: recordIds,
        });

        const sortedIndices = recordIndices
          .map((index) => parseInt(index))
          .sort((a, b) => b - a);

        for (const index of sortedIndices) {
          clonedRecords.splice(index, 1);
        }
      });
    },
    renameField: (fieldIndex: number, newName: string) => {
      addPromiseToQueue(async () => {
        clonedFields[fieldIndex].name = newName;
        await fieldsApi.update(clonedFields[fieldIndex].id, {
          name: newName,
        });
      });
    },
    reorderField: (fieldIndex: number, targetIndex: number) => {
      addPromiseToQueue(async () => {
        const [movedField] = clonedFields.splice(fieldIndex, 1);
        clonedFields.splice(targetIndex, 0, movedField);
        await fieldsApi.reorder({
          tableId: clonedTable.id,
          fieldIds: clonedFields.map((field) => field.id),
        });
      });
    },
    update: async (request: UpdateTableRequest) => {
      addPromiseToQueue(async () => {
        const updatedTable = await tablesApi.update(clonedTable.id, request);
        clonedTable.status = updatedTable.status;
      });
    },
    setRecords: (records: PopulatedRecord[]) => {
      clonedRecords = JSON.parse(JSON.stringify(records));
    },
    fields: clonedFields,
    records: clonedRecords,
  };
};
