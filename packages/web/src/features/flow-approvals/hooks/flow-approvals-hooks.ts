import {
  ApprovalSlaPolicy,
  FlowApprovalRequest,
  FlowApprovalRequestState,
  Permission,
  PopulatedFlowApprovalRequest,
  RejectFlowApprovalRequestBody,
  UpsertApprovalSlaPolicyRequestBody,
} from '@activepieces/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { toast } from 'sonner';

import { projectCollectionUtils } from '@/features/projects/stores/project-collection';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { platformHooks } from '@/hooks/platform-hooks';
import { authenticationSession } from '@/lib/authentication-session';

import {
  approvalSlaPolicyApi,
  flowApprovalsApi,
} from '../api/flow-approvals-api';

const PENDING_BADGE_PROBE_LIMIT = 11;

export const flowApprovalsHooks = {
  useListApprovals: ({
    cursor,
    limit,
    state,
    overdue,
    refetchInterval,
  }: {
    cursor?: string;
    limit?: number;
    state?: FlowApprovalRequestState;
    overdue?: boolean;
    refetchInterval?: number;
  }) => {
    const { platform } = platformHooks.useCurrentPlatform();
    const projectId = authenticationSession.getProjectId();
    return useQuery({
      queryKey: [
        'flow-approval-requests',
        projectId,
        state ?? 'ALL',
        overdue ? 'OVERDUE' : 'ALL',
        cursor ?? null,
        limit ?? null,
      ],
      queryFn: () =>
        flowApprovalsApi.list({
          state,
          cursor,
          limit,
          overdue,
          projectId: projectId ?? undefined,
        }),
      enabled: !!projectId && platform.plan.environmentsEnabled,
      refetchInterval,
      meta: { showErrorDialog: true, loadSubsetOptions: {} },
    });
  },
  useApproval: (id: string | undefined) => {
    const { platform } = platformHooks.useCurrentPlatform();
    return useQuery({
      queryKey: ['flow-approval-requests', 'detail', id],
      queryFn: () => flowApprovalsApi.get(id!),
      enabled: !!id && platform.plan.environmentsEnabled,
      refetchInterval: 30_000,
    });
  },
  usePendingApprovalsBadge: () => {
    const { platform } = platformHooks.useCurrentPlatform();
    const { project } = projectCollectionUtils.useCurrentProject();
    const { checkAccess } = useAuthorization();
    const projectId = authenticationSession.getProjectId();
    const canApprove = checkAccess(Permission.PUBLISH_SENSITIVE_FLOW_ACCESS);
    return useQuery({
      queryKey: ['flow-approval-requests', 'badge', projectId],
      queryFn: () =>
        flowApprovalsApi.list({
          state: FlowApprovalRequestState.PENDING,
          limit: PENDING_BADGE_PROBE_LIMIT,
          projectId: projectId ?? undefined,
        }),
      enabled:
        !!projectId &&
        platform.plan.environmentsEnabled &&
        canApprove &&
        !!project.sensitive,
    });
  },
  useApprovalForVersion: (flowVersionId: string | undefined) => {
    const { platform } = platformHooks.useCurrentPlatform();
    const projectId = authenticationSession.getProjectId();
    return useQuery({
      queryKey: ['flow-approval-requests', 'version', flowVersionId, projectId],
      queryFn: async () => {
        const page = await flowApprovalsApi.list({
          projectId: projectId ?? undefined,
          flowVersionId,
          limit: 1,
        });
        return page.data[0] ?? null;
      },
      enabled:
        !!flowVersionId && !!projectId && platform.plan.environmentsEnabled,
      refetchInterval: 30_000,
    });
  },
  useApprove: () => {
    const queryClient = useQueryClient();
    return useMutation<PopulatedFlowApprovalRequest, Error, string>({
      mutationFn: (id) => flowApprovalsApi.approve(id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['flow-approval-requests'] });
        queryClient.invalidateQueries({ queryKey: ['flows'] });
        toast.success(t('Approved successfully'));
      },
    });
  },
  useReject: () => {
    const queryClient = useQueryClient();
    return useMutation<
      PopulatedFlowApprovalRequest,
      Error,
      { id: string; body: RejectFlowApprovalRequestBody }
    >({
      mutationFn: ({ id, body }) => flowApprovalsApi.reject(id, body),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['flow-approval-requests'] });
        toast.success(t('Rejected successfully'));
      },
    });
  },
  useWithdraw: () => {
    const queryClient = useQueryClient();
    return useMutation<void, Error, string>({
      mutationFn: (id) => flowApprovalsApi.withdraw(id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['flow-approval-requests'] });
        queryClient.invalidateQueries({ queryKey: ['flows'] });
        toast.success(t('Withdrawn successfully'));
      },
    });
  },
  usePause: () => {
    const queryClient = useQueryClient();
    return useMutation<PopulatedFlowApprovalRequest, Error, string>({
      mutationFn: (id) => flowApprovalsApi.pause(id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['flow-approval-requests'] });
        toast.success(t('Approval SLA paused'));
      },
    });
  },
  useResume: () => {
    const queryClient = useQueryClient();
    return useMutation<PopulatedFlowApprovalRequest, Error, string>({
      mutationFn: (id) => flowApprovalsApi.resume(id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['flow-approval-requests'] });
        toast.success(t('Approval SLA resumed'));
      },
    });
  },
};

export const approvalSlaPolicyHooks = {
  usePolicy: () => {
    const { platform } = platformHooks.useCurrentPlatform();
    const projectId = authenticationSession.getProjectId();
    return useQuery({
      queryKey: ['approval-sla-policy', projectId],
      queryFn: () => approvalSlaPolicyApi.get(projectId!),
      enabled: !!projectId && platform.plan.environmentsEnabled,
    });
  },
  useUpsertPolicy: () => {
    const queryClient = useQueryClient();
    const projectId = authenticationSession.getProjectId();
    return useMutation<
      ApprovalSlaPolicy,
      Error,
      UpsertApprovalSlaPolicyRequestBody
    >({
      mutationFn: (body) => approvalSlaPolicyApi.upsert(projectId!, body),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['approval-sla-policy'] });
        toast.success(t('Approval SLA policy saved'));
      },
    });
  },
  useDeletePolicy: () => {
    const queryClient = useQueryClient();
    const projectId = authenticationSession.getProjectId();
    return useMutation<void, Error, void>({
      mutationFn: async () => {
        await approvalSlaPolicyApi.delete(projectId!);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['approval-sla-policy'] });
        toast.success(t('Approval SLA policy removed'));
      },
    });
  },
};

export type { FlowApprovalRequest };
