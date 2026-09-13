// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, HttpStatusCode } from 'axios';
import { useMemo } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flowsList = vi.fn();
const flowsUpdate = vi.fn();
const foldersList = vi.fn();

vi.mock('@/features/flows/api/flows-api', () => ({
  flowsApi: {
    list: (...args: unknown[]) => flowsList(...args),
    update: (...args: unknown[]) => flowsUpdate(...args),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/features/folders/api/folders-api', () => ({
  foldersApi: {
    list: (...args: unknown[]) => foldersList(...args),
    delete: vi.fn(),
    renameFolder: vi.fn(),
  },
}));

vi.mock('@/features/tables/api/tables-api', () => ({
  tablesApi: {
    list: vi.fn().mockResolvedValue({ data: [], next: null, previous: null }),
    update: vi.fn(),
    delete: vi.fn(),
    export: vi.fn(),
  },
}));

vi.mock('@/features/tables', () => ({
  tablesUtils: { exportTables: vi.fn() },
}));

vi.mock('@/features/tables/hooks/table-hooks', () => ({
  tableHooks: { createTableWithDefaults: vi.fn() },
}));

vi.mock('@/features/flows/hooks/flow-hooks', () => ({
  flowHooks: { useExportFlows: () => ({ mutate: vi.fn(), isPending: false }) },
}));

vi.mock('@/features/projects/stores/project-collection', () => ({
  projectCollectionUtils: { markFlowActivity: vi.fn() },
}));

vi.mock('@/lib/authentication-session', () => ({
  authenticationSession: {
    getProjectId: vi.fn().mockReturnValue('proj-1'),
    appendProjectRoutePrefix: (path: string) => path,
  },
}));

vi.mock('@/lib/navigation-utils', () => ({
  useNewWindow: () => vi.fn(),
}));

vi.mock('@/lib/route-utils', () => ({
  NEW_FLOW_QUERY_PARAM: 'newFlow',
  NEW_TABLE_QUERY_PARAM: 'newTable',
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => ({ projectId: 'proj-1' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/providers/embed-provider', () => ({
  useEmbedding: () => ({ embedState: { hideTables: false } }),
}));

import {
  AutomationsFilters,
  AutomationsSort,
  BulkMoveResult,
} from '../lib/types';

import { useAutomationsData } from './use-automations-data';
import { useAutomationsMutations } from './use-automations-mutations';
import { useAutomationsSelection } from './use-automations-selection';

const EMPTY_FILTERS: AutomationsFilters = {
  searchTerm: '',
  typeFilter: [],
  statusFilter: [],
  connectionFilter: [],
  ownerFilter: [],
  folderFilter: [],
};

function makeFlow(
  id: string,
  updatedAt: string,
  folderId: string | null = null,
) {
  return {
    id,
    projectId: 'proj-1',
    folderId,
    status: 'DISABLED',
    updated: updatedAt,
    created: updatedAt,
    version: { id: `${id}-v1`, displayName: id, trigger: null },
  };
}

function flowPage(ids: string[]) {
  return {
    data: ids.map((id) => makeFlow(id, `2026-09-1${id.slice(-1)}T00:00:00Z`)),
    next: null,
    previous: null,
  };
}

function useScenario() {
  const data = useAutomationsData({
    filters: EMPTY_FILTERS,
    pinnedList: [],
    sort: 'default' satisfies AutomationsSort,
  });
  const selection = useAutomationsSelection({
    visibleItems: data.treeItems,
    knownItems: data.knownItems,
  });

  const handleBulkMoveComplete = (result: BulkMoveResult) => {
    if (result.moved.length > 0) {
      selection.removeSelectedKeys(
        new Set(result.moved.map((item) => `${item.type}-${item.id}`)),
      );
    }
  };

  const mutations = useAutomationsMutations({
    invalidateAll: data.invalidateAll,
    invalidateRoot: data.invalidateRoot,
    invalidateFolder: data.invalidateFolder,
    clearSelection: selection.clearSelection,
    treeItems: data.knownItems,
    folderIds: data.folders.map((folder) => folder.id),
    unpinItem: vi.fn(),
    onBulkMoveComplete: handleBulkMoveComplete,
  });

  const movableCount = useMemo(
    () =>
      data.knownItems.filter(
        (item) =>
          (item.type === 'flow' || item.type === 'table') &&
          selection.selectedItems.has(`${item.type}-${item.id}`),
      ).length,
    [data.knownItems, selection.selectedItems],
  );

  return { data, selection, mutations, movableCount };
}

function wrapperFactory(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('cross-page select, bulk move, server refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flowsList.mockReset();
    flowsUpdate.mockReset();
    foldersList.mockReset();
  });

  it('moves picks across pages, clamps the overflowing page, and keeps failures selected', async () => {
    const folder = {
      id: 'folder-a',
      displayName: 'Folder A',
      numberOfFlows: 0,
      numberOfTables: 0,
      projectId: 'proj-1',
    };
    foldersList.mockResolvedValue([folder]);
    const initialIds = ['flow-1', 'flow-2', 'flow-3'];
    const movedToFolder = new Set<string>();
    const movedFolderContent = () =>
      [...movedToFolder].sort((a, b) => b.localeCompare(a));
    const visibleRootIds = () =>
      initialIds.filter((id) => !movedToFolder.has(id));
    flowsList.mockImplementation((request: { folderIds?: string[] }) => {
      if (request.folderIds) {
        return Promise.resolve({
          data: movedFolderContent().map((id) =>
            makeFlow(id, '2026-09-13T00:00:00Z', 'folder-a'),
          ),
          next: null,
          previous: null,
        });
      }
      return Promise.resolve(flowPage(visibleRootIds()));
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateCalls: unknown[] = [];
    const realInvalidateQueries = queryClient.invalidateQueries;
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(function (
      this: QueryClient,
      filters,
      options,
    ) {
      invalidateCalls.push(filters);
      return realInvalidateQueries.call(this, filters, options);
    });
    const { result } = renderHook(() => useScenario(), {
      wrapper: wrapperFactory(queryClient),
    });

    await waitFor(() =>
      expect(result.current.data.treeItems.map((i) => i.id)).toEqual([
        'folder-a',
        'flow-3',
        'flow-2',
        'flow-1',
      ]),
    );

    await act(async () => {
      result.current.data.changePageSize(1);
    });
    await waitFor(() =>
      expect(result.current.data.treeItems.map((i) => i.id)).toEqual([
        'folder-a',
      ]),
    );
    expect(result.current.data.rootPage).toBe(0);

    await act(async () => {
      result.current.data.nextRootPage();
    });
    await waitFor(() =>
      expect(result.current.data.treeItems.map((i) => i.id)).toEqual([
        'flow-3',
      ]),
    );

    await act(async () => {
      result.current.data.nextRootPage();
    });
    await waitFor(() =>
      expect(result.current.data.treeItems.map((i) => i.id)).toEqual([
        'flow-2',
      ]),
    );
    act(() => {
      result.current.selection.toggleItemSelection(
        result.current.data.treeItems[0],
      );
    });

    await act(async () => {
      result.current.data.nextRootPage();
    });
    await waitFor(() =>
      expect(result.current.data.treeItems.map((i) => i.id)).toEqual([
        'flow-1',
      ]),
    );
    act(() => {
      result.current.selection.toggleItemSelection(
        result.current.data.treeItems[0],
      );
    });

    expect(result.current.selection.selectedItems.size).toBe(2);
    expect(result.current.movableCount).toBe(2);

    flowsUpdate.mockImplementation((flowId: string) => {
      if (flowId === 'flow-1') {
        movedToFolder.add(flowId);
        return Promise.resolve(
          makeFlow(flowId, '2026-09-13T00:00:00Z', 'folder-a'),
        );
      }
      return Promise.reject(
        new AxiosError('forbidden', undefined, undefined, null, {
          status: HttpStatusCode.Forbidden,
          data: { code: 'PERMISSION_DENIED' },
        }),
      );
    });

    let moveResult: BulkMoveResult | undefined;
    await act(async () => {
      moveResult = await result.current.mutations.handleBulkMoveTo(
        result.current.selection.selectedItems,
        'folder-a',
      );
    });

    expect(invalidateCalls.length).toBeGreaterThan(0);
    expect(moveResult?.moved.map((item) => item.id)).toEqual(['flow-1']);
    expect(moveResult?.failed.map((item) => item.id)).toEqual(['flow-2']);
    expect(moveResult?.failed[0].errorReason).toBe('permission_denied');

    await waitFor(() =>
      expect(result.current.data.treeItems.map((i) => i.id)).toEqual([
        'flow-2',
      ]),
    );
    expect(result.current.data.rootFlows.map((i) => i.id).sort()).toEqual([
      'flow-2',
      'flow-3',
    ]);
    expect(result.current.data.rootPage).toBe(2);
    expect(result.current.data.totalPages).toBe(3);

    await waitFor(() => {
      const movedFlow = result.current.data.knownItems.find(
        (item) => item.id === 'flow-1',
      );
      expect(movedFlow?.folderId).toBe('folder-a');
    });
    await waitFor(() =>
      expect(result.current.selection.selectedItems.has('flow-flow-1')).toBe(
        false,
      ),
    );
    expect(result.current.selection.selectedItems.has('flow-flow-2')).toBe(
      true,
    );
    expect(result.current.selection.selectedItems.has('flow-flow-3')).toBe(
      false,
    );
  });
});
