import {
  ProjectMigrationBlockerSeverity,
  ProjectMigrationBlockerType,
  ProjectMigrationItem,
  ProjectMigrationOperationStatus,
} from '@activepieces/shared';
import {
  AlertTriangle,
  Ban,
  Check,
  Minus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

type MigrationStatusBadgeProps = {
  status: ProjectMigrationOperationStatus;
};

const statusStyles: Record<
  ProjectMigrationOperationStatus,
  {
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    className: string;
  }
> = {
  [ProjectMigrationOperationStatus.WILL_CREATE]: {
    variant: 'default',
    className: 'bg-success/15 text-success border-success/30',
  },
  [ProjectMigrationOperationStatus.WILL_UPDATE]: {
    variant: 'default',
    className: 'bg-warning/15 text-warning border-warning/30',
  },
  [ProjectMigrationOperationStatus.WILL_DELETE]: {
    variant: 'destructive',
    className: '',
  },
  [ProjectMigrationOperationStatus.NO_CHANGE]: {
    variant: 'secondary',
    className: '',
  },
};

export function MigrationStatusBadge({ status }: MigrationStatusBadgeProps) {
  const { t } = useTranslation();
  const labels: Record<ProjectMigrationOperationStatus, string> = {
    [ProjectMigrationOperationStatus.WILL_CREATE]: t('Create'),
    [ProjectMigrationOperationStatus.WILL_UPDATE]: t('Update'),
    [ProjectMigrationOperationStatus.WILL_DELETE]: t('Delete'),
    [ProjectMigrationOperationStatus.NO_CHANGE]: t('No change'),
  };
  const style = statusStyles[status];
  return (
    <Badge variant={style.variant} className={`gap-1 ${style.className}`}>
      {status === ProjectMigrationOperationStatus.WILL_CREATE && (
        <Plus className="size-3" />
      )}
      {status === ProjectMigrationOperationStatus.WILL_UPDATE && (
        <Pencil className="size-3" />
      )}
      {status === ProjectMigrationOperationStatus.WILL_DELETE && (
        <Trash2 className="size-3" />
      )}
      {status === ProjectMigrationOperationStatus.NO_CHANGE && (
        <Minus className="size-3" />
      )}
      {labels[status]}
    </Badge>
  );
}

type MigrationItemNameProps = {
  item: ProjectMigrationItem;
};

export function MigrationItemName({ item }: MigrationItemNameProps) {
  switch (item.resourceType) {
    case 'FLOW':
      return (
        <span>
          {item.sourceFlowState?.version.displayName ??
            item.targetFlowState?.version.displayName ??
            ''}
        </span>
      );
    case 'TABLE':
      return (
        <span>
          {item.sourceTableState?.name ?? item.targetTableState?.name ?? ''}
        </span>
      );
    case 'CONNECTION':
      return (
        <span>
          {item.sourceConnectionState?.displayName ??
            item.targetConnectionState?.displayName ??
            ''}
        </span>
      );
    case 'FOLDER':
      return (
        <span>
          {item.sourceFolderState?.displayName ??
            item.targetFolderState?.displayName ??
            ''}
        </span>
      );
  }
}

type BlockersCellProps = {
  item: ProjectMigrationItem;
};

export function BlockersCell({ item }: BlockersCellProps) {
  const { t } = useTranslation();
  if (item.blockers.length === 0) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground text-sm">
        <Check className="size-3 text-success" />
        {t('Ready')}
      </span>
    );
  }
  const hasBlocker = item.blockers.some(
    (blocker) => blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER,
  );
  return (
    <div className="flex flex-col gap-1">
      {item.blockers.map((blocker, index) => (
        <span
          key={`${blocker.type}-${index}`}
          className="flex items-start gap-1 text-xs"
        >
          {blocker.type === ProjectMigrationBlockerType.MISSING_PIECE ? (
            <Ban
              className={`size-3.5 mt-0.5 shrink-0 ${
                blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER
                  ? 'text-destructive'
                  : 'text-warning'
              }`}
            />
          ) : (
            <AlertTriangle
              className={`size-3.5 mt-0.5 shrink-0 ${
                blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER
                  ? 'text-destructive'
                  : 'text-warning'
              }`}
            />
          )}
          <span
            className={
              blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER
                ? 'text-destructive'
                : 'text-warning'
            }
          >
            {blocker.type === ProjectMigrationBlockerType.MISSING_PIECE &&
              blocker.piece && (
                <>
                  {t('Missing piece')}: {blocker.piece.pieceName}@
                  {blocker.piece.pieceVersion}
                </>
              )}
            {blocker.type ===
              ProjectMigrationBlockerType.MISSING_CONNECTION && (
              <>
                {t('Missing connection')}:{' '}
                {blocker.connectionDisplayName ?? blocker.connectionExternalId}
              </>
            )}
          </span>
        </span>
      ))}
      {hasBlocker && (
        <span className="text-[10px] text-muted-foreground">
          {t('Install the piece in the target project before releasing')}
        </span>
      )}
    </div>
  );
}
