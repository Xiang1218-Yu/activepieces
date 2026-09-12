import {
  AuditLogExportFormat,
  AuditLogExportStatus,
  CreateAuditLogExportRequest,
} from '@activepieces/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { auditEventsApi } from '../api/audit-events-api';

import { auditLogKeys } from './audit-log-hooks';

export const auditLogExportHooks = {
  useExports: () => {
    return useQuery({
      queryKey: auditLogKeys.exports(),
      staleTime: 5_000,
      refetchInterval: (query) => {
        const exports = query.state.data;
        if (
          exports?.data.some(
            (item) =>
              item.status === AuditLogExportStatus.PENDING ||
              item.status === AuditLogExportStatus.RUNNING,
          )
        ) {
          return 3_000;
        }
        return false;
      },
      queryFn: async () => auditEventsApi.listExports(),
    });
  },
  useCreateExport: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (request: CreateAuditLogExportRequest) => {
        return auditEventsApi.createExport(request);
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: auditLogKeys.exports(),
        });
      },
    });
  },
  useRequestDownloadLink: () => {
    return useMutation({
      mutationFn: async (id: string) => auditEventsApi.createDownloadLink(id),
    });
  },
};

export { AuditLogExportFormat };
