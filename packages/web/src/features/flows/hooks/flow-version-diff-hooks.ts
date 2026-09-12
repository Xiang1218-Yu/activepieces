import { useQuery } from '@tanstack/react-query';

import { flowsApi } from '../api/flows-api';

export const flowVersionDiffHooks = {
  useGetFlowVersionDiff: ({
    flowId,
    fromVersionId,
    toVersionId,
    enabled,
  }: {
    flowId: string;
    fromVersionId?: string;
    toVersionId?: string;
    enabled?: boolean;
  }) => {
    return useQuery({
      queryKey: ['flow-version-diff', flowId, fromVersionId, toVersionId],
      queryFn: async () => {
        return flowsApi.getVersionDiff(flowId, {
          fromVersionId: fromVersionId!,
          toVersionId: toVersionId!,
        });
      },
      enabled:
        enabled !== false &&
        !!flowId &&
        !!fromVersionId &&
        !!toVersionId &&
        fromVersionId !== toVersionId,
      staleTime: 0,
    });
  },
};
