import {
  FormAnalyticsResponse,
  FormSessionAttribution,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const formAnalyticsApi = {
  list: (params: FormAnalyticsParams) => {
    return api.get<FormAnalyticsResponse>(
      '/v1/form-analytics',
      removeUndefined(params),
    );
  },
};

export type FormAnalyticsParams = {
  projectId: string;
  flowId?: string;
  flowVersionId?: string;
  createdAfter?: string;
  createdBefore?: string;
  attribution?: FormSessionAttribution;
};

function removeUndefined<T extends Record<string, unknown>>(
  obj: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  );
}
