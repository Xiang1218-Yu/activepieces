import {
  ProjectMigrationBlockerSeverity,
  ProjectMigrationBlockerType,
  ProjectMigrationItem,
  ProjectMigrationOperationStatus,
  ProjectMigrationPrecheckReport,
  ProjectMigrationResourceType,
} from '@activepieces/shared';
import { InfiniteData } from '@tanstack/react-query';
import { AlertTriangle, PackageOpen } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMigrationResourcePage } from '@/features/project-releases';

import {
  BlockersCell,
  MigrationItemName,
  MigrationStatusBadge,
} from './migration-item-cells';

type MigrationResourceTableProps = {
  snapshotToken: string | null;
  targetProjectId: string | null;
  resourceType: ProjectMigrationResourceType;
  initialData?: InfiniteData<
    ProjectMigrationPrecheckReport,
    { cursor: string | null }
  >;
  initialLoading: boolean;
  initialError: boolean;
  onInitialRetry: () => void;
};

type ItemGroupKey = 'BLOCKED' | ProjectMigrationOperationStatus;

const groupOrder: ItemGroupKey[] = [
  'BLOCKED',
  ProjectMigrationOperationStatus.WILL_CREATE,
  ProjectMigrationOperationStatus.WILL_UPDATE,
  ProjectMigrationOperationStatus.WILL_DELETE,
  ProjectMigrationOperationStatus.NO_CHANGE,
];

