import { isNil } from '@activepieces/core-utils';
import {
  FlowOperationType,
  PopulatedFlow,
  Table,
  UncategorizedFolderId,
} from '@activepieces/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { flowsApi } from '@/features/flows/api/flows-api';
import { flowHooks } from '@/features/flows/hooks/flow-hooks';
import { foldersApi } from '@/features/folders/api/folders-api';
import { tablesUtils } from '@/features/tables';
import { tablesApi } from '@/features/tables/api/tables-api';
import { tableHooks } from '@/features/tables/hooks/table-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { useNewWindow } from '@/lib/navigation-utils';
import { NEW_FLOW_QUERY_PARAM, NEW_TABLE_QUERY_PARAM } from '@/lib/route-utils';

import {
  BulkMoveResult,
  MoveItemFailureReason,
  MoveItemResult,
  SelectedItemsMap,
  TreeItem,
} from '../lib/types';
import {
  classifyMoveError,
  getMovableSelectedItems,
  MovableItem,
} from '../lib/utils';

import { getSelectedIdsByType } from './use-automations-selection';

const TARGET_FOLDER_NOT_FOUND = 'TARGET_FOLDER_NOT_FOUND';

type MutationDeps = {
  invalidateAll: () => void;
  invalidateRoot: () => void;
  invalidateFolder: (folderId: string) => void;
  clearSelection: () => void;
  treeItems: TreeItem[];
  folderIds: string[];
  unpinItem?: (itemId: string) => void;
  onBulkMoveComplete?: (result: BulkMoveResult) => void;
};

