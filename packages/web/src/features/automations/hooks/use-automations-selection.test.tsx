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

function renderSelection(visible: TreeItem[], known: TreeItem[] = visible) {
  return renderHook(
    ({ visibleItems, knownItems }) =>
      useAutomationsSelection({ visibleItems, knownItems }),
    { initialProps: { visibleItems: visible, knownItems: known } },
  );
}

describe('useAutomationsSelection reconciliation', () => {
  it('drops selection for items that disappeared after a refresh', () => {
    const initial = [
      makeTreeItem('flow', 'flow-1'),
      makeTreeItem('table', 'table-1'),
    ];
    const { result, rerender } = renderSelection(initial);

    act(() => {
      result.current.toggleAllSelection();
    });
    expect(result.current.selectedItems.size).toBe(2);

    const nextVisible = [makeTreeItem('flow', 'flow-1')];
    rerender({ visibleItems: nextVisible, knownItems: nextVisible });

    expect(result.current.selectedItems.has('flow-flow-1')).toBe(true);
    expect(result.current.selectedItems.has('table-table-1')).toBe(false);
  });

  it('retains items selected on another page after a server refresh', () => {
    const pageOne = [makeTreeItem('flow', 'flow-1')];
    const pageTwo = [makeTreeItem('flow', 'flow-2')];
    const known = [pageOne[0], pageTwo[0]];
    const { result, rerender } = renderSelection(pageOne, known);

    act(() => {
      result.current.toggleItemSelection(pageOne[0]);
    });
    rerender({ visibleItems: pageTwo, knownItems: known });
    act(() => {
      result.current.toggleItemSelection(pageTwo[0]);
    });

    expect(result.current.selectedItems.size).toBe(2);
    expect(result.current.selectedItems.has('flow-flow-1')).toBe(true);
    expect(result.current.selectedItems.has('flow-flow-2')).toBe(true);
  });

  it('removes only successful keys, keeping failed items selected for retry', () => {
    const items = [
      makeTreeItem('flow', 'flow-1'),
      makeTreeItem('flow', 'flow-2'),
    ];
    const { result } = renderSelection(items);

    act(() => {
      result.current.toggleAllSelection();
    });

    act(() => {
      result.current.removeSelectedKeys(new Set(['flow-flow-1']));
    });

    expect(result.current.selectedItems.has('flow-flow-1')).toBe(false);
    expect(result.current.selectedItems.has('flow-flow-2')).toBe(true);
  });

  it('drops items that vanish from the server snapshot, even if still selected', () => {
    const both = [
      makeTreeItem('flow', 'flow-1'),
      makeTreeItem('flow', 'flow-2'),
    ];
    const afterDelete = [makeTreeItem('flow', 'flow-2')];
    const { result, rerender } = renderSelection(both);

    act(() => {
      result.current.toggleAllSelection();
    });

    rerender({ visibleItems: afterDelete, knownItems: afterDelete });

    expect(result.current.selectedItems.has('flow-flow-1')).toBe(false);
    expect(result.current.selectedItems.has('flow-flow-2')).toBe(true);
  });

  it('keeps folder header and children selected while collapsed across pages', () => {
    const withFolder = [
      makeTreeItem('folder', 'folder-1'),
      makeTreeItem('flow', 'flow-1', 'folder-1'),
      makeTreeItem('flow', 'flow-2', 'folder-1'),
    ];
    const collapsed = [makeTreeItem('folder', 'folder-1')];
    const { result, rerender } = renderSelection(withFolder);

    act(() => {
      result.current.toggleItemSelection(makeTreeItem('folder', 'folder-1'));
    });
    expect(result.current.selectedItems.size).toBe(3);

    rerender({ visibleItems: collapsed, knownItems: withFolder });

    expect(result.current.selectedItems.has('folder-folder-1')).toBe(true);
    expect(result.current.selectedItems.has('flow-flow-1')).toBe(true);
    expect(result.current.selectedItems.has('flow-flow-2')).toBe(true);
  });

  it('unchecks the folder header when a visible child leaves the selection', () => {
    const withFolder = [
      makeTreeItem('folder', 'folder-1'),
      makeTreeItem('flow', 'flow-1', 'folder-1'),
    ];
    const { result } = renderSelection(withFolder);

    act(() => {
      result.current.toggleItemSelection(makeTreeItem('folder', 'folder-1'));
    });
    act(() => {
      result.current.toggleItemSelection(
        makeTreeItem('flow', 'flow-1', 'folder-1'),
      );
    });

    expect(result.current.selectedItems.has('folder-folder-1')).toBe(false);
    expect(result.current.selectedItems.size).toBe(0);
  });
});
