import { RecentRunStatus } from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import { TreeItem } from './types';
import {
  buildFilteredTreeItems,
  buildTreeItems,
  hasActiveFilters,
  hasConflictingFilters,
  hasNonFolderFilters,
  hasRunFilters,
} from './utils';

const baseFilters = {
  searchTerm: '',
  typeFilter: [],
  statusFilter: [],
  connectionFilter: [],
  ownerFilter: [],
  folderFilter: [],
  recentRunStatusFilter: [],
  runAfter: null,
  runBefore: null,
};

describe('automations filter predicates', () => {
  it('detects run-related filters', () => {
    expect(hasRunFilters(baseFilters)).toBe(false);
    expect(
      hasRunFilters({
        ...baseFilters,
        recentRunStatusFilter: [RecentRunStatus.FAILED],
      }),
    ).toBe(true);
    expect(
      hasRunFilters({ ...baseFilters, runAfter: '2026-09-12T00:00:00Z' }),
    ).toBe(true);
    expect(
      hasRunFilters({ ...baseFilters, runBefore: '2026-09-13T00:00:00Z' }),
    ).toBe(true);
  });

  it('treats run filters as non-folder filters', () => {
    expect(hasNonFolderFilters(baseFilters)).toBe(false);
    expect(
      hasNonFolderFilters({
        ...baseFilters,
        recentRunStatusFilter: [RecentRunStatus.SUCCEEDED],
      }),
    ).toBe(true);
  });

  it('counts run filters as active', () => {
    expect(hasActiveFilters({ ...baseFilters, folderFilter: ['f1'] })).toBe(
      true,
    );
    expect(
      hasActiveFilters({
        ...baseFilters,
        runBefore: '2026-09-13T00:00:00Z',
      }),
    ).toBe(true);
  });

  it('flags a conflict only for tables-only type combined with run filters', () => {
    expect(
      hasConflictingFilters({
        ...baseFilters,
        typeFilter: ['table'],
        recentRunStatusFilter: [RecentRunStatus.FAILED],
      }),
    ).toBe(true);
    expect(
      hasConflictingFilters({
        ...baseFilters,
        typeFilter: ['table'],
        runAfter: '2026-09-12T00:00:00Z',
      }),
    ).toBe(true);
    expect(
      hasConflictingFilters({
        ...baseFilters,
        typeFilter: ['flow', 'table'],
        recentRunStatusFilter: [RecentRunStatus.FAILED],
      }),
    ).toBe(false);
    expect(
      hasConflictingFilters({
        ...baseFilters,
        recentRunStatusFilter: [RecentRunStatus.FAILED],
      }),
    ).toBe(false);
    expect(hasConflictingFilters({ ...baseFilters, typeFilter: ['table'] })).toBe(
      false,
    );
  });
});

describe('tree item paging', () => {
  const rootFlows = Array.from({ length: 25 }, (_, i) =>
    flowTreeItem(`flow-${i}`, `Flow ${i}`),
  );
  const flowDtos = rootFlows.map((item) => item.data as never);

  it('clamps an out-of-range page to the last page when building the tree', () => {
    const { items, totalRootItems } = buildTreeItems({
      folders: [],
      rootFlows: flowDtos,
      rootTables: [],
      folderContents: new Map(),
      folderCounts: new Map(),
      folderVisibleCounts: new Map(),
      rootPage: 99,
      pageSize: 10,
      pinnedList: undefined,
      sort: 'name-asc',
    });
    expect(totalRootItems).toBe(25);
    expect(items.map((i) => i.id)).toEqual(
      rootFlows.slice(20, 25).map((i) => i.id),
    );
  });

  it('clamps an out-of-range page in filtered tree items', () => {
    const { items, totalItems } = buildFilteredTreeItems({
      flows: flowDtos,
      tables: [],
      folders: [],
      folderVisibleCounts: new Map(),
      page: 99,
      pageSize: 10,
      pinnedList: undefined,
      searchTerm: undefined,
      sort: 'name-asc',
    });
    expect(totalItems).toBe(25);
    expect(items.map((i) => i.id)).toEqual(
      rootFlows.slice(20, 25).map((i) => i.id),
    );
  });
});

function flowTreeItem(id: string, name: string): TreeItem {
  return {
    id,
    type: 'flow',
    name,
    data: {
      id,
      updated: '2026-09-12T00:00:00.000Z',
      version: { id: `v-${id}`, displayName: name },
    } as never,
    depth: 0,
    folderId: null,
  };
}
