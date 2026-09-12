import { isNil } from '@activepieces/core-utils';
import {
  Field,
  PopulatedRecord,
  Table,
  TableView,
  TableViewCondition,
  TableViewConditionIssue,
  TableViewConfig,
} from '@activepieces/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { t } from 'i18next';
import { FileX } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from 'zustand';

import { RouteLoadingBar } from '@/components/custom/route-loading-bar';
import { buttonVariants } from '@/components/ui/button';
import {
  TableState,
  ApTableStore,
  createApTableStore,
} from '@/features/tables/stores/store/ap-tables-client-state';
import { useResourceLock } from '@/hooks/use-resource-lock';
import { cn } from '@/lib/utils';

import { fieldsApi } from '../api/fields-api';
import { recordsApi } from '../api/records-api';
import { tableViewsApi } from '../api/table-views-api';
import { tablesApi } from '../api/tables-api';
import { tableViewUtils } from '../utils/table-view-utils';

const TableContext = createContext<ApTableStore | null>(null);
const TableRefreshContext = createContext<(() => Promise<void>) | null>(null);
const TableLockContext = createContext<TableLockContextValue | null>(null);
const TableViewContext = createContext<TableViewContextValue | null>(null);

export const DEFAULT_TABLE_VIEW_NAME = 'Default view';

export const TableStateProviderWithTable = ({
  children,
  table,
  fields,
  records,
}: {
  children: React.ReactNode;
  table: Table;
  fields: Field[];
  records: PopulatedRecord[];
}) => {
  const tableStoreRef = useRef<ApTableStore>(
    createApTableStore(table, fields, records),
  );
  return (
    <TableContext.Provider value={tableStoreRef.current}>
      <TableViewProvider table={table} fields={fields}>
        {children}
      </TableViewProvider>
    </TableContext.Provider>
  );
};

