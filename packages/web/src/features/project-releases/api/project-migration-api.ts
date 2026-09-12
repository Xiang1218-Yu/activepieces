import {
  ProjectMigrationPrecheckReport,
  ProjectMigrationPrecheckRequest,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const projectMigrationApi = {
  async precheck(request: ProjectMigrationPrecheckRequest) {
    return await api.post<ProjectMigrationPrecheckReport>(
      '/v1/project-releases/migration-precheck',
      request,
    );
  },
};
