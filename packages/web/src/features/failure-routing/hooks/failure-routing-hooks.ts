import {
  CreateFailureRoutingRuleRequestBody,
  FailureDelivery,
  FailureRoutingRule,
  ListFailureDeliveriesRequest,
  UpdateFailureRoutingRuleRequestBody,
} from '@activepieces/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { t } from 'i18next';
import { toast } from 'sonner';

import { internalErrorToast } from '@/components/ui/sonner';
import { authenticationSession } from '@/lib/authentication-session';

import { failureRoutingApi } from '../api/failure-routing-api';

const failureRoutingQueryKey = (projectId: string) => [
  'failure-routing-rules',
  projectId,
];

const deliveriesQueryKey = (
  projectId: string,
  filters?: { ruleId?: string; flowRunId?: string; status?: string },
) => ['failure-routing-deliveries', projectId, filters ?? {}];

export const failureRoutingQueries = {
  useRules: () => {
    const projectId = authenticationSession.getProjectId()!;
    return useQuery({
      queryKey: failureRoutingQueryKey(projectId),
      queryFn: () =>
        failureRoutingApi.list({ projectId, cursor: undefined, limit: 100 }),
      placeholderData: keepPreviousData,
      staleTime: 10_000,
    });
  },

  useDeliveries: (
    filters: Omit<ListFailureDeliveriesRequest, 'projectId'> = {},
    enabled = true,
  ) => {
    const projectId = authenticationSession.getProjectId()!;
    return useQuery({
      enabled,
      queryKey: deliveriesQueryKey(projectId, filters),
      queryFn: () =>
        failureRoutingApi.listDeliveries({ ...filters, projectId }),
      placeholderData: keepPreviousData,
      staleTime: 5_000,
    });
  },
};

export const failureRoutingMutations = {
  useCreateRule: () => {
    const queryClient = useQueryClient();
    const projectId = authenticationSession.getProjectId()!;
    return useMutation<
      FailureRoutingRule,
      Error,
      CreateFailureRoutingRuleRequestBody
    >({
      mutationFn: (request) => failureRoutingApi.create(request),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: failureRoutingQueryKey(projectId),
        });
        toast.success(t('Routing rule created.'));
      },
      onError: () => internalErrorToast(),
    });
  },

  useUpdateRule: () => {
    const queryClient = useQueryClient();
    const projectId = authenticationSession.getProjectId()!;
    return useMutation<
      FailureRoutingRule,
      Error,
      { ruleId: string; request: UpdateFailureRoutingRuleRequestBody }
    >({
      mutationFn: ({ ruleId, request }) =>
        failureRoutingApi.update(ruleId, projectId, request),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: failureRoutingQueryKey(projectId),
        });
        toast.success(t('Routing rule updated.'));
      },
      onError: () => internalErrorToast(),
    });
  },

  useDeleteRule: () => {
    const queryClient = useQueryClient();
    const projectId = authenticationSession.getProjectId()!;
    return useMutation<void, Error, FailureRoutingRule>({
      mutationFn: (rule) => failureRoutingApi.delete(rule.id, projectId),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: failureRoutingQueryKey(projectId),
        });
        void queryClient.invalidateQueries({
          queryKey: deliveriesQueryKey(projectId),
        });
        toast.success(t('Routing rule deleted.'));
      },
      onError: () => internalErrorToast(),
    });
  },
};

export type { FailureDelivery };
