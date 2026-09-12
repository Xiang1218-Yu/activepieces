import {
  AuditLogExport,
  AuditLogExportFormat,
  AuditLogExportStatus,
  CreateAuditLogExportRequest,
} from '@activepieces/shared';
import { t } from 'i18next';
import { Download, FileSpreadsheet, FileJson, Loader } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { FormattedDate } from '@/components/custom/formatted-date';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { auditLogExportHooks } from '@/features/platform-admin/hooks/audit-log-export-hooks';

type AuditLogExportDialogProps = {
  children: React.ReactNode;
};

export function AuditLogExportDialog({ children }: AuditLogExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const [format, setFormat] = useState<AuditLogExportFormat>(
    AuditLogExportFormat.CSV,
  );
  const { data: exportsPage, refetch } = auditLogExportHooks.useExports();
  const { mutate: createExport, isPending } =
    auditLogExportHooks.useCreateExport();
  const { mutateAsync: requestDownloadLink, isPending: isLinkPending } =
    auditLogExportHooks.useRequestDownloadLink();

  const exports = exportsPage?.data ?? [];

  const buildRequest = (
    selectedFormat: AuditLogExportFormat,
  ): CreateAuditLogExportRequest => {
    return {
      format: selectedFormat,
      projectId: searchParams.getAll('projectId') ?? undefined,
      action: searchParams.getAll('action') ?? undefined,
      userId: searchParams.get('userId') ?? undefined,
      createdAfter: searchParams.get('createdAfter') ?? undefined,
      createdBefore: searchParams.get('createdBefore') ?? undefined,
    };
  };

  const handleCreate = () => {
    createExport(buildRequest(format), {
      onSuccess: () => {
        void refetch();
      },
    });
  };

  const handleDownload = async (id: string) => {
    const { downloadUrl } = await requestDownloadLink(id);
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  };

  const activeFilterCount = [
    searchParams.getAll('projectId').length,
    searchParams.getAll('action').length,
    searchParams.get('userId') ? 1 : 0,
    searchParams.get('createdAfter') ? 1 : 0,
    searchParams.get('createdBefore') ? 1 : 0,
  ].reduce((sum, count) => sum + count, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Export Audit Logs')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {activeFilterCount > 0
              ? t(
                  'The export is generated in the background using the {{count}} active filters. You will be able to download it once it is ready.',
                  { count: activeFilterCount },
                )
              : t(
                  'The export is generated in the background and includes all audit events for the platform. Apply filters on this page first to narrow the result.',
                )}
          </p>
          <div className="grid gap-2">
            <Label>{t('File Format')}</Label>
            <RadioGroup
              value={format}
              onValueChange={(value) =>
                setFormat(value as AuditLogExportFormat)
              }
              className="grid grid-cols-2 gap-3"
            >
              <Label
                htmlFor="format-csv"
                className="flex cursor-pointer items-center gap-2 rounded-md border p-3 [&:has(:checked)]:border-primary"
              >
                <RadioGroupItem
                  id="format-csv"
                  value={AuditLogExportFormat.CSV}
                  className="sr-only"
                />
                <FileSpreadsheet className="size-4 text-muted-foreground" />
                <span>CSV</span>
              </Label>
              <Label
                htmlFor="format-json"
                className="flex cursor-pointer items-center gap-2 rounded-md border p-3 [&:has(:checked)]:border-primary"
              >
                <RadioGroupItem
                  id="format-json"
                  value={AuditLogExportFormat.JSON}
                  className="sr-only"
                />
                <FileJson className="size-4 text-muted-foreground" />
                <span>JSON</span>
              </Label>
            </RadioGroup>
          </div>
          <Separator />
          <div className="flex flex-col gap-2">
            <Label>{t('Recent Exports')}</Label>
            {exports.length === 0 && (
              <span className="text-sm text-muted-foreground">
                {t('No exports yet')}
              </span>
            )}
            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
              {exports.map((item) => (
                <ExportRow
                  key={item.id}
                  item={item}
                  isLinkPending={isLinkPending}
                  onDownload={handleDownload}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('Close')}
          </Button>
          <Button loading={isPending} onClick={handleCreate}>
            {t('Start Export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ExportRowProps = {
  item: AuditLogExport;
  isLinkPending: boolean;
  onDownload: (id: string) => void;
};

function ExportRow({ item, isLinkPending, onDownload }: ExportRowProps) {
  const isInProgress =
    item.status === AuditLogExportStatus.PENDING ||
    item.status === AuditLogExportStatus.RUNNING;

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">
          {item.fileName ?? `${item.format.toUpperCase()} ${t('export')}`}
        </span>
        <span className="text-xs text-muted-foreground">
          <FormattedDate date={new Date(item.created)} />
          {item.status === AuditLogExportStatus.COMPLETED &&
            ` · ${item.eventCount} ${t('events')}`}
          {item.status === AuditLogExportStatus.FAILED &&
            ` · ${t('Failed')}: ${item.errorMessage ?? t('Unknown error')}`}
        </span>
      </div>
      {isInProgress ? (
        <Loader className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : item.status === AuditLogExportStatus.COMPLETED ? (
        <Button
          size="sm"
          variant="ghost"
          loading={isLinkPending}
          onClick={() => onDownload(item.id)}
        >
          <Download className="size-4" />
        </Button>
      ) : (
        <span className="text-xs text-destructive">{t('Failed')}</span>
      )}
    </div>
  );
}
