import {
  ApprovalSlaPolicy,
  FlowApprovalRequest,
  FlowApprovalRequestState,
  ListFlowApprovalRequestsQuery,
  PopulatedFlowApprovalRequest,
  RejectFlowApprovalRequestBody,
  SeekPage,
  UpsertApprovalSlaPolicyRequestBody,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const flowApprovalsApi = {
  list(query: ListFlowApprovalRequestsQuery) {
    return api.get<SeekPage<PopulatedFlowApprovalRequest>>(
      '/v1/flow-approval-requests',
      query,
    );
  },
  get(id: string) {
    return api.get<PopulatedFlowApprovalRequest>(
      `/v1/flow-approval-requests/${id}`,
    );
  },
  approve(id: string) {
    return api.post<PopulatedFlowApprovalRequest>(
      `/v1/flow-approval-requests/${id}/approve`,
      {},
    );
  },
  reject(id: string, body: RejectFlowApprovalRequestBody) {
    return api.post<PopulatedFlowApprovalRequest>(
      `/v1/flow-approval-requests/${id}/reject`,
      body,
    );
  },
  withdraw(id: string) {
    return api.post<void>(`/v1/flow-approval-requests/${id}/withdraw`, {});
  },
  pause(id: string) {
    return api.post<PopulatedFlowApprovalRequest>(
      `/v1/flow-approval-requests/${id}/pause`,
      {},
    );
  },
  resume(id: string) {
    return api.post<PopulatedFlowApprovalRequest>(
      `/v1/flow-approval-requests/${id}/resume`,
      {},
    );
  },
};

export const approvalSlaPolicyApi = {
  get(projectId: string) {
    return api.get<ApprovalSlaPolicy | null>('/v1/approval-sla-policies', {
      projectId,
    });
  },
  upsert(projectId: string, body: UpsertApprovalSlaPolicyRequestBody) {
    return api.post<ApprovalSlaPolicy>('/v1/approval-sla-policies', body, {
      projectId,
    });
  },
  delete(projectId: string) {
    return api.delete('/v1/approval-sla-policies', { projectId });
  },
};

export type {
  ApprovalSlaPolicy,
  FlowApprovalRequest,
  FlowApprovalRequestState,
  PopulatedFlowApprovalRequest,
  UpsertApprovalSlaPolicyRequestBody,
};