function TableViewProvider({
  table,
  fields,
  children,
}: {
  table: Table;
  fields: Field[];
  children: React.ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const viewId = searchParams.get('viewId');
  const queryKey = ['table-views', table.id];

  const { data: views = [] } = useQuery({
    queryKey,
    queryFn: () => tableViewsApi.list({ tableId: table.id }),
    staleTime: 0,
    gcTime: 0,
  });

  const selectedView = useMemo(
    () => views.find((view) => view.id === viewId) ?? null,
    [viewId, views],
  );
  const [draftConfig, setDraftConfig] = useState<TableViewConfig | null>(null);
  const [draftName, setDraftName] = useState('');
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraftConfig(
      selectedView
        ? JSON.parse(JSON.stringify(selectedView.config))
        : tableViewUtils.defaultTableViewConfig(),
    );
    setDraftName(selectedView?.name ?? DEFAULT_TABLE_VIEW_NAME);
    setConflictMessage(null);
  }, [selectedView, viewId]);

  const refreshViews = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const createViewMutation = useMutation({
    mutationFn: async (name: string) => {
      const config = draftConfig ?? tableViewUtils.defaultTableViewConfig();
      return tableViewsApi.create({
        projectId: table.projectId,
        tableId: table.id,
        name,
        config,
      });
    },
    onSuccess: async (view) => {
      await refreshViews();
      setSearchParams({ viewId: view.id });
    },
  });

  const saveViewMutation = useMutation({
    mutationFn: async (name?: string) => {
      if (!selectedView || !draftConfig) {
        return null;
      }
      return tableViewsApi.update(selectedView.id, {
        projectId: table.projectId,
        name: name ?? draftName,
        config: draftConfig,
        expectedVersion: selectedView.version,
      });
    },
    onSuccess: async (view) => {
      if (view) {
        queryClient.setQueryData(queryKey, (currentViews: TableView[] = []) =>
          currentViews.map((currentView) =>
            currentView.id === view.id ? view : currentView,
          ),
        );
        setDraftName(view.name);
      }
      setConflictMessage(null);
    },
    onError: (error: AxiosError) => {
      if (error.response?.status === 409) {
        setConflictMessage(t('This view changed in another session. Reload the latest version before saving.'));
      }
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (id: string) => tableViewsApi.delete(id),
    onSuccess: async (_, id) => {
      queryClient.setQueryData(queryKey, (currentViews: TableView[] = []) =>
        currentViews.filter((view) => view.id !== id),
      );
      if (id === viewId) {
        setSearchParams({});
      }
    },
  });

  const updateConfig = useCallback((updater: (config: TableViewConfig) => TableViewConfig) => {
    setDraftConfig((currentConfig) =>
      currentConfig ? updater(currentConfig) : currentConfig,
    );
    setConflictMessage(null);
  }, []);

  const selectView = useCallback(
    (nextViewId: string | null) => {
      setSearchParams(nextViewId ? { viewId: nextViewId } : {});
    },
    [setSearchParams],
  );

  const reloadView = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    setConflictMessage(null);
  }, [queryClient, queryKey]);

  const config = draftConfig ?? tableViewUtils.defaultTableViewConfig();
  const savedConfig = selectedView?.config ?? tableViewUtils.defaultTableViewConfig();
  const isDirty =
    !!selectedView &&
    (JSON.stringify(config) !== JSON.stringify(savedConfig) ||
      draftName !== selectedView.name);
  const invalidConditions = useMemo(() => config.filters.flatMap((condition) => {
    const field = fields.find((item) => item.id === condition.fieldId);
    if (!field) {
      return [{ condition, issue: TableViewConditionIssue.FIELD_DELETED }];
    }
    if (field.type !== condition.fieldType) {
      return [{ condition, issue: TableViewConditionIssue.FIELD_TYPE_CHANGED }];
    }
    return [];
  }), [config.filters, fields]);

  const value = useMemo<TableViewContextValue>(
    () => ({
      views,
      selectedView,
      config,
      draftName,
      isDirty,
      isSaving: saveViewMutation.isPending,
      conflictMessage,
      invalidConditions,
      setDraftName,
      updateConfig,
      selectView,
      createView: (name: string) => createViewMutation.mutateAsync(name),
      saveView: (name?: string) => saveViewMutation.mutateAsync(name),
      deleteView: (id: string) => deleteViewMutation.mutateAsync(id),
      reloadView,
    }),
    [
      views,
      selectedView,
      config,
      draftName,
      isDirty,
      saveViewMutation.isPending,
      conflictMessage,
      invalidConditions,
      updateConfig,
      selectView,
      createViewMutation,
      saveViewMutation,
      deleteViewMutation,
      reloadView,
    ],
  );

  return <TableViewContext.Provider value={value}>{children}</TableViewContext.Provider>;
}

