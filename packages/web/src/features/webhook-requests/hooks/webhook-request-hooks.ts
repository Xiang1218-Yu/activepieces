import { ListWebhookRequestCapturesRequestQuery } from '@activepieces/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { webhookRequestsApi } from '../api/webhook-requests-api';

export const webhookRequestHooks = {
  useCaptures: (request: ListWebhookRequestCapturesRequestQuery) => {
    return useQuery({
      queryKey: ['webhook-requests', request],
      queryFn: () => webhookRequestsApi.list(request),
      staleTime: 5_000,
    });
  },
  useCapture: (id: string | undefined, projectId: string | undefined) => {
    return useQuery({
      queryKey: ['webhook-request', id, projectId],
      enabled: !!id && !!projectId,
      queryFn: () => webhookRequestsApi.get(id!, projectId!),
    });
  },
  useRetentionDays: (projectId: string | undefined) => {
    return useQuery({
      queryKey: ['webhook-requests-retention', projectId],
      enabled: !!projectId,
      queryFn: () => webhookRequestsApi.getRetentionDays(projectId!),
    });
  },
  useCopyAsTestInput: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
        webhookRequestsApi.copyAsTestInput(id, projectId),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['webhook-request'] });
      },
    });
  },
};
