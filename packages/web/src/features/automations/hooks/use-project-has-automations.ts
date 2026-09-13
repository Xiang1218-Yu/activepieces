import { useQueries } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { useEmbedding } from '@/components/providers/embed-provider';
import { flowsApi } from '@/features/flows/api/flows-api';
import { tablesApi } from '@/features/tables/api/tables-api';
import { authenticationSession } from '@/lib/authentication-session';

export function useProjectHasAutomations(enabled: boolean) {
  const { projectId: projectIdFromUrl } = useParams<{ projectId: string }>();
  const projectId = projectIdFromUrl ?? authenticationSession.getProjectId()!;
  const { embedState } = useEmbedding();

  const [flowsCount, tablesCount] = useQueries({
    queries: [
      {
        queryKey: ['automations-probe-flows', projectId],
        queryFn: () => flowsApi.count({ projectId }),
        enabled,
        staleTime: PROBE_STALE_TIME,
      },
      {
        queryKey: ['automations-probe-tables', projectId],
        queryFn: () => tablesApi.count({ projectId }),
        enabled: enabled && !embedState.hideTables,
        staleTime: PROBE_STALE_TIME,
      },
    ],
  });

  const isLoading =
    (flowsCount.isLoading && enabled) ||
    (!embedState.hideTables && enabled && tablesCount.isLoading);
  const hasAutomations =
    (flowsCount.data ?? 0) > 0 ||
    (!embedState.hideTables && (tablesCount.data ?? 0) > 0);

  return { hasAutomations, isLoading };
}

const PROBE_STALE_TIME = 30_000;
