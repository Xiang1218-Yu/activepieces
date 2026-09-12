import { isNil } from '@activepieces/core-utils';
import { useQuery } from '@tanstack/react-query';

import { authenticationSession } from '@/lib/authentication-session';

import { dependencyGraphApi } from '../api/dependency-graph-api';

export const dependencyGraphQueries = {
  useProjectDependencyGraph: () => {
    const projectId = authenticationSession.getProjectId();
    return useQuery({
      queryKey: ['project-dependency-graph', projectId],
      queryFn: () => dependencyGraphApi.get({ projectId: projectId! }),
      enabled: !isNil(projectId),
    });
  },
};
