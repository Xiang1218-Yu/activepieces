import {
  CreateTableViewRequest,
  ListTableViewsRequest,
  TableView,
  UpdateTableViewRequest,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const tableViewsApi = {
  list(request: ListTableViewsRequest): Promise<TableView[]> {
    return api.get<TableView[]>('/v1/table-views', request);
  },

  create(request: CreateTableViewRequest): Promise<TableView> {
    return api.post<TableView>('/v1/table-views', request);
  },

  getById(id: string): Promise<TableView> {
    return api.get<TableView>(`/v1/table-views/${id}`);
  },

  update(id: string, request: UpdateTableViewRequest): Promise<TableView> {
    return api.post<TableView>(`/v1/table-views/${id}`, request);
  },

  delete(id: string): Promise<void> {
    return api.delete<void>(`/v1/table-views/${id}`);
  },
};
