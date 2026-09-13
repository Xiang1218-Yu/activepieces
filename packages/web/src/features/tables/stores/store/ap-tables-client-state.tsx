import {
  BatchUpdateRecordErrorCode,
  BatchUpdateRecordResult,
  Field,
  FieldType,
  PopulatedRecord,
  Table,
  TableAutomationStatus,
  tableCellValidation,
  TableCellValidationErrorCode,
} from '@activepieces/shared';
import { nanoid } from 'nanoid';
import { create } from 'zustand';

import { createServerState, RecordSaveItem } from './ap-tables-server-state';

export type ClientCellData = {
  fieldIndex: number;
  value: unknown;
};

export type ClientRecordData = {
  uuid: string;
  agentRunId: string | null;
  values: ClientCellData[];
};

export type ClientField = {
  uuid: string;
  name: string;
} & (
  | {
      type:
        | FieldType.DATE
        | FieldType.DATETIME
        | FieldType.NUMBER
        | FieldType.TEXT;
    }
  | {
      type: FieldType.STATIC_DROPDOWN;
      data: {
        options: { value: string }[];
      };
    }
);

const SAVED_FLASH_DURATION_MS = 2500;

const cellStateKey = (recordUuid: string, fieldUuid: string) =>
  `${recordUuid}:${fieldUuid}`;

const normalizeCellValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

const validateClientCell = (
  field: ClientField,
  value: string,
): TableCellValidationErrorCode | null => {
  return tableCellValidation.validate({
    fieldType: field.type,
    value,
    options:
      field.type === FieldType.STATIC_DROPDOWN
        ? field.data.options.map((option) => option.value)
        : undefined,
  });
};

const mapRecorddToClientRecordsData = (
  records: PopulatedRecord[],
  fields: Field[],
): ClientRecordData[] => {
  return records.map((record) => ({
    uuid: nanoid(),
    agentRunId: null,
    values: Object.entries(record.cells).map(([fieldId, cell]) => ({
      fieldIndex: fields.findIndex((field) => field.id === fieldId),
      value: cell.value,
    })),
  }));
};

const buildSavedCells = (
  records: PopulatedRecord[],
  clientRecords: ClientRecordData[],
  clientFields: ClientField[],
  fieldServerIds: Record<string, string>,
): Record<string, SavedCellBaseline> => {
  const savedCells: Record<string, SavedCellBaseline> = {};
  records.forEach((record, recordIndex) => {
    const clientRecord = clientRecords[recordIndex];
    clientFields.forEach((field) => {
      const serverFieldId = fieldServerIds[field.uuid] ?? field.uuid;
      const cell = record.cells[serverFieldId];
      savedCells[cellStateKey(clientRecord.uuid, field.uuid)] = {
        value: normalizeCellValue(cell?.value),
        updated: cell?.updated ?? record.updated,
      };
    });
  });
  return savedCells;
};

const mapRecordErrorToCellError = (
  code: BatchUpdateRecordErrorCode,
): TableCellErrorCode => {
  return code === 'NOT_FOUND' ? 'RECORD_NOT_FOUND' : 'BATCH_FAILED';
};

