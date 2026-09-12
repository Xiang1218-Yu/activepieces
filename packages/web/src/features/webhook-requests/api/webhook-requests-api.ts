import { SeekPage } from '@activepieces/core-utils';
import {
  ListWebhookRequestCapturesRequestQuery,
  WebhookRequestCapture,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const webhookRequestsApi = {
  list(
    request: ListWebhookRequestCapturesRequestQuery,
  ): Promise<SeekPage<WebhookRequestCapture>> {
    return api.get<SeekPage<WebhookRequestCapture>>(
      '/v1/webhook-requests',
      request,
    );
  },
  get(id: string, projectId: string): Promise<WebhookRequestCapture> {
    return api.get<WebhookRequestCapture>(
      `/v1/webhook-requests/${id}`,
      { projectId },
    );
  },
  copyAsTestInput(
    id: string,
    projectId: string,
  ): Promise<{ copied: boolean; flowId: string }> {
    return api.post(`/v1/webhook-requests/${id}/copy-as-test-input`, {
      projectId,
    });
  },
  getRetentionDays(projectId: string): Promise<{ retentionDays: number }> {
    return api.get('/v1/webhook-requests/retention', { projectId });
  },
};
