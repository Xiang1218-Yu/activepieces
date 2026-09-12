import {
  ProjectMigrationPrecheckReport,
  ProjectMigrationPrecheckRequest,
  ProjectMigrationResourceType,
} from '@activepieces/shared';
import {
  InfiniteData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';

import { authenticationSession } from '@/lib/authentication-session';

import { projectMigrationApi } from '../api/project-migration-api';

const PAGE_LIMIT = 20;

type UseMigrationPrecheckBootstrapParams = {
  sourceProjectId: string | null;
  targetProjectId: string | null;
  enabled: boolean;
};

type PageParam = {
  cursor: string | null;
};

export function useMigrationPrecheckBootstrap({
  sourceProjectId,
  targetProjectId,
  enabled,
}: UseMigrationPrecheckBootstrapParams) {
  const currentProjectId = authenticationSession.getProjectId();
  return useQuery({
    queryKey: [
      'migration-precheck-bootstrap',
      sourceProjectId,
      targetProjectId,
    ] as const,
    enabled:
      enabled &&
      currentProjectId !== null &&
      sourceProjectId !== null &&
      targetProjectId !== null &&
      sourceProjectId !== targetProjectId,
    queryFn: (): Promise<ProjectMigrationPrecheckReport> => {
      const request: ProjectMigrationPrecheckRequest = {
        projectId: currentProjectId!,
        sourceProjectId,
        snapshotToken: null,
        resourceType: ProjectMigrationResourceType.FLOW,
        cursor: null,
        limit: PAGE_LIMIT,
      };
      return projectMigrationApi.precheck(request);
    },
  });
}

type UseMigrationResourcePageParams = {
  snapshotToken: string | null;
  resourceType: ProjectMigrationResourceType;
  initialData?: InfiniteData<ProjectMigrationPrecheckReport, PageParam>;
  enabled?: boolean;
};

export function useMigrationResourcePage({
  snapshotToken,
  resourceType,
  initialData,
  enabled = true,
}: UseMigrationResourcePageParams) {
  const currentProjectId = authenticationSession.getProjectId();
  return useInfiniteQuery({
    queryKey: ['migration-precheck-page', snapshotToken, resourceType] as const,
    enabled: enabled && snapshotToken !== null && currentProjectId !== null,
    initialData,
    initialPageParam: { cursor: null } satisfies PageParam,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: PageParam;
    }): Promise<ProjectMigrationPrecheckReport> => {
      const request: ProjectMigrationPrecheckRequest = {
        projectId: currentProjectId!,
        sourceProjectId: null,
        snapshotToken,
        resourceType,
        cursor: pageParam.cursor,
        limit: PAGE_LIMIT,
      };
      return projectMigrationApi.precheck(request);
    },
    getNextPageParam: (lastPage): PageParam | undefined => {
      if (lastPage.page.nextCursor === null) {
        return undefined;
      }
      return { cursor: lastPage.page.nextCursor ?? null };
    },
  });
}
