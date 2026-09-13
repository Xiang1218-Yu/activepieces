import { SeekPage } from '@activepieces/core-utils';
import {
  AppConnectionOwners,
  ListVariablesRequestQuery,
  RevealVariableResponse,
  UpdateVariableRequestBody,
  UpsertVariableRequestBody,
  VariableListItem,
  VariableWithoutSensitiveData,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const variablesApi = {
  list(
    request: ListVariablesRequestQuery,
  ): Promise<SeekPage<VariableListItem>> {
    return api.get<SeekPage<VariableListItem>>('/v1/variables', request);
  },
  create(
    request: UpsertVariableRequestBody,
  ): Promise<VariableWithoutSensitiveData> {
    return api.post<VariableWithoutSensitiveData>('/v1/variables', request);
  },
  update(
    id: string,
    request: UpdateVariableRequestBody,
  ): Promise<VariableWithoutSensitiveData> {
    return api.post<VariableWithoutSensitiveData>(
      `/v1/variables/${id}`,
      request,
    );
  },
  delete(id: string): Promise<void> {
    return api.delete<void>(`/v1/variables/${id}`);
  },
  reveal(id: string): Promise<RevealVariableResponse> {
    return api.post<RevealVariableResponse>(`/v1/variables/${id}/reveal`, {});
  },
  getOwners(request: {
    projectId: string;
  }): Promise<SeekPage<AppConnectionOwners>> {
    return api.get<SeekPage<AppConnectionOwners>>(
      '/v1/variables/owners',
      request,
    );
  },
};
