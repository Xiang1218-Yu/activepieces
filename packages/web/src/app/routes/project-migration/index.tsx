import { Permission, isNil } from '@activepieces/core-utils';
import {
  ProjectMigrationOperationStatus,
  ProjectMigrationPrecheckReport,
  ProjectMigrationResourceType,
} from '@activepieces/shared';
import { InfiniteData } from '@tanstack/react-query';
import {
  ArrowRight,
  Boxes,
  Database,
  FolderOpenDot,
  GitBranch,
  Workflow,
  Plug,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SearchableSelect } from '@/components/custom/searchable-select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMigrationPrecheckBootstrap } from '@/features/project-releases';
import { projectCollectionUtils } from '@/features/projects';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { authenticationSession } from '@/lib/authentication-session';

import { ContinueToReleaseButton } from './components/continue-to-release-button';
import { MigrationResourceTable } from './components/migration-resource-table';

type ResourceTab = {
  key: ProjectMigrationResourceType;
  label: string;
  icon: typeof Workflow;
};

const resourceTabs: ResourceTab[] = [
  {
    key: ProjectMigrationResourceType.FLOW,
    label: 'Flows',
    icon: Workflow,
  },
  {
    key: ProjectMigrationResourceType.TABLE,
    label: 'Tables',
    icon: Database,
  },
  {
    key: ProjectMigrationResourceType.CONNECTION,
    label: 'Connections',
    icon: Plug,
  },
  {
    key: ProjectMigrationResourceType.FOLDER,
    label: 'Folders',
    icon: FolderOpenDot,
  },
];

