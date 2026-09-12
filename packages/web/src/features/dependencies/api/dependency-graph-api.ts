import {
  GetProjectDependencyGraphRequest,
  ProjectDependencyGraph,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const dependencyGraphApi = {
  get(
    request: GetProjectDependencyGraphRequest,
  ): Promise<ProjectDependencyGraph> {
    return api.get<ProjectDependencyGraph>('/v1/dependency-graph', request);
  },
};
