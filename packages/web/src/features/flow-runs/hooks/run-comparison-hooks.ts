import {
  CompareFlowRunsResponse,
  FailureRateAggregationInterval,
  FailureRateAggregationResponse,
} from '@activepieces/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { authenticationSession } from '@/lib/authentication-session';

import { flowRunsApi } from '../api/flow-runs-api';

function useCompareRuns(flowRunIds: string[]) {
  const projectId = authenticationSession.getProjectId()!;
  return useQuery<CompareFlowRunsResponse, Error>({
    queryKey: ['flow-run-compare', projectId, flowRunIds],
    queryFn: () =>
      flowRunsApi.compare({
        projectId,
        flowRunIds,
      }),
    enabled: flowRunIds.length > 0 && flowRunIds.length <= 10,
  });
}

type UseFailureRateParams = {
  flowId: string[];
  tags: string[];
  createdAfter: string;
  createdBefore: string;
  interval: FailureRateAggregationInterval;
  limit?: number;
  enabled?: boolean;
};

function useFailureRate({
  flowId,
  tags,
  createdAfter,
  createdBefore,
  interval,
  limit = 31,
  enabled = true,
}: UseFailureRateParams) {
  const projectId = authenticationSession.getProjectId()!;
  return useInfiniteQuery<FailureRateAggregationResponse, Error>({
    queryKey: [
      'flow-run-failure-rate',
      projectId,
      flowId,
      tags,
      createdAfter,
      createdBefore,
      interval,
      limit,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      flowRunsApi.failureRate({
        projectId,
        flowId,
        tags,
        createdAfter,
        createdBefore,
        interval,
        limit,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
    enabled,
  });
}

export const runComparisonHooks = {
  useCompareRuns,
  useFailureRate,
};
