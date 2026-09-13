// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TreeItem } from '../lib/types';

import { useAutomationsSelection } from './use-automations-selection';

function makeTreeItem(
  type: TreeItem['type'],
  id: string,
  folderId: string | null = null,
): TreeItem {
  return { id, type, name: id, data: null, depth: folderId ? 1 : 0, folderId };
}

describe('useAutomationsSelection reconciliation', () => {
  it('drops selection for items that disappeared after a refresh', () => {
    const initial = [
      makeTreeItem('flow', 'flow-1'),
      makeTreeItem('table', 'table-1'),
    ];
    const { result, rerender } = renderHook(
      ({ items }) => useAutomationsSelection(items),
      { initialProps: { items: initial } },
    );

    act(() => {
      result.current.toggleAllSelection();
    });
    expect(result.current.selectedItems.size).toBe(2);

    rerender({
      items: [makeTreeItem('flow', 'flow-1')],
    });

    expect(result.current.selectedItems.has('flow-flow-1')).toBe(true);
    expect(result.current.selectedItems.has('table-table-1')).toBe(false);
  });

  it('keeps failed items selected after a refresh so they can be retried', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useAutomationsSelection(items),
      {
        initialProps: {
          items: [
            makeTreeItem('flow', 'flow-1'),
            makeTreeItem('flow', 'flow-2'),
          ],
        },
      },
    );

    act(() => {
      result.current.toggleAllSelection();
    });

    act(() => {
      result.current.removeSelectedKeys(new Set(['flow-flow-1']));
    });

    rerender({
      items: [makeTreeItem('flow', 'flow-1'), makeTreeItem('flow', 'flow-2')],
    });

    expect(result.current.selectedItems.has('flow-flow-1')).toBe(false);
    expect(result.current.selectedItems.has('flow-flow-2')).toBe(true);
  });

  it('drops a folder header when its children are unloaded on collapse', () => {
    const withFolder = [
      makeTreeItem('folder', 'folder-1'),
      makeTreeItem('flow', 'flow-1', 'folder-1'),
      makeTreeItem('flow', 'flow-2', 'folder-1'),
    ];
    const { result, rerender } = renderHook(
      ({ items }) => useAutomationsSelection(items),
      { initialProps: { items: withFolder } },
    );

    act(() => {
      result.current.toggleItemSelection(makeTreeItem('folder', 'folder-1'));
    });
    expect(result.current.selectedItems.size).toBe(3);

    rerender({
      items: [makeTreeItem('folder', 'folder-1')],
    });

    expect(result.current.selectedItems.has('folder-folder-1')).toBe(false);
    expect(result.current.selectedItems.size).toBe(0);
  });
});