export function useAutomationsMutations(deps: MutationDeps) {
  const openNewWindow = useNewWindow();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectId = authenticationSession.getProjectId() ?? '';

  const { mutate: startFromScratch, isPending: isCreateFlowPending } =
    useMutation<PopulatedFlow, Error, string | undefined>({
      mutationFn: async (folderId) => {
        return flowsApi.create({
          projectId,
          displayName: t('Untitled'),
          folderId:
            !folderId || folderId === UncategorizedFolderId
              ? undefined
              : folderId,
        });
      },
      onSuccess: (flow) => {
        deps.invalidateRoot();
        navigate(`/flows/${flow.id}?${NEW_FLOW_QUERY_PARAM}=true`);
      },
    });

  const { mutate: createTableMutation, isPending: isCreatingTable } =
    useMutation<Table, Error, { name: string; folderId?: string }>({
      mutationFn: async ({ name, folderId }) => {
        return tableHooks.createTableWithDefaults({
          name,
          folderId,
          projectId,
        });
      },
      onSuccess: (table) => {
        queryClient.invalidateQueries({ queryKey: ['tables'] });
        deps.invalidateRoot();
        navigate(
          `/projects/${projectId}/tables/${table.id}?${NEW_TABLE_QUERY_PARAM}=true`,
        );
      },
    });

  const { mutate: exportFlows, isPending: isExportFlowsPending } =
    flowHooks.useExportFlows();

  const { mutateAsync: deleteItem } = useMutation({
    mutationFn: async (item: TreeItem) => {
      switch (item.type) {
        case 'flow':
          await flowsApi.delete(item.id);
          break;
        case 'table':
          await tablesApi.delete(item.id);
          break;
        case 'folder':
          await foldersApi.delete(item.id);
          break;
      }
    },
    onSuccess: () => {
      deps.invalidateAll();
      toast.success(t('Item deleted successfully'));
    },
    onError: () => toast.error(t('Failed to delete item')),
  });

  const { mutateAsync: bulkDelete, isPending: isDeleting } = useMutation({
    mutationFn: async (selectedItems: SelectedItemsMap) => {
      const { flowIds, tableIds, folderIds } =
        getSelectedIdsByType(selectedItems);
      await Promise.all([
        ...flowIds.map((id) => flowsApi.delete(id)),
        ...tableIds.map((id) => tablesApi.delete(id)),
        ...folderIds.map((id) => foldersApi.delete(id)),
      ]);
    },
    onSuccess: () => {
      deps.clearSelection();
      deps.invalidateAll();
      toast.success(t('Items deleted successfully'));
    },
    onError: () => toast.error(t('Failed to delete items')),
  });

  const { mutateAsync: bulkMoveTo, isPending: isBulkMoving } = useMutation<
    BulkMoveResult,
    Error,
    { selectedItems: SelectedItemsMap; targetFolderId: string }
  >({
    mutationFn: async ({ selectedItems, targetFolderId }) => {
      const items = getMovableSelectedItems(selectedItems, deps.treeItems);
      const isUncategorized =
        isNil(targetFolderId) || targetFolderId === UncategorizedFolderId;
      const targetExists =
        isUncategorized || deps.folderIds.includes(targetFolderId);

      if (!targetExists) {
        return {
          moved: [],
          failed: items.map((item) => ({
            id: item.id,
            type: item.type,
            name: item.name,
            errorReason: 'target_not_found' as const,
          })),
        };
      }

      const resolvedFolderId = isUncategorized ? null : targetFolderId;

      const results = await Promise.all(
        items.map((item) =>
          moveSingleItem({ item, folderId: resolvedFolderId }),
        ),
      );

      return results.reduce<BulkMoveResult>(
        (acc, result) => {
          if (result.errorReason) {
            acc.failed.push(result);
          } else {
            acc.moved.push(result);
          }
          return acc;
        },
        { moved: [], failed: [] },
      );
    },
    onSuccess: ({ moved, failed }, { targetFolderId }) => {
      if (targetFolderId && targetFolderId !== UncategorizedFolderId) {
        for (const item of moved) {
          deps.unpinItem?.(item.id);
        }
      }

      const itemFailures = failed.filter(
        (failure) => failure.errorReason !== 'target_not_found',
      );
      for (const failure of itemFailures) {
        toast.error(t(getFailureToastTitle(failure.errorReason)), {
          description: `${failure.type === 'flow' ? t('Flow') : t('Table')}: ${
            failure.name
          }`,
        });
      }

      if (
        failed.some((failure) => failure.errorReason === 'target_not_found')
      ) {
        toast.error(t('The destination folder no longer exists'));
      }

      if (moved.length > 0) {
        if (failed.length === 0) {
          toast.success(t('Items moved successfully'));
        } else {
          toast.success(
            t('{movedCount} moved, {failedCount} failed', {
              movedCount: moved.length,
              failedCount: failed.length,
            }),
          );
        }
      }

      deps.onBulkMoveComplete?.({ moved, failed });
    },
  });

  const { mutateAsync: rename, isPending: isRenaming } = useMutation({
    mutationFn: async ({
      item,
      newName,
    }: {
      item: TreeItem;
      newName: string;
    }) => {
      if (item.type === 'flow') {
        await flowsApi.update(item.id, {
          type: FlowOperationType.CHANGE_NAME,
          request: { displayName: newName },
        });
      } else if (item.type === 'table') {
        await tablesApi.update(item.id, { name: newName });
      } else if (item.type === 'folder') {
        await foldersApi.renameFolder(item.id, { displayName: newName });
      }
    },
    onSuccess: () => {
      deps.invalidateAll();
      toast.success(t('Renamed successfully'));
    },
    onError: () => toast.error(t('Failed to rename item')),
  });

  const { mutate: duplicateFlow, isPending: isDuplicating } = useMutation({
    mutationFn: async (flow: PopulatedFlow) => {
      const version = flow.version;
      const displayName = `${version.displayName} - Copy`;
      const createdFlow = await flowsApi.create({
        displayName,
        projectId: flow.projectId,
        folderId: flow.folderId ?? undefined,
      });
      return flowsApi.update(createdFlow.id, {
        type: FlowOperationType.IMPORT_FLOW,
        request: {
          displayName,
          trigger: version.trigger,
          schemaVersion: version.schemaVersion,
          notes: version.notes,
        },
      });
    },
    onSuccess: (data) => {
      openNewWindow(`/flows/${data.id}`);
      deps.invalidateAll();
      toast.success(t('Flow duplicated successfully'));
    },
    onError: () => toast.error(t('Failed to duplicate flow')),
  });

  const { mutate: moveItem, isPending: isMovingItem } = useMutation({
    mutationFn: async ({
      item,
      targetFolderId,
    }: {
      item: TreeItem;
      targetFolderId: string;
    }) => {
      const isUncategorized =
        isNil(targetFolderId) || targetFolderId === UncategorizedFolderId;
      if (!isUncategorized && !deps.folderIds.includes(targetFolderId)) {
        throw new Error(TARGET_FOLDER_NOT_FOUND);
      }
      const folderId = isUncategorized ? null : targetFolderId;
      if (item.type === 'flow') {
        await flowsApi.update(item.id, {
          type: FlowOperationType.CHANGE_FOLDER,
          request: { folderId },
        });
      } else if (item.type === 'table') {
        await tablesApi.update(item.id, { folderId });
      }
    },
    onSuccess: (_data, { item, targetFolderId }) => {
      if (targetFolderId && targetFolderId !== UncategorizedFolderId) {
        deps.unpinItem?.(item.id);
      }
      deps.invalidateAll();
      toast.success(t('Moved successfully'));
    },
    onError: (error) => {
      toast.error(
        error.message === TARGET_FOLDER_NOT_FOUND
          ? t('The destination folder no longer exists')
          : t('Failed to move item'),
      );
    },
  });

  const { mutate: exportTable, isPending: isExportingTable } = useMutation({
    mutationFn: async (table: Table) => {
      const exported = await tablesApi.export(table.id);
      tablesUtils.exportTables([exported]);
    },
    onSuccess: () => toast.success(t('Table has been exported.')),
    onError: () => toast.error(t('Failed to export table')),
  });

  const handleBulkExport = useCallback(
    (selectedItems: SelectedItemsMap) => {
      const { flowIds, tableIds } = getSelectedIdsByType(selectedItems);

      if (flowIds.length > 0) {
        const flowsById = new Map(
          deps.treeItems
            .filter(isFlowTreeItem)
            .map((item) => [item.id, item.data]),
        );
        const flowsToExport = flowIds
          .map((id) => flowsById.get(id))
          .filter((flow): flow is PopulatedFlow => !isNil(flow));
        if (flowsToExport.length > 0) {
          exportFlows(flowsToExport);
        }
      }

      if (tableIds.length > 0) {
        const tables = tableIds.map((id) => ({ id } as Table));
        Promise.all(tables.map((tbl) => tablesApi.export(tbl.id)))
          .then((exported) => {
            tablesUtils.exportTables(exported);
            toast.success(
              exported.length === 1
                ? t('Table has been exported.')
                : t('Tables have been exported.'),
            );
          })
          .catch(() => toast.error(t('Failed to export tables')));
      }

      deps.clearSelection();
    },
    [deps, exportFlows],
  );

  const handleExportFlow = useCallback(
    (flow: PopulatedFlow) => {
      exportFlows([flow]);
    },
    [exportFlows],
  );

  return {
    createFlow: (folderId?: string) => startFromScratch(folderId),
    createTable: (name: string, folderId?: string) =>
      createTableMutation({ name, folderId }),
    isCreateFlowPending,
    isCreatingTable,
    handleDeleteItem: deleteItem,
    handleBulkDelete: bulkDelete,
    handleBulkMoveTo: (
      selectedItems: SelectedItemsMap,
      targetFolderId: string,
    ) => bulkMoveTo({ selectedItems, targetFolderId }),
    handleBulkExport,
    handleRename: (item: TreeItem, newName: string) =>
      rename({ item, newName }),
    handleDuplicateFlow: duplicateFlow,
    handleMoveItem: (item: TreeItem, targetFolderId: string) =>
      moveItem({ item, targetFolderId }),
    handleExportFlow,
    handleExportTable: exportTable,
    isDeleting,
    isMoving: isBulkMoving || isMovingItem,
    isRenaming,
    isDuplicating,
    isExporting: isExportFlowsPending || isExportingTable,
  };
}

function isFlowTreeItem(
  item: TreeItem,
): item is TreeItem & { data: PopulatedFlow } {
  return item.type === 'flow' && !isNil(item.data);
}

async function moveSingleItem({
  item,
  folderId,
}: {
  item: MovableItem;
  folderId: string | null;
}): Promise<MoveItemResult> {
  try {
    if (item.type === 'flow') {
      await flowsApi.update(item.id, {
        type: FlowOperationType.CHANGE_FOLDER,
        request: { folderId },
      });
    } else {
      await tablesApi.update(item.id, { folderId });
    }
    return { id: item.id, type: item.type, name: item.name };
  } catch (error) {
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      errorReason: classifyMoveError(error),
    };
  }
}

function getFailureToastTitle(reason: MoveItemFailureReason): string {
  switch (reason) {
    case 'permission_denied':
      return t('You do not have permission to move this item');
    case 'not_found':
      return t('This item no longer exists');
    case 'target_not_found':
      return t('The destination folder no longer exists');
    case 'unknown':
      return t('Failed to move this item');
  }
}