export function ApTableStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const tableId = useParams().tableId;
  const queryClient = useQueryClient();
  const [refreshKey, setRefreshKey] = useState(0);
  const {
    data: table,
    isLoading: isTableLoading,
    error: tableError,
  } = useQuery({
    queryKey: ['table', tableId],
    queryFn: () => {
      return tablesApi.getById(tableId!);
    },
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0,
    gcTime: 0,
  });

  const {
    data: fields,
    isLoading: isFieldsLoading,
    error: fieldsError,
  } = useQuery({
    queryKey: ['fields', tableId],
    queryFn: () =>
      fieldsApi.list({
        tableId: tableId!,
      }),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0,
    gcTime: 0,
  });

  const {
    data: records,
    isLoading: isRecordsLoading,
    error: recordsError,
  } = useQuery({
    queryKey: ['records', tableId],
    queryFn: () =>
      recordsApi.list({
        tableId: tableId!,
        limit: 99999999,
        cursor: undefined,
      }),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0,
    gcTime: 0,
  });

  // rebuilds the table store from freshly fetched server state without
  // reloading the document (a full reload breaks the embed SDK handshake
  // inside an iframe)
  const refreshTableState = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['table', tableId] }),
      queryClient.refetchQueries({ queryKey: ['fields', tableId] }),
      queryClient.refetchQueries({ queryKey: ['records', tableId] }),
    ]);
    setRefreshKey((key) => key + 1);
  }, [queryClient, tableId]);

  if (isTableLoading || isFieldsLoading || isRecordsLoading) {
    return <RouteLoadingBar />;
  }

  if (
    tableError ||
    fieldsError ||
    recordsError ||
    isNil(table) ||
    isNil(fields) ||
    isNil(records)
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
        <div className="rounded-full bg-muted p-4">
          <FileX className="h-10 w-10 text-muted-foreground" />
        </div>

        <div>
          <h2 className="text-lg font-semibold">{t('Table not available')}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'We couldn’t load this table. It may have been removed or is unavailable.',
            )}
          </p>
        </div>

        <Link
          className={cn(buttonVariants({ variant: 'outline' }))}
          to="/tables"
        >
          {t('Go to Tables')}
        </Link>
      </div>
    );
  }

  return (
    <TableRefreshContext.Provider value={refreshTableState}>
      <TableLockProvider resourceId={table.id} onTakeOver={refreshTableState}>
        <TableStateProviderWithTable
          key={refreshKey}
          table={table}
          fields={fields}
          records={records.data}
        >
          {children}
        </TableStateProviderWithTable>
      </TableLockProvider>
    </TableRefreshContext.Provider>
  );
}

export function useTableState<T>(selector: (state: TableState) => T) {
  const tableStore = useContext(TableContext);
  if (!tableStore) {
    throw new Error('Table context not found');
  }
  return useStore(tableStore, selector);
}

export function useRefreshTableState() {
  const refreshTableState = useContext(TableRefreshContext);
  if (!refreshTableState) {
    throw new Error('Table refresh context not found');
  }
  return refreshTableState;
}

export function useTableLock() {
  const lock = useContext(TableLockContext);
  if (!lock) {
    throw new Error('Table lock context not found');
  }
  return lock;
}

export function useTableView() {
  const view = useContext(TableViewContext);
  if (!view) {
    throw new Error('Table view context not found');
  }
  return view;
}

export function useOptionalTableStore() {
  const tableStore = useContext(TableContext);
  return tableStore ?? null;
}

// mounted above the keyed remount of TableStateProviderWithTable so a
// take-over refresh never unmounts the lock hook — unmounting it would emit
// a spurious UNLOCK_RESOURCE/LOCK_RESOURCE pair and briefly release the
// just-acquired lock for other clients
function TableLockProvider({
  resourceId,
  onTakeOver,
  children,
}: {
  resourceId: string;
  onTakeOver: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const { lockedBy, takeOver } = useResourceLock({ resourceId, onTakeOver });
  const lock = useMemo(() => ({ lockedBy, takeOver }), [lockedBy, takeOver]);
  return (
    <TableLockContext.Provider value={lock}>
      {children}
    </TableLockContext.Provider>
  );
}

type TableLockContextValue = ReturnType<typeof useResourceLock>;

type TableViewContextValue = {
  views: TableView[];
  selectedView: TableView | null;
  config: TableViewConfig;
  draftName: string;
  isDirty: boolean;
  isSaving: boolean;
  conflictMessage: string | null;
  invalidConditions: {
    condition: TableViewCondition;
    issue: TableViewConditionIssue;
  }[];
  setDraftName: (name: string) => void;
  updateConfig: (
    updater: (config: TableViewConfig) => TableViewConfig,
  ) => void;
  selectView: (viewId: string | null) => void;
  createView: (name: string) => Promise<TableView>;
  saveView: (name?: string) => Promise<unknown>;
  deleteView: (id: string) => Promise<void>;
  reloadView: () => Promise<void>;
};
