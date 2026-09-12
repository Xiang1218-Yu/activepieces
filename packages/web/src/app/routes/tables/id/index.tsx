import { Permission } from '@activepieces/core-utils';
import { ApFlagId } from '@activepieces/shared';
import { nanoid } from 'nanoid';
import { useRef, useEffect } from 'react';
import DataGrid, { DataGridHandle } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { useNavigate } from 'react-router-dom';

import { useTheme } from '@/components/providers/theme-provider';
import {
  ApTableFooter,
  ApTableHeader,
  useTableState,
  useTableLock,
  useTableColumns,
  useTableView,
  mapRecordsToRows,
  Row,
  ROW_HEIGHT_MAP,
  RowHeight,
  TableViewsBar,
  tableViewUtils,
} from '@/features/tables';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { flagsHooks } from '@/hooks/flags-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';

import './react-data-grid.css';

const ApTableEditorPage = () => {
  const navigate = useNavigate();
  const projectId = authenticationSession.getProjectId();
  const [
    selectedRecords,
    setSelectedRecords,
    selectedCell,
    setSelectedCell,
    createRecord,
    fields,
    records,
    setLockedByOtherUser,
    reorderField,
  ] = useTableState((state) => [
    state.selectedRecords,
    state.setSelectedRecords,
    state.selectedCell,
    state.setSelectedCell,
    state.createRecord,
    state.fields,
    state.records,
    state.setLockedByOtherUser,
    state.reorderField,
  ]);

  // the lock lives in the table state provider, above the take-over refresh
  // remount boundary, so refreshing never releases the just-acquired lock
  const { lockedBy, takeOver } = useTableLock();
  const { config, updateConfig } = useTableView();

  useEffect(() => {
    setLockedByOtherUser(!!lockedBy);
  }, [lockedBy, setLockedByOtherUser]);

  const gridRef = useRef<DataGridHandle>(null);
  const { theme } = useTheme();
  const { data: maxRecords } = flagsHooks.useFlag<number>(
    ApFlagId.MAX_RECORDS_PER_TABLE,
  );
  const userHasTableWritePermission = useAuthorization().checkAccess(
    Permission.WRITE_TABLE,
  );
  const canEdit = userHasTableWritePermission && !lockedBy;
  const isAllowedToCreateRecord =
    canEdit && maxRecords && records.length < maxRecords;

  const createEmptyRecord = () => {
    createRecord({
      uuid: nanoid(),
      agentRunId: null,
      values: [],
    });
    const nextRowCount = records.length + 1;
    const nextPage = Math.max(
      1,
      Math.ceil(nextRowCount / config.pagination.pageSize),
    );
    const nextRowIndex = nextRowCount - 1 - (nextPage - 1) * config.pagination.pageSize;
    updateConfig((currentConfig) => ({
      ...currentConfig,
      pagination: {
        ...currentConfig.pagination,
        page: nextPage,
      },
    }));
    requestAnimationFrame(() => {
      gridRef.current?.scrollToCell({
        rowIdx: nextRowIndex,
        idx: 0,
      });
      setSelectedCell({
        rowIdx: nextRowIndex,
        columnIdx: 1,
      });
    });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        selectedCell &&
        !(event.target instanceof Element) ||
        !(event.target.closest(
          `#editable-cell-${selectedCell.rowIdx}-${selectedCell.columnIdx}`,
        ))
      ) {
        setSelectedCell(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [selectedCell]);

  const columns = useTableColumns(createEmptyRecord);
  const allRows = mapRecordsToRows(records, fields);
  const viewRows = tableViewUtils.applyTableView({
    records: allRows,
    fields: fields.map((field) => ({
      id: field.uuid,
      name: field.name,
      type: field.type,
    })),
    config,
  });
  const rows = tableViewUtils.getPagedRecords(viewRows, config);

  const handleColumnsReorder = (sourceKey: string, targetKey: string) => {
    const sourceIndex = fields.findIndex((field) => field.uuid === sourceKey);
    const targetIndex = fields.findIndex((field) => field.uuid === targetKey);
    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }
    reorderField(sourceIndex, targetIndex);
  };

  const handleBack = () => {
    navigate(`/projects/${projectId}/automations`);
  };

  return (
    <div className="w-full flex flex-col justify-start items-start h-full">
      <div className="flex items-center justify-between w-full pr-4 border-b">
        <ApTableHeader
          onBack={handleBack}
          lockedBy={lockedBy}
          takeOver={takeOver}
        />
      </div>

      <div className="flex w-full flex-col flex-1 min-h-0">
        <TableViewsBar />
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 min-h-0">
            <DataGrid
              ref={gridRef}
              columns={columns}
              rows={rows}
              rowKeyGetter={(row: Row) => row.id}
              selectedRows={selectedRecords}
              onSelectedRowsChange={setSelectedRecords}
              onColumnsReorder={handleColumnsReorder}
              className={cn(
                'scroll-smooth w-full !h-full bg-muted/30 !border-0',
                theme === 'dark' ? 'rdg-dark' : 'rdg-light',
              )}
              bottomSummaryRows={canEdit ? [{ id: 'new-record' }] : []}
              rowHeight={ROW_HEIGHT_MAP[RowHeight.DEFAULT]}
              headerRowHeight={ROW_HEIGHT_MAP[RowHeight.DEFAULT]}
              summaryRowHeight={
                isAllowedToCreateRecord ? ROW_HEIGHT_MAP[RowHeight.DEFAULT] : 0
              }
            />
          </div>
          <ApTableFooter
            fieldsCount={fields.length}
            recordsCount={records.length}
          />
        </div>
      </div>
    </div>
  );
};

ApTableEditorPage.displayName = 'ApTableEditorPage';

export { ApTableEditorPage };
