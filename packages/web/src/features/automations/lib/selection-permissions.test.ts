import { describe, expect, it } from 'vitest';

import { TreeItem } from './types';
import {
  isItemSelectable,
  SelectionPermissions,
} from './selection-permissions';

const allAllowed: SelectionPermissions = {
  canWriteFlow: true,
  canWriteTable: true,
  canWriteFolder: true,
};

const readOnly: SelectionPermissions = {
  canWriteFlow: false,
  canWriteTable: false,
  canWriteFolder: false,
};

const flowWriterOnly: SelectionPermissions = {
  canWriteFlow: true,
  canWriteTable: false,
  canWriteFolder: false,
};

function item(type: TreeItem['type']): TreeItem {
  return {
    id: `${type}-1`,
    type,
    name: type,
    data: null,
    depth: 0,
    folderId: null,
  };
}

describe('isItemSelectable', () => {
  it('selects every writable type when all permissions are granted', () => {
    expect(isItemSelectable(item('flow'), allAllowed)).toBe(true);
    expect(isItemSelectable(item('table'), allAllowed)).toBe(true);
    expect(isItemSelectable(item('folder'), allAllowed)).toBe(true);
  });

  it('blocks every type for a read-only viewer', () => {
    expect(isItemSelectable(item('flow'), readOnly)).toBe(false);
    expect(isItemSelectable(item('table'), readOnly)).toBe(false);
    expect(isItemSelectable(item('folder'), readOnly)).toBe(false);
  });

  it('never selects the load-more row', () => {
    expect(
      isItemSelectable(item('load-more-folder'), allAllowed),
    ).toBe(false);
  });

  it('lets a flow-only writer select flows and folders but not tables', () => {
    expect(isItemSelectable(item('flow'), flowWriterOnly)).toBe(true);
    expect(isItemSelectable(item('table'), flowWriterOnly)).toBe(false);
    expect(isItemSelectable(item('folder'), flowWriterOnly)).toBe(true);
  });
});
