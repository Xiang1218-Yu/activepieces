import { FormAnalyticsRow } from '@activepieces/shared';
import { useQuery } from '@tanstack/react-query';

import { formAnalyticsApi, FormAnalyticsParams } from '../api/form-analytics-api';

export const formAnalyticsKeys = {
  all: ['form-analytics'] as const,
  list: (params: FormAnalyticsParams) =>
    [...formAnalyticsKeys.all, 'list', params] as const,
};

export const formAnalyticsHooks = {
  useFunnel: (params: FormAnalyticsParams) => {
    return useQuery<FormAnalyticsRow[], Error>({
      queryKey: formAnalyticsKeys.list(params),
      queryFn: async () => {
        const response = await formAnalyticsApi.list(params);
        return response.data;
      },
      enabled: params.createdAfter !== undefined,
      staleTime: 30_000,
    });
  },
};