export const createApTableStore = (
  table: Table,
  fields: Field[],
  records: PopulatedRecord[],
) => {
  return create<TableState>((set, get) => {
    const savedFlashTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

    const scheduleSavedFlashClear = (key: string) => {
      clearTimeout(savedFlashTimeouts.get(key));
      savedFlashTimeouts.set(
        key,
        setTimeout(() => {
          savedFlashTimeouts.delete(key);
          set((state) => {
            if (state.cellStates[key]?.status !== 'saved') {
              return state;
            }
            const cellStates = { ...state.cellStates };
            delete cellStates[key];
            return { cellStates };
          });
        }, SAVED_FLASH_DURATION_MS),
      );
    };

    const initialClientRecords = mapRecorddToClientRecordsData(records, fields);
    const initialFieldServerIds = Object.fromEntries(
      fields.map((field) => [field.id, field.id]),
    );
    const initialClientFields: ClientField[] = fields.map((field) => {
      if (field.type === FieldType.STATIC_DROPDOWN) {
        return {
          uuid: field.id,
          name: field.name,
          type: field.type,
          data: field.data,
        };
      }
      return {
        uuid: field.id,
        name: field.name,
        type: field.type,
      };
    });

    const serverState = createServerState(table, fields, records, {
      onSavingChange: (isSaving: boolean) => set({ isSaving }),
      onRecordCreated: (clientUuid: string, record: PopulatedRecord) =>
        set((state) => {
          const savedCells = { ...state.savedCells };
          state.fields.forEach((field) => {
            const serverFieldId =
              state.fieldServerIds[field.uuid] ?? field.uuid;
            const cell = record.cells[serverFieldId];
            savedCells[cellStateKey(clientUuid, field.uuid)] = {
              value: normalizeCellValue(cell?.value),
              updated: cell?.updated ?? record.updated,
            };
          });
          return { savedCells };
        }),
      onFieldCreated: (clientUuid: string, field: Field) =>
        set((state) => ({
          fieldServerIds: {
            ...state.fieldServerIds,
            [clientUuid]: field.id,
          },
        })),
    });

    const applySaveResults = (
      items: RecordSaveItem[],
      itemKeys: string[][],
      results: BatchUpdateRecordResult[],
    ) => {
      set((state) => {
        const cellStates = { ...state.cellStates };
        const savedCells = { ...state.savedCells };
        results.forEach((result, itemIndex) => {
          const item = items[itemIndex];
          const keys = itemKeys[itemIndex];
          const recordUuid = state.records[item.recordIndex]?.uuid;
          const serverFieldIdFor = (fieldIndex: number) => {
            const fieldUuid = state.fields[fieldIndex]?.uuid;
            return fieldUuid
              ? state.fieldServerIds[fieldUuid] ?? fieldUuid
              : null;
          };
          if (result.status === 'success' && result.record) {
            item.cells.forEach((cell, cellIndex) => {
              const key = keys[cellIndex];
              const serverFieldId = serverFieldIdFor(cell.fieldIndex);
              if (!serverFieldId || !recordUuid) {
                delete cellStates[key];
                return;
              }
              const serverCell = result.record?.cells[serverFieldId];
              const baseline: SavedCellBaseline = {
                value: normalizeCellValue(serverCell?.value),
                updated: serverCell?.updated ?? result.record?.updated ?? null,
              };
              savedCells[key] = baseline;
              const currentValue = normalizeCellValue(
                state.records[item.recordIndex]?.values.find(
                  (value) => value.fieldIndex === cell.fieldIndex,
                )?.value,
              );
              if (currentValue === baseline.value) {
                cellStates[key] = { status: 'saved' };
                scheduleSavedFlashClear(key);
              } else {
                cellStates[key] = { status: 'dirty' };
              }
            });
            return;
          }
          const errorCode = result.error?.code ?? 'INTERNAL';
          if (errorCode === 'CONFLICT' || errorCode === 'VALIDATION') {
            const cellErrors = result.error?.cells ?? [];
            item.cells.forEach((cell, cellIndex) => {
              const key = keys[cellIndex];
              const serverFieldId = serverFieldIdFor(cell.fieldIndex);
              if (!serverFieldId) {
                delete cellStates[key];
                return;
              }
              const cellError = cellErrors.find(
                (error) => error.fieldId === serverFieldId,
              );
              if (!cellError) {
                cellStates[key] = { status: 'dirty' };
                return;
              }
              if (cellError.code === 'CONFLICT' && result.record) {
                const serverCell = result.record.cells[serverFieldId];
                cellStates[key] = {
                  status: 'conflict',
                  serverValue: normalizeCellValue(serverCell?.value),
                  serverUpdated: serverCell?.updated ?? null,
                };
                return;
              }
              cellStates[key] = {
                status: 'error',
                error:
                  cellError.code === 'UNKNOWN_FIELD'
                    ? 'UNKNOWN_FIELD'
                    : cellError.validationError ?? 'BATCH_FAILED',
              };
            });
            return;
          }
          keys.forEach((key) => {
            cellStates[key] = {
              status: 'error',
              error: mapRecordErrorToCellError(errorCode),
            };
          });
        });
        return { cellStates, savedCells };
      });
    };

    const selectedCell =
      records.length > 0
        ? {
            rowIdx: 0,
            columnIdx: 1,
          }
        : null;

    return {
      isSaving: false,
      selectedRecords: new Set(),
      table,
      cellStates: {},
      savedCells: buildSavedCells(
        records,
        initialClientRecords,
        initialClientFields,
        initialFieldServerIds,
      ),
      fieldServerIds: initialFieldServerIds,
      setSelectedRecords: (selectedRecords: ReadonlySet<string>) =>
        set({ selectedRecords }),
      selectedCell: selectedCell,
      selectedAgentRunId: null,
      setSelectedAgentRunId: (agentRunId: string | null) =>
        set({ selectedAgentRunId: agentRunId }),
      renameTable: (newName: string) =>
        set((state) => {
          serverState.update({
            name: newName,
          });
          return {
            table: {
              ...state.table,
              name: newName,
            },
          };
        }),
      setSelectedCell: (
        selectedCell: { rowIdx: number; columnIdx: number } | null,
      ) =>
        set((state) =>
          state.selectedCell?.rowIdx === selectedCell?.rowIdx &&
          state.selectedCell?.columnIdx === selectedCell?.columnIdx
            ? state
            : { selectedCell },
        ),
      fields: initialClientFields,
      records: initialClientRecords,
      createRecord: (recordData: ClientRecordData) => {
        serverState.createRecord(recordData);
        return set((state) => {
          return {
            records: [...state.records, recordData],
          };
        });
      },
      updateRecord: (
        recordIndex: number,
        recordData: Pick<ClientRecordData, 'values'>,
      ) => {
        return set((state) => {
          const record = state.records[recordIndex];
          if (!record) {
            return state;
          }
          const cellStates = { ...state.cellStates };
          const savedCells = { ...state.savedCells };
          recordData.values.forEach((cell) => {
            const field = state.fields[cell.fieldIndex];
            if (!field) {
              return;
            }
            const newValue = normalizeCellValue(cell.value);
            const existingValue = normalizeCellValue(
              record.values.find(
                (value) => value.fieldIndex === cell.fieldIndex,
              )?.value,
            );
            if (existingValue === newValue) {
              return;
            }
            const key = cellStateKey(record.uuid, field.uuid);
            const currentCellState = cellStates[key];
            if (currentCellState?.status === 'conflict') {
              savedCells[key] = {
                value: currentCellState.serverValue ?? '',
                updated: currentCellState.serverUpdated ?? null,
              };
            }
            const baselineValue = savedCells[key]?.value ?? '';
            if (newValue === baselineValue) {
              if (cellStates[key]?.status !== 'saving') {
                delete cellStates[key];
              }
              return;
            }
            const validationError = validateClientCell(field, newValue);
            cellStates[key] = validationError
              ? { status: 'error', error: validationError }
              : { status: 'dirty' };
          });
          return {
            records: state.records.map((record, index) =>
              index === recordIndex ? { ...record, ...recordData } : record,
            ),
            cellStates,
            savedCells,
          };
        });
      },
      savePendingChanges: async () => {
        await serverState.waitForPendingOperations();
        const state = get();
        if (state.lockedByOtherUser) {
          return;
        }
        const collected = state.records.map((record, recordIndex) => {
          const cells: RecordSaveItem['cells'] = [];
          const keys: string[] = [];
          const invalid: {
            key: string;
            error: TableCellValidationErrorCode;
          }[] = [];
          record.values.forEach((cell) => {
            const field = state.fields[cell.fieldIndex];
            if (!field) {
              return;
            }
            const key = cellStateKey(record.uuid, field.uuid);
            const cellState = state.cellStates[key];
            if (
              !cellState ||
              (cellState.status !== 'dirty' && cellState.status !== 'error')
            ) {
              return;
            }
            const value = normalizeCellValue(cell.value);
            const validationError = validateClientCell(field, value);
            if (validationError) {
              invalid.push({ key, error: validationError });
              return;
            }
            cells.push({
              fieldIndex: cell.fieldIndex,
              value,
              baseUpdated: state.savedCells[key]?.updated ?? null,
            });
            keys.push(key);
          });
          return { recordIndex, cells, keys, invalid };
        });
        const saveable = collected.filter((entry) => entry.cells.length > 0);
        const items: RecordSaveItem[] = saveable.map((entry) => ({
          recordIndex: entry.recordIndex,
          cells: entry.cells,
        }));
        const itemKeys = saveable.map((entry) => entry.keys);
        const invalidEntries = collected.flatMap((entry) => entry.invalid);
        set((currentState) => {
          const cellStates = { ...currentState.cellStates };
          invalidEntries.forEach(({ key, error }) => {
            cellStates[key] = { status: 'error', error };
          });
          itemKeys.flat().forEach((key) => {
            cellStates[key] = { status: 'saving' };
          });
          return { cellStates };
        });
        if (items.length === 0) {
          return;
        }
        try {
          const response = await serverState.saveRecords(items);
          applySaveResults(items, itemKeys, response.results);
        } catch {
          set((currentState) => {
            const cellStates = { ...currentState.cellStates };
            itemKeys.flat().forEach((key) => {
              if (cellStates[key]?.status === 'saving') {
                cellStates[key] = { status: 'error', error: 'BATCH_FAILED' };
              }
            });
            return { cellStates };
          });
        }
      },
      discardChanges: () => {
        set((state) => {
          const savedCells = { ...state.savedCells };
          const records = state.records.map((record) => ({
            ...record,
            values: record.values.map((cell) => {
              const field = state.fields[cell.fieldIndex];
              if (!field) {
                return cell;
              }
              const key = cellStateKey(record.uuid, field.uuid);
              const cellState = state.cellStates[key];
              if (
                !cellState ||
                cellState.status === 'saved' ||
                cellState.status === 'saving'
              ) {
                return cell;
              }
              if (cellState.status === 'conflict') {
                const serverValue = cellState.serverValue ?? '';
                savedCells[key] = {
                  value: serverValue,
                  updated: cellState.serverUpdated ?? null,
                };
                return { ...cell, value: serverValue };
              }
              const baseline = state.savedCells[key];
              return baseline ? { ...cell, value: baseline.value } : cell;
            }),
          }));
          const cellStates = Object.fromEntries(
            Object.entries(state.cellStates).filter(
              ([, cellState]) => cellState.status === 'saving',
            ),
          );
          return { records, cellStates, savedCells };
        });
      },
      resolveConflict: ({ recordUuid, fieldUuid, strategy }) => {
        set((state) => {
          const key = cellStateKey(recordUuid, fieldUuid);
          const cellState = state.cellStates[key];
          if (cellState?.status !== 'conflict') {
            return state;
          }
          const serverValue = cellState.serverValue ?? '';
          const savedCells = {
            ...state.savedCells,
            [key]: {
              value: serverValue,
              updated: cellState.serverUpdated ?? null,
            },
          };
          if (strategy === 'useServer') {
            const cellStates = { ...state.cellStates };
            delete cellStates[key];
            return {
              savedCells,
              cellStates,
              records: state.records.map((record) =>
                record.uuid !== recordUuid
                  ? record
                  : {
                      ...record,
                      values: record.values.map((cell) => {
                        const field = state.fields[cell.fieldIndex];
                        return field?.uuid === fieldUuid
                          ? { ...cell, value: serverValue }
                          : cell;
                      }),
                    },
              ),
            };
          }
          return {
            savedCells,
            cellStates: {
              ...state.cellStates,
              [key]: { status: 'dirty' },
            },
          };
        });
      },
      deleteRecords: (recordIndices: string[]) =>
        set((state) => {
          serverState.deleteRecords(recordIndices);
          const indices = new Set(
            recordIndices.map((index) => parseInt(index)),
          );
          const deletedUuids = new Set(
            state.records
              .filter((_, index) => indices.has(index))
              .map((record) => record.uuid),
          );
          const keepEntry = ([key]: [string, unknown]) =>
            !deletedUuids.has(key.split(':')[0]);
          return {
            records: state.records.filter((_, index) => !indices.has(index)),
            cellStates: Object.fromEntries(
              Object.entries(state.cellStates).filter(keepEntry),
            ),
            savedCells: Object.fromEntries(
              Object.entries(state.savedCells).filter(keepEntry),
            ),
          };
        }),
      createField: (field: ClientField) => {
        serverState.createField({ ...field, tableId: table.id }, field.uuid);
        set((state) => {
          const savedCells = { ...state.savedCells };
          state.records.forEach((record) => {
            savedCells[cellStateKey(record.uuid, field.uuid)] = {
              value: '',
              updated: null,
            };
          });
          return {
            fields: [...state.fields, field],
            records: state.records.map((record) => ({
              ...record,
              values: [
                ...record.values,
                {
                  fieldIndex: state.fields.length,
                  value: '',
                },
              ],
            })),
            savedCells,
          };
        });
      },
      deleteField: (fieldIndex: number) => {
        serverState.deleteField(fieldIndex);
        return set((state) => {
          const field = state.fields[fieldIndex];
          const cellStates = { ...state.cellStates };
          const savedCells = { ...state.savedCells };
          const fieldServerIds = { ...state.fieldServerIds };
          if (field) {
            state.records.forEach((record) => {
              delete cellStates[cellStateKey(record.uuid, field.uuid)];
              delete savedCells[cellStateKey(record.uuid, field.uuid)];
            });
            delete fieldServerIds[field.uuid];
          }
          return {
            records: state.records.map((record) => ({
              ...record,
              values: record.values.filter((_, index) => index !== fieldIndex),
            })),
            fields: state.fields.filter((_, index) => index !== fieldIndex),
            cellStates,
            savedCells,
            fieldServerIds,
          };
        });
      },
      renameField: (fieldIndex: number, newName: string) => {
        serverState.renameField(fieldIndex, newName);
        return set((state) => {
          return {
            fields: state.fields.map((field, index) =>
              index === fieldIndex ? { ...field, name: newName } : field,
            ),
          };
        });
      },
      reorderField: (fieldIndex: number, targetIndex: number) => {
        if (fieldIndex === targetIndex) {
          return;
        }
        serverState.reorderField(fieldIndex, targetIndex);
        return set((state) => {
          const reorderedFields = [...state.fields];
          const [movedField] = reorderedFields.splice(fieldIndex, 1);
          reorderedFields.splice(targetIndex, 0, movedField);
          const newIndexByUuid = new Map(
            reorderedFields.map((field, index) => [field.uuid, index]),
          );
          const oldToNewIndex = state.fields.map(
            (field) => newIndexByUuid.get(field.uuid) ?? 0,
          );
          return {
            fields: reorderedFields,
            records: state.records.map((record) => ({
              ...record,
              values: record.values
                .map((cell) => ({
                  ...cell,
                  fieldIndex: oldToNewIndex[cell.fieldIndex],
                }))
                .sort((a, b) => a.fieldIndex - b.fieldIndex),
            })),
          };
        });
      },
      setRecords: (records: PopulatedRecord[]) => {
        serverState.setRecords(records);
        return set((state) => {
          const clientRecords = mapRecorddToClientRecordsData(
            records,
            serverState.fields,
          );
          return {
            records: clientRecords,
            cellStates: {},
            savedCells: buildSavedCells(
              records,
              clientRecords,
              state.fields,
              state.fieldServerIds,
            ),
          };
        });
      },
      setAgentRunId: (recordId: string, agentRunId: string | null) => {
        const recordIndex = serverState.records.findIndex(
          (record) => record.id === recordId,
        );
        set((state) => ({
          records: state.records.map((record, index) =>
            index === recordIndex ? { ...record, agentRunId } : record,
          ),
        }));
      },
      toggleStatus: () => {
        return set((state) => {
          const newStatus =
            state.table.status === TableAutomationStatus.ENABLED
              ? TableAutomationStatus.DISABLED
              : TableAutomationStatus.ENABLED;
          serverState.update({
            status: newStatus,
          });
          return {
            table: {
              ...state.table,
              status: newStatus,
            },
          };
        });
      },
      lockedByOtherUser: false,
      setLockedByOtherUser: (locked: boolean) =>
        set({ lockedByOtherUser: locked }),
      serverFields: serverState.fields,
      serverRecords: serverState.records,
    };
  });
};

