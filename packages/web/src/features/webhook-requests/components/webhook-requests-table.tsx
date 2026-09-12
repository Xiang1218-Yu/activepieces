import { t } from 'i18next';
import { Fragment, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  History,
  Paperclip,
  ShieldAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WebhookRequestBodyKind, WebhookRequestCapture } from '@activepieces/shared';
import { formatUtils } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

import { webhookRequestUtils } from '../utils/webhook-request-utils';

const BODY_KIND_BADGE: Record<WebhookRequestBodyKind, string> = {
  [WebhookRequestBodyKind.JSON]: 'JSON',
  [WebhookRequestBodyKind.FORM]: 'form',
  [WebhookRequestBodyKind.TEXT]: 'text',
  [WebhookRequestBodyKind.MULTIPART]: 'multipart',
  [WebhookRequestBodyKind.BINARY]: 'binary',
  [WebhookRequestBodyKind.XML]: 'XML',
  [WebhookRequestBodyKind.EMPTY]: 'empty',
  [WebhookRequestBodyKind.UNKNOWN]: 'unknown',
};

export type FlowNameLookup = (flowId: string) => string | undefined;

type WebhookRequestsTableProps = {
  captures: WebhookRequestCapture[];
  isLoading: boolean;
  flowName: FlowNameLookup;
  onOpen: (capture: WebhookRequestCapture) => void;
};

export const WebhookRequestsTable = ({
  captures,
  isLoading,
  flowName,
  onOpen,
}: WebhookRequestsTableProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const rows = useMemo(() => captures, [captures]);

  if (!isLoading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <History className="size-12" />
        <div className="text-sm font-medium">{t('No webhook requests captured')}</div>
        <div className="text-sm max-w-md text-center">
          {t(
            'Incoming webhook requests will appear here with redacted headers, query parameters, body type and uploaded file metadata.',
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead className="w-[180px]">{t('Time')}</TableHead>
            <TableHead className="w-[80px]">{t('Method')}</TableHead>
            <TableHead>{t('Flow')}</TableHead>
            <TableHead className="w-[110px]">{t('Body')}</TableHead>
            <TableHead className="w-[110px]">{t('Status')}</TableHead>
            <TableHead className="w-[200px]">{t('Request ID')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                {t('Loading…')}
              </TableCell>
            </TableRow>
          )}
          {rows.map((capture) => {
            const isOpen = expanded.has(capture.id);
            const fileCount = capture.body.files?.length ?? 0;
            return (
              <Fragment key={capture.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => onOpen(capture)}
                >
                  <TableCell onClick={(e) => {
                    e.stopPropagation();
                    toggle(capture.id);
                  }}>
                    <Button variant="ghost" size="icon" className="size-6">
                      {isOpen ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatUtils.formatDate(new Date(capture.created))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {capture.method}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {flowName(capture.flowId) ?? capture.flowId}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-xs">
                        {BODY_KIND_BADGE[capture.body.kind]}
                      </Badge>
                      {fileCount > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Paperclip className="size-3" />
                          {fileCount}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={capture.responseStatus} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {capture.requestId}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted/40">
                    <TableCell />
                    <TableCell colSpan={6}>
                      <ExpandedPreview capture={capture} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

const ExpandedPreview = ({ capture }: { capture: WebhookRequestCapture }) => {
  const headerKeys = Object.keys(capture.headers);
  const queryKeys = Object.keys(capture.queryParams);
  return (
    <div className="grid grid-cols-3 gap-4 py-2 text-xs">
      <PreviewColumn title={t('Headers')} count={headerKeys.length}>
        {headerKeys.slice(0, 6).map((key) => (
          <div key={key} className="truncate font-mono">
            <span className="text-muted-foreground">{key}:</span>{' '}
            {capture.headers[key]?.[0]}
          </div>
        ))}
      </PreviewColumn>
      <PreviewColumn title={t('Query')} count={queryKeys.length}>
        {queryKeys.slice(0, 6).map((key) => (
          <div key={key} className="truncate font-mono">
            <span className="text-muted-foreground">{key}:</span>{' '}
            {capture.queryParams[key]?.[0]}
          </div>
        ))}
      </PreviewColumn>
      <PreviewColumn
        title={t('Files')}
        count={capture.body.files?.length ?? 0}
        icon={<FileIcon className="size-3" />}
      >
        {(capture.body.files ?? []).slice(0, 4).map((file, index) => (
          <div key={`${file.fieldName}-${index}`} className="truncate font-mono">
            {file.fileName ?? file.fieldName} ({webhookRequestUtils.formatBytes(file.size)})
          </div>
        ))}
      </PreviewColumn>
      {capture.body.truncated && (
        <div className="col-span-3">
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            <ShieldAlert className="size-3 mr-1" />
            {t('Body exceeded storage preview limit and was truncated')}
          </Badge>
        </div>
      )}
    </div>
  );
};

const PreviewColumn = ({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="space-y-1">
    <div className="flex items-center gap-1 font-semibold text-muted-foreground uppercase tracking-wide">
      {icon}
      {title} ({count})
    </div>
    {count === 0 ? <div className="text-muted-foreground">—</div> : children}
  </div>
);

const StatusBadge = ({ status }: { status: number | null }) => {
  if (status === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const tone =
    status >= 500
      ? 'bg-red-100 text-red-700'
      : status >= 400
        ? 'bg-amber-100 text-amber-700'
        : status >= 300
          ? 'bg-blue-100 text-blue-700'
          : 'bg-green-100 text-green-700';
  return (
    <Badge className={cn('text-xs font-mono', tone)} variant="secondary">
      {status}
    </Badge>
  );
};
