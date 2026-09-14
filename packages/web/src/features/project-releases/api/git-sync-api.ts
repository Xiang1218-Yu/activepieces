import { SeekPage } from '@activepieces/core-utils';
import {
  ConfigureRepoRequest,
  GitPushOperation,
  GitRepo,
  PushGitRepoRequest,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const gitSyncApi = {
  async get(projectId: string): Promise<GitRepo | null> {
    const response = await api.get<SeekPage<GitRepo>>(`/v1/git-repos`, {
      projectId,
    });
    if (response.data.length === 0) {
      return null;
    }
    return response.data[0];
  },
  configure(request: ConfigureRepoRequest) {
    return api.post<GitRepo>(`/v1/git-repos`, request);
  },
  disconnect(repoId: string) {
    return api.delete<void>(`/v1/git-repos/${repoId}`);
  },
  startPush(repoId: string, request: PushGitRepoRequest) {
    return api.post<GitPushOperation>(
      `/v1/git-repos/${repoId}/push-operations`,
      request,
    );
  },
  retryPush(operationId: string) {
    return api.post<GitPushOperation>(
      `/v1/git-repos/push-operations/${operationId}/retry`,
    );
  },
  getLatestPush(projectId: string) {
    return api.get<GitPushOperation | null>(
      `/v1/git-repos/push-operations/latest`,
      { projectId },
    );
  },
};