export const tableCellStateUtils = {
  cellStateKey,
  hasUnsavedChanges: (cellStates: Record<string, TableCellState>): boolean =>
    Object.values(cellStates).some((cellState) => cellState.status !== 'saved'),
  pendingChangesCount: (cellStates: Record<string, TableCellState>): number =>
    Object.values(cellStates).filter(
      (cellState) =>
        cellState.status === 'dirty' ||
        cellState.status === 'error' ||
        cellState.status === 'conflict',
    ).length,
};

export type TableCellSaveStatus =
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

export type TableCellErrorCode =
  | TableCellValidationErrorCode
  | 'UNKNOWN_FIELD'
  | 'BATCH_FAILED'
  | 'RECORD_NOT_FOUND';

export type TableCellState = {
  status: TableCellSaveStatus;
  error?: TableCellErrorCode;
  serverValue?: string | null;
  serverUpdated?: string | null;
};

export type SavedCellBaseline = {
  value: string;
  updated: string | null;
};

export type TableState = {
  isSaving: boolean;
  selectedRecords: ReadonlySet<string>;
  fields: ClientField[];
  records: ClientRecordData[];
  table: Table;
  cellStates: Record<string, TableCellState>;
  savedCells: Record<string, SavedCellBaseline>;
  fieldServerIds: Record<string, string>;
  setSelectedRecords: (selectedRecords: ReadonlySet<string>) => void;
  selectedCell: {
    rowIdx: number;
    columnIdx: number;
  } | null;
  setSelectedCell: (
    selectedCell: { rowIdx: number; columnIdx: number } | null,
  ) => void;
  selectedAgentRunId: string | null;
  setSelectedAgentRunId: (agentRunId: string | null) => void;
  createRecord: (recordData: ClientRecordData) => void;
  updateRecord: (
    recordIndex: number,
    recordData: Pick<ClientRecordData, 'values'>,
  ) => void;
  savePendingChanges: () => Promise<void>;
  discardChanges: () => void;
  resolveConflict: (params: {
    recordUuid: string;
    fieldUuid: string;
    strategy: 'useServer' | 'keepMine';
  }) => void;
  deleteRecords: (recordIndices: string[]) => void;
  createField: (field: ClientField) => void;
  deleteField: (fieldIndex: number) => void;
  renameTable: (newName: string) => void;
  renameField: (fieldIndex: number, newName: string) => void;
  reorderField: (fieldIndex: number, targetIndex: number) => void;
  setRecords: (records: PopulatedRecord[]) => void;
  setAgentRunId: (recordId: string, agentRunId: string | null) => void;
  toggleStatus: () => void;
  lockedByOtherUser: boolean;
  setLockedByOtherUser: (locked: boolean) => void;
  serverFields: Field[];
  serverRecords: PopulatedRecord[];
};

export type ApTableStore = ReturnType<typeof createApTableStore>;