export const ProjectMigrationPrecheckPage = () => {
  const { t } = useTranslation();
  const { checkAccess } = useAuthorization();
  const canWriteRelease = checkAccess(Permission.WRITE_PROJECT_RELEASE);
  const currentProjectId = authenticationSession.getProjectId();
  const { data: projects } = projectCollectionUtils.useAll();

  const selectableProjects = useMemo(
    () => (projects ?? []).filter((project) => project.id !== currentProjectId),
    [projects, currentProjectId],
  );

  const [sourceProjectId, setSourceProjectId] = useState<string | null>(
    selectableProjects[0]?.id ?? null,
  );
  const [appliedSourceProjectId, setAppliedSourceProjectId] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState<ProjectMigrationResourceType>(
    ProjectMigrationResourceType.FLOW,
  );

  const targetProjectId = currentProjectId;

  const bootstrap = useMigrationPrecheckBootstrap({
    sourceProjectId: appliedSourceProjectId,
    targetProjectId,
    enabled: true,
  });

  const bootstrapReport = bootstrap.data;
  const snapshotToken = bootstrapReport?.summary.snapshotToken ?? null;

  const flowInitialData = bootstrapReport
    ? ({
        pageParams: [{ cursor: null }],
        pages: [bootstrapReport],
      } satisfies InfiniteData<
        ProjectMigrationPrecheckReport,
        { cursor: string | null }
      >)
    : undefined;

  const canRunPrecheck =
    !isNil(sourceProjectId) && sourceProjectId !== currentProjectId;

  const runPrecheck = () => {
    if (!canRunPrecheck) {
      return;
    }
    setAppliedSourceProjectId(sourceProjectId);
  };

  const sourceProjectName =
    projects?.find((project) => project.id === appliedSourceProjectId)
      ?.displayName ?? t('Source project');
  const targetProjectName =
    projects?.find((project) => project.id === targetProjectId)?.displayName ??
    t('Current project');

  return (
    <div className="flex w-full flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Boxes className="size-6" />
          {t('Project Migration Precheck')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'Compare flows, tables, folders and connections between projects before releasing. No changes are written to the target project.',
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
        <div className="flex min-w-[260px] flex-1 flex-col gap-2">
          <Label>{t('Source project')}</Label>
          <SearchableSelect
            value={sourceProjectId ?? undefined}
            onChange={(value) => setSourceProjectId(value)}
            placeholder={t('Select the project to migrate from')}
            options={selectableProjects.map((project) => ({
              label: project.displayName,
              value: project.id,
            }))}
          />
        </div>
        <ArrowRight className="size-4 mb-3 text-muted-foreground" />
        <div className="flex min-w-[260px] flex-1 flex-col gap-2">
          <Label>{t('Target project')}</Label>
          <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
            {targetProjectName}
          </div>
        </div>
        <Button
          onClick={runPrecheck}
          disabled={!canRunPrecheck || bootstrap.isFetching}
        >
          {t('Run precheck')}
        </Button>
      </div>

      {isNil(appliedSourceProjectId) ? (
        <EmptySelection />
      ) : (
        <>
          <PrecheckSummaryBar
            summary={bootstrapReport?.summary}
            isLoading={bootstrap.isLoading}
            sourceProjectName={sourceProjectName}
            targetProjectName={targetProjectName}
            snapshotToken={snapshotToken}
            sourceProjectId={appliedSourceProjectId}
            targetProjectId={targetProjectId ?? ''}
            canWriteRelease={canWriteRelease}
          />
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as ProjectMigrationResourceType)
            }
          >
            <TabsList>
              {resourceTabs.map((tab) => {
                const counts = bootstrapReport?.summary.totals[tab.key];
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.key} value={tab.key}>
                    <Icon className="size-4 mr-1" />
                    {t(tab.label)}
                    {counts && counts.total > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({counts.total})
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {resourceTabs.map((tab) => (
              <TabsContent
                key={tab.key}
                value={tab.key}
                className="rounded-lg border mt-2"
              >
                <MigrationResourceTable
                  snapshotToken={snapshotToken}
                  resourceType={tab.key}
                  initialData={
                    tab.key === ProjectMigrationResourceType.FLOW
                      ? flowInitialData
                      : undefined
                  }
                  initialLoading={bootstrap.isLoading}
                  initialError={bootstrap.isError}
                  onInitialRetry={() => bootstrap.refetch()}
                />
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}
    </div>
  );
};

function EmptySelection() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-20 text-muted-foreground">
      <GitBranch className="size-10" />
      <p className="text-sm font-medium">{t('Choose a source project')}</p>
      <p className="text-xs">
        {t(
          'Select the test project you want to migrate from and run the precheck to see the differences.',
        )}
      </p>
    </div>
  );
}

type PrecheckSummaryBarProps = {
  summary?: ProjectMigrationPrecheckReport['summary'];
  isLoading: boolean;
  sourceProjectName: string;
  targetProjectName: string;
  snapshotToken: string | null;
  sourceProjectId: string;
  targetProjectId: string;
  canWriteRelease: boolean;
};

function PrecheckSummaryBar({
  summary,
  isLoading,
  sourceProjectName,
  targetProjectName,
  snapshotToken,
  sourceProjectId,
  targetProjectId,
  canWriteRelease,
}: PrecheckSummaryBarProps) {
  const { t } = useTranslation();
  if (isLoading || isNil(summary)) {
    return null;
  }
  const allTotals = Object.values(summary.totals);
  const totalCreate = allTotals.reduce((sum, c) => sum + c.create, 0);
  const totalUpdate = allTotals.reduce((sum, c) => sum + c.update, 0);
  const totalDelete = allTotals.reduce((sum, c) => sum + c.delete, 0);
  const totalNoChange = allTotals.reduce((sum, c) => sum + c.noChange, 0);
  const totalBlocked = allTotals.reduce((sum, c) => sum + c.blocked, 0);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{sourceProjectName}</span>
        <ArrowRight className="size-4 text-muted-foreground" />
        <span className="font-medium">{targetProjectName}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <CountPill
          label={t('Create')}
          count={totalCreate}
          status={ProjectMigrationOperationStatus.WILL_CREATE}
        />
        <CountPill
          label={t('Update')}
          count={totalUpdate}
          status={ProjectMigrationOperationStatus.WILL_UPDATE}
        />
        <CountPill
          label={t('Delete')}
          count={totalDelete}
          status={ProjectMigrationOperationStatus.WILL_DELETE}
        />
        <CountPill
          label={t('No change')}
          count={totalNoChange}
          status={ProjectMigrationOperationStatus.NO_CHANGE}
        />
        {totalBlocked > 0 && (
          <span className="rounded-full bg-destructive/15 px-2 py-1 font-medium text-destructive">
            {t('{{count}} blocked', { count: totalBlocked })}
          </span>
        )}
        {canWriteRelease && snapshotToken && (
          <ContinueToReleaseButton
            snapshotToken={snapshotToken}
            sourceProjectId={sourceProjectId}
            targetProjectId={targetProjectId}
            hasBlockers={summary.hasBlockers}
          />
        )}
      </div>
    </div>
  );
}

function CountPill({
  label,
  count,
  status,
}: {
  label: string;
  count: number;
  status: ProjectMigrationOperationStatus;
}) {
  const colors: Record<ProjectMigrationOperationStatus, string> = {
    [ProjectMigrationOperationStatus.WILL_CREATE]: 'bg-success/15 text-success',
    [ProjectMigrationOperationStatus.WILL_UPDATE]: 'bg-warning/15 text-warning',
    [ProjectMigrationOperationStatus.WILL_DELETE]:
      'bg-destructive/15 text-destructive',
    [ProjectMigrationOperationStatus.NO_CHANGE]:
      'bg-muted text-muted-foreground',
  };
  return (
    <span className={`rounded-full px-2 py-1 font-medium ${colors[status]}`}>
      {label}: {count}
    </span>
  );
}
