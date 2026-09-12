import {
  ProjectMigrationBlockerSeverity,
  ProjectMigrationItem,
  ProjectMigrationOperationStatus,
  ProjectMigrationPrecheckReport,
  ProjectMigrationResourceType,
} from '@activepieces/shared';
import { InfiniteData } from '@tanstack/react-query';
import { AlertTriangle, PackageOpen } from 'lucide-react';
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
  resourceType: ProjectMigrationResourceType;
  initialData?: InfiniteData<
    ProjectMigrationPrecheckReport,
    { cursor: string | null }
  >;
  initialLoading: boolean;
  initialError: boolean;
  onInitialRetry: () => void;
};

const statusOrder: ProjectMigrationOperationStatus[] = [
  ProjectMigrationOperationStatus.WILL_CREATE,
  ProjectMigrationOperationStatus.WILL_UPDATE,
  ProjectMigrationOperationStatus.WILL_DELETE,
  ProjectMigrationOperationStatus.NO_CHANGE,
];

export function MigrationResourceTable({
  snapshotToken,
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
  const items = sortByStatus(
    pages.flatMap((page: ProjectMigrationPrecheckReport) => page.page.data),
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
          {items.map((item, index) => (
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
            {
              count: counts.blocked,
            },
          )}
        </div>
      )}
    </div>
  );
}

function sortByStatus(items: ProjectMigrationItem[]): ProjectMigrationItem[] {
  return [...items].sort((a, b) => {
    const aBlocked = a.blockers.some(
      (blocker) => blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER,
    )
      ? 1
      : 0;
    const bBlocked = b.blockers.some(
      (blocker) => blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER,
    )
      ? 1
      : 0;
    if (aBlocked !== bBlocked) {
      return bBlocked - aBlocked;
    }
    return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
  });
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
