import { DependencyNodeType } from '@activepieces/shared';
import { t } from 'i18next';

export const dependencyGraphLabels = {
  nodeTypeLabel(type: DependencyNodeType): string {
    switch (type) {
      case DependencyNodeType.FLOW:
        return t('Flow');
      case DependencyNodeType.TABLE:
        return t('Table');
      case DependencyNodeType.CONNECTION:
        return t('Connection');
      case DependencyNodeType.PIECE:
        return t('Piece');
      case DependencyNodeType.AGENT:
        return t('Agent');
    }
  },
};
