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
  return useQuery({
    queryKey: [
      'migration-precheck-bootstrap',
      sourceProjectId,
      targetProjectId,
    ] as const,
    enabled:
      enabled &&
      sourceProjectId !== null &&
      targetProjectId !== null &&
      sourceProjectId !== targetProjectId,
    queryFn: (): Promise<ProjectMigrationPrecheckReport> => {
      const request: ProjectMigrationPrecheckRequest = {
        projectId: targetProjectId!,
        sourceProjectId,
        targetProjectId: targetProjectId!,
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
  targetProjectId: string | null;
  resourceType: ProjectMigrationResourceType;
  initialData?: InfiniteData<
    ProjectMigrationPrecheckReport,
    { cursor: string | null }
  >;
  enabled?: boolean;
};

export function useMigrationResourcePage({
  snapshotToken,
  targetProjectId,
  resourceType,
  initialData,
  enabled = true,
}: UseMigrationResourcePageParams) {
  return useInfiniteQuery({
    queryKey: ['migration-precheck-page', snapshotToken, resourceType] as const,
    enabled: enabled && snapshotToken !== null && targetProjectId !== null,
    initialData,
    initialPageParam: { cursor: null } satisfies PageParam,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: PageParam;
    }): Promise<ProjectMigrationPrecheckReport> => {
      const request: ProjectMigrationPrecheckRequest = {
        projectId: targetProjectId!,
        sourceProjectId: null,
        targetProjectId: targetProjectId!,
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
