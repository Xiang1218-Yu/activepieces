import { SeekPage } from '@activepieces/core-utils';
import {
  CreateFailureRoutingRuleRequestBody,
  FailureDelivery,
  FailureRoutingRule,
  ListFailureDeliveriesRequest,
  ListFailureRoutingRulesRequest,
  UpdateFailureRoutingRuleRequestBody,
} from '@activepieces/shared';

import { api } from '@/lib/api';

const BASE_URL = '/v1/failure-routing/rules';

export const failureRoutingApi = {
  list(
    request: ListFailureRoutingRulesRequest,
  ): Promise<SeekPage<FailureRoutingRule>> {
    return api.get<SeekPage<FailureRoutingRule>>(BASE_URL, request);
  },

  create(
    request: CreateFailureRoutingRuleRequestBody,
  ): Promise<FailureRoutingRule> {
    return api.post<FailureRoutingRule>(BASE_URL, request);
  },

  update(
    ruleId: string,
    projectId: string,
    request: UpdateFailureRoutingRuleRequestBody,
  ): Promise<FailureRoutingRule> {
    return api.patch<FailureRoutingRule>(
      `${BASE_URL}/${ruleId}`,
      request,
      { projectId },
    );
  },

  delete(ruleId: string, projectId: string): Promise<void> {
    return api.delete<void>(`${BASE_URL}/${ruleId}`, { projectId });
  },

  listDeliveries(
    request: ListFailureDeliveriesRequest,
  ): Promise<SeekPage<FailureDelivery>> {
    return api.get<SeekPage<FailureDelivery>>(
      `${BASE_URL}/deliveries`,
      request,
    );
  },
};
