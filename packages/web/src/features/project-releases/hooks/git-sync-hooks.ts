import { isNil, Permission } from '@activepieces/core-utils';
import {
  ConfigureRepoRequest,
  GitBranchType,
  GitPushOperation,
  GitPushOperationStatus,
  GitRepo,
  PushGitRepoRequest,
} from '@activepieces/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthorization } from '@/hooks/authorization-hooks';
import { platformHooks } from '@/hooks/platform-hooks';
import { authenticationSession } from '@/lib/authentication-session';

import { gitSyncApi } from '../api/git-sync-api';

const PUSH_OPERATION_POLL_INTERVAL_MS = 2000;

export const gitSyncHooks = {
  useGitSync: (projectId: string, enabled: boolean) => {
    const query = useQuery({
      queryKey: ['git-sync', projectId],
      queryFn: () => gitSyncApi.get(projectId),
      staleTime: Infinity,
      enabled: enabled,
    });
    return {
      gitSync: query.data,
      isLoading: query.isLoading,
      refetch: query.refetch,
    };
  },
  useLatestPushOperation: (projectId: string, enabled: boolean) => {
    return useQuery({
      queryKey: ['git-push-operation', 'latest', projectId],
      queryFn: () => gitSyncApi.getLatestPush(projectId),
      enabled,
      refetchInterval: (query) => {
        return query.state.data?.status === GitPushOperationStatus.IN_PROGRESS
          ? PUSH_OPERATION_POLL_INTERVAL_MS
          : false;
      },
      refetchOnWindowFocus: false,
      staleTime: 0,
    });
  },
  useShowPushToGit: () => {
    const { platform } = platformHooks.useCurrentPlatform();
    const { gitSync } = gitSyncHooks.useGitSync(
      authenticationSession.getProjectId()!,
      platform.plan.environmentsEnabled,
    );
    const userHasPermissionToPushToGit = useAuthorization().checkAccess(
      Permission.WRITE_PROJECT_RELEASE,
    );

    return (
      userHasPermissionToPushToGit &&
      !isNil(gitSync) &&
      gitSync.branchType === GitBranchType.DEVELOPMENT
    );
  },
};

export const gitSyncMutations = {
  useStartPush: ({
    onSuccess,
    onError,
  }: {
    onSuccess?: (operation: GitPushOperation) => void;
    onError?: (error: unknown) => void;
  } = {}) => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({
        gitSyncId,
        request,
      }: {
        gitSyncId: string;
        request: PushGitRepoRequest;
      }) => gitSyncApi.startPush(gitSyncId, request),
      onSuccess: (operation) => {
        const projectId = authenticationSession.getProjectId()!;
        queryClient.setQueryData(
          ['git-push-operation', 'latest', projectId],
          operation,
        );
        void queryClient.invalidateQueries({
          queryKey: ['git-push-operation', 'latest', projectId],
        });
        onSuccess?.(operation);
      },
      onError,
    });
  },
  useRetryPush: ({
    onSuccess,
  }: {
    onSuccess?: (operation: GitPushOperation) => void;
  } = {}) => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (operationId: string) => gitSyncApi.retryPush(operationId),
      onSuccess: (operation) => {
        const projectId = authenticationSession.getProjectId()!;
        queryClient.setQueryData(
          ['git-push-operation', 'latest', projectId],
          operation,
        );
        void queryClient.invalidateQueries({
          queryKey: ['git-push-operation', 'latest', projectId],
        });
        onSuccess?.(operation);
      },
    });
  },
  useConfigureGitSync: ({
    onSuccess,
    onError,
  }: {
    onSuccess: (repo: GitRepo) => void;
    onError: (error: unknown) => void;
  }) => {
    return useMutation({
      mutationFn: (request: ConfigureRepoRequest): Promise<GitRepo> => {
        return gitSyncApi.configure(request);
      },
      onSuccess,
      onError,
    });
  },
  useDisconnectGitSync: ({ onSuccess }: { onSuccess: () => void }) => {
    return useMutation({
      mutationFn: (gitSyncId: string) => {
        return gitSyncApi.disconnect(gitSyncId);
      },
      onSuccess,
    });
  },
};
