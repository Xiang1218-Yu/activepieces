import { AxiosError, HttpStatusCode } from 'axios';
import { describe, expect, it } from 'vitest';

import { SelectedItemsMap, TreeItem } from './types';
import { classifyMoveError, getMovableSelectedItems } from './utils';

function makeTreeItem(
  type: TreeItem['type'],
  id: string,
  folderId: string | null = null,
  name?: string,
): TreeItem {
  return {
    id,
    type,
    name: name ?? id,
    data: null,
    depth: folderId ? 1 : 0,
    folderId,
  };
}

describe('getMovableSelectedItems', () => {
  it('returns selected flows and tables found in the loaded tree', () => {
    const selected: SelectedItemsMap = new Map([
      ['flow-flow-1', 'flow'],
      ['table-table-1', 'table'],
      ['folder-folder-1', 'folder'],
    ]);
    const treeItems = [
      makeTreeItem('folder', 'folder-1'),
      makeTreeItem('flow', 'flow-1'),
      makeTreeItem('table', 'table-1'),
      makeTreeItem('flow', 'flow-2', 'folder-1'),
    ];

    const result = getMovableSelectedItems(selected, treeItems);

    expect(result).toEqual([
      { id: 'flow-1', type: 'flow', name: 'flow-1', folderId: null },
      { id: 'table-1', type: 'table', name: 'table-1', folderId: null },
    ]);
  });

  it('drops selected ids that are no longer present in the tree', () => {
    const selected: SelectedItemsMap = new Map([
      ['flow-deleted-flow', 'flow'],
      ['flow-flow-1', 'flow'],
    ]);
    const treeItems = [makeTreeItem('flow', 'flow-1')];

    const result = getMovableSelectedItems(selected, treeItems);

    expect(result).toEqual([
      { id: 'flow-1', type: 'flow', name: 'flow-1', folderId: null },
    ]);
  });

  it('includes flows nested under a selected folder when they are loaded', () => {
    const selected: SelectedItemsMap = new Map([
      ['folder-folder-1', 'folder'],
      ['flow-flow-1', 'flow'],
      ['table-table-1', 'table'],
    ]);
    const treeItems = [
      makeTreeItem('folder', 'folder-1'),
      makeTreeItem('flow', 'flow-1', 'folder-1'),
      makeTreeItem('table', 'table-1', 'folder-1'),
    ];

    const result = getMovableSelectedItems(selected, treeItems);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.id)).toEqual(['flow-1', 'table-1']);
  });

  it('preserves the tree order instead of the selection order', () => {
    const selected: SelectedItemsMap = new Map([
      ['table-table-1', 'table'],
      ['flow-flow-1', 'flow'],
    ]);
    const treeItems = [
      makeTreeItem('flow', 'flow-1'),
      makeTreeItem('table', 'table-1'),
    ];

    const result = getMovableSelectedItems(selected, treeItems);

    expect(result.map((item) => item.id)).toEqual(['flow-1', 'table-1']);
  });
});

describe('classifyMoveError', () => {
  it('classifies 403 responses as permission_denied', () => {
    const error = new AxiosError('forbidden', undefined, undefined, null, {
      status: HttpStatusCode.Forbidden,
      data: { code: 'PERMISSION_DENIED' },
    } as never);

    expect(classifyMoveError(error)).toBe('permission_denied');
  });

  it('classifies 404 responses as not_found', () => {
    const error = new AxiosError('not found', undefined, undefined, null, {
      status: HttpStatusCode.NotFound,
      data: { code: 'ENTITY_NOT_FOUND' },
    } as never);

    expect(classifyMoveError(error)).toBe('not_found');
  });

  it('classifies other axios statuses as unknown', () => {
    const error = new AxiosError('boom', undefined, undefined, null, {
      status: HttpStatusCode.InternalServerError,
      data: {},
    } as never);

    expect(classifyMoveError(error)).toBe('unknown');
  });

  it('classifies network and non-axios errors as unknown', () => {
    expect(classifyMoveError(new AxiosError('network'))).toBe('unknown');
    expect(classifyMoveError(new Error('unexpected'))).toBe('unknown');
  });
});
