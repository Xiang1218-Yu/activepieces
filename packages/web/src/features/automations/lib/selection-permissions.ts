import { TreeItem } from './types';

export type SelectionPermissions = {
  canWriteFlow: boolean;
  canWriteTable: boolean;
  canWriteFolder: boolean;
};

export function isItemSelectable(
  item: TreeItem,
  permissions: SelectionPermissions,
): boolean {
  switch (item.type) {
    case 'flow':
      return permissions.canWriteFlow;
    case 'table':
      return permissions.canWriteTable;
    case 'folder':
      return (
        permissions.canWriteFolder ||
        permissions.canWriteFlow ||
        permissions.canWriteTable
      );
    default:
      return false;
  }
}
