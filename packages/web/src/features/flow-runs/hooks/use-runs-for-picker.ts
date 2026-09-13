import { FlowRun, SeekPage } from '@activepieces/shared';
import { useInfiniteQuery } from '@tanstack/react-query';

import { flowRunsApi } from '../api/flow-runs-api';

const PAGE_LIMIT = 50;

type UseRunsForPickerParams = {
  projectId: string;
  flowId: string[];
  tags: string[];
  createdAfter: string;
  createdBefore: string;
  failedStepMessage?: string;
};

function useRunsForPicker(params: UseRunsForPickerParams) {
  return useInfiniteQuery<SeekPage<FlowRun>, Error>({
    queryKey: ['flow-run-picker', params],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      flowRunsApi.list({
        projectId: params.projectId,
        flowId: params.flowId,
        tags: params.tags,
        createdAfter: params.createdAfter,
        createdBefore: params.createdBefore,
        failedStepMessage: params.failedStepMessage,
        cursor: pageParam ?? undefined,
        limit: PAGE_LIMIT,
      }),
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });
}

export { useRunsForPicker };
