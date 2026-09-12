import { isNil } from '@activepieces/core-utils';
import {
  DependencyNode,
  DependencyNodeStatus,
  DependencyNodeType,
} from '@activepieces/shared';

export const dependencyGraphNavigation = {
  getNodePath(
    node: Pick<DependencyNode, 'type' | 'refId' | 'displayName' | 'status'>,
  ): string | null {
    if (node.status === DependencyNodeStatus.DELETED) {
      return null;
    }
    switch (node.type) {
      case DependencyNodeType.FLOW:
        return isNil(node.refId) ? null : `/flows/${node.refId}`;
      case DependencyNodeType.TABLE:
        return isNil(node.refId) ? null : `/tables/${node.refId}`;
      case DependencyNodeType.AGENT:
        return isNil(node.refId) ? null : `/agents/${node.refId}`;
      case DependencyNodeType.CONNECTION:
        return isNil(node.refId) ? null : `/connections/${node.refId}`;
      case DependencyNodeType.PIECE:
        return null;
    }
  },
};
