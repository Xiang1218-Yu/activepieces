import { SeekPage } from '@activepieces/core-utils';
import {
  ApplicationEvent,
  AuditLogExport,
  CreateAuditLogExportRequest,
  ListAuditEventsRequest,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const auditEventsApi = {
  list(request: ListAuditEventsRequest) {
    return api.get<SeekPage<ApplicationEvent>>('/v1/audit-events', request);
  },
  createExport(request: CreateAuditLogExportRequest) {
    return api.post<AuditLogExport>('/v1/audit-events/exports', request);
  },
  listExports() {
    return api.get<{ data: AuditLogExport[] }>('/v1/audit-events/exports');
  },
  getExport(id: string) {
    return api.get<AuditLogExport>(`/v1/audit-events/exports/${id}`);
  },
  createDownloadLink(id: string) {
    return api.post<{ downloadUrl: string; expiresAt: string }>(
      `/v1/audit-events/exports/${id}/download-link`,
      {},
    );
  },
};