export function MigrationResourceTable({
  snapshotToken,
  targetProjectId,
  resourceType,
  initialData,
  initialLoading,
  initialError,
  onInitialRetry,
}: MigrationResourceTableProps) {
  const { t } = useTranslation();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    refetch,
  } = useMigrationResourcePage({
    snapshotToken,
    targetProjectId,
    resourceType,
    initialData,
  });

  if (initialLoading || isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  if (initialError || isError) {
    return (
      <DataFetchErrorState
        entity={t('migration precheck')}
        onRetry={() => {
          if (initialError) {
            onInitialRetry();
          } else {
            refetch();
          }
        }}
      />
    );
  }

  const pages = data?.pages ?? [];
  const summary = pages[0]?.summary;
  const items = pages.flatMap(
    (page: ProjectMigrationPrecheckReport) => page.page.data,
  );
  const counts = summary?.totals[resourceType];

  if (!counts || counts.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <PackageOpen className="size-10" />
        <p className="text-sm font-medium">{t('No objects of this type')}</p>
        <p className="text-xs">
          {t(
            'Both projects are empty for this resource type, or the objects are identical',
          )}
        </p>
      </div>
    );
  }

  const groups = groupItems(items);
  const nextCursor = pages[pages.length - 1]?.page.nextCursor ?? null;

  return (
    <div className="flex flex-col">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">{t('Name')}</TableHead>
            <TableHead className="w-32">{t('Change')}</TableHead>
            <TableHead>{t('Readiness')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupOrder.flatMap((groupKey) => {
            const groupItems = groups[groupKey];
            if (!groupItems || groupItems.items.length === 0) {
              return [];
            }
            return (
              <Fragment key={groupKey}>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="bg-muted/30 py-1.5">
                    <GroupHeader groupKey={groupKey} group={groupItems} />
                  </TableCell>
                </TableRow>
                {groupItems.items.map((item, index) => (
                  <TableRow key={getItemKey(item, index)}>
                    <TableCell className="font-medium">
                      <MigrationItemName item={item} />
                    </TableCell>
                    <TableCell>
                      <MigrationStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>
                      <BlockersCell item={item} />
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between p-4">
        <span className="text-xs text-muted-foreground">
          {t('Showing')} {items.length} {t('of')} {counts.total}
        </span>
        {nextCursor !== null && (
          <button
            className="text-sm text-primary underline-offset-4 hover:underline disabled:text-muted-foreground"
            disabled={!hasNextPage || isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? t('Loading...') : t('Load more')}
          </button>
        )}
      </div>
      {counts.blocked > 0 && (
        <div className="mx-4 mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {t(
            '{{count}} object(s) have blocking issues and cannot be released until resolved',
            { count: counts.blocked },
          )}
        </div>
      )}
    </div>
  );
}

type ResolvedGroup = {
  label: string;
  count: number;
  items: ProjectMigrationItem[];
};

function GroupHeader({
  groupKey,
  group,
}: {
  groupKey: ItemGroupKey;
  group: ResolvedGroup;
}) {
  const { t } = useTranslation();
  if (groupKey === 'BLOCKED') {
    const hasMissingPiece = group.items.some((item) =>
      item.blockers.some(
        (blocker) => blocker.type === ProjectMigrationBlockerType.MISSING_PIECE,
      ),
    );
    const hasMissingConnection = group.items.some((item) =>
      item.blockers.some(
        (blocker) =>
          blocker.type === ProjectMigrationBlockerType.MISSING_CONNECTION,
      ),
    );
    const reasons = [
      hasMissingPiece ? t('missing piece') : null,
      hasMissingConnection ? t('missing connection') : null,
    ].filter(Boolean);
    return (
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-destructive">
        <AlertTriangle className="size-3.5" />
        {t('Blocked')} · {reasons.join(' / ')} ({group.count})
      </span>
    );
  }
  const statusLabels: Record<ProjectMigrationOperationStatus, string> = {
    [ProjectMigrationOperationStatus.WILL_CREATE]: t('Will create'),
    [ProjectMigrationOperationStatus.WILL_UPDATE]: t('Will update'),
    [ProjectMigrationOperationStatus.WILL_DELETE]: t('Will delete'),
    [ProjectMigrationOperationStatus.NO_CHANGE]: t('No change'),
  };
  return (
    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {statusLabels[groupKey]} ({group.count})
    </span>
  );
}

function groupItems(
  items: ProjectMigrationItem[],
): Record<ItemGroupKey, ResolvedGroup> {
  const empty: Record<ItemGroupKey, ProjectMigrationItem[]> = {
    BLOCKED: [],
    [ProjectMigrationOperationStatus.WILL_CREATE]: [],
    [ProjectMigrationOperationStatus.WILL_UPDATE]: [],
    [ProjectMigrationOperationStatus.WILL_DELETE]: [],
    [ProjectMigrationOperationStatus.NO_CHANGE]: [],
  };
  for (const item of items) {
    const isBlocked = item.blockers.some(
      (blocker) => blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER,
    );
    if (isBlocked) {
      empty.BLOCKED.push(item);
    } else {
      empty[item.status].push(item);
    }
  }
  return {
    BLOCKED: {
      label: 'Blocked',
      count: empty.BLOCKED.length,
      items: empty.BLOCKED,
    },
    [ProjectMigrationOperationStatus.WILL_CREATE]: {
      label: 'Will create',
      count: empty[ProjectMigrationOperationStatus.WILL_CREATE].length,
      items: empty[ProjectMigrationOperationStatus.WILL_CREATE],
    },
    [ProjectMigrationOperationStatus.WILL_UPDATE]: {
      label: 'Will update',
      count: empty[ProjectMigrationOperationStatus.WILL_UPDATE].length,
      items: empty[ProjectMigrationOperationStatus.WILL_UPDATE],
    },
    [ProjectMigrationOperationStatus.WILL_DELETE]: {
      label: 'Will delete',
      count: empty[ProjectMigrationOperationStatus.WILL_DELETE].length,
      items: empty[ProjectMigrationOperationStatus.WILL_DELETE],
    },
    [ProjectMigrationOperationStatus.NO_CHANGE]: {
      label: 'No change',
      count: empty[ProjectMigrationOperationStatus.NO_CHANGE].length,
      items: empty[ProjectMigrationOperationStatus.NO_CHANGE],
    },
  };
}

function getItemKey(item: ProjectMigrationItem, index: number): string {
  switch (item.resourceType) {
    case ProjectMigrationResourceType.FLOW:
      return `flow-${
        item.sourceFlowState?.id ?? item.targetFlowState?.id ?? index
      }`;
    case ProjectMigrationResourceType.TABLE:
      return `table-${
        item.sourceTableState?.id ?? item.targetTableState?.id ?? index
      }`;
    case ProjectMigrationResourceType.CONNECTION:
      return `connection-${
        item.sourceConnectionState?.externalId ??
        item.targetConnectionState?.externalId ??
        index
      }`;
    case ProjectMigrationResourceType.FOLDER:
      return `folder-${
        item.sourceFolderState?.id ?? item.targetFolderState?.id ?? index
      }`;
  }
}
