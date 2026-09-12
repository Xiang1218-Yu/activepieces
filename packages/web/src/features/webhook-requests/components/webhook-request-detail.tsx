import {
  ArrowLeft,
  ClipboardCopy,
  File as FileIcon,
  FlaskConical,
  ShieldAlert,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { t } from 'i18next';
import { WebhookRequestBodyKind } from '@activepieces/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { JsonViewer } from '@/components/custom/json-viewer';
import { PermissionNeededTooltip } from '@/components/custom/permission-needed-tooltip';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { formatUtils } from '@/lib/format-utils';
import { authenticationSession } from '@/lib/authentication-session';
import { Permission } from '@activepieces/core-utils';

import { webhookRequestHooks } from '../hooks/webhook-request-hooks';
import { webhookRequestUtils } from '../utils/webhook-request-utils';

type WebhookRequestDetailProps = {
  captureId: string;
  flowName?: string;
};

export const WebhookRequestDetail = ({
  captureId,
  flowName,
}: WebhookRequestDetailProps) => {
  const projectId = authenticationSession.getProjectId()!;
  const navigate = useNavigate();
  const { data: capture, isLoading, isError } = webhookRequestHooks.useCapture(
    captureId,
    projectId,
  );
  const copyMutation = webhookRequestHooks.useCopyAsTestInput();
  const { checkAccess } = useAuthorization();
  const canWriteFlow = checkAccess(Permission.WRITE_FLOW);
  const [confirmCopy, setConfirmCopy] = useState(false);

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">{t('Loading…')}</div>;
  }
  if (isError || !capture) {
    return (
      <div className="p-8 text-muted-foreground">
        {t('Webhook request not found or you do not have access to it.')}
      </div>
    );
  }

  const handleCopyAsTestInput = () => {
    copyMutation.mutate(
      { id: capture.id, projectId },
      {
        onSuccess: (result) => {
          toast.success(
            t(
              'Copied as trigger test input. Open the flow builder and run the trigger step to use it — no production run was started.',
            ),
            {
              action: {
                label: t('Open builder'),
                onClick: () =>
                  navigate(
                    authenticationSession.appendProjectRoutePrefix(
                      `/flows/${result.flowId}`,
                    ),
                  ),
              },
            },
          );
        },
        onError: () => {
          toast.error(t('Failed to copy request as test input'));
        },
      },
    );
    setConfirmCopy(false);
  };

  return (
    <div className="flex flex-col gap-4 p-6 w-full">
      <Button
        variant="ghost"
        size="sm"
        className="self-start -ml-2 text-muted-foreground"
        onClick={() =>
          navigate(
            authenticationSession.appendProjectRoutePrefix('/webhook-requests'),
          )
        }
      >
        <ArrowLeft className="size-4 mr-1" />
        {t('All webhook requests')}
      </Button>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">
            {flowName ?? capture.flowId}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="font-mono">
              {capture.method}
            </Badge>
            <span className="font-mono text-xs">{capture.path}</span>
            <StatusPill status={capture.responseStatus} />
            <span>{formatUtils.formatDate(new Date(capture.created))}</span>
          </div>
        </div>
        <PermissionNeededTooltip hasPermission={canWriteFlow}>
          <Button
            disabled={!canWriteFlow || copyMutation.isPending || !confirmCopy}
            onClick={handleCopyAsTestInput}
            variant="default"
          >
            <FlaskConical className="size-4 mr-2" />
            {copyMutation.isPending ? t('Copying…') : t('Copy as test input')}
          </Button>
        </PermissionNeededTooltip>
      </div>

      {!confirmCopy && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-300">
          {t(
            'This writes the request to the flow’s draft trigger sample data only. It does not execute, publish, or trigger the production flow. Click the button again to confirm.',
          )}
          <Button
            variant="link"
            size="sm"
            className="ml-2 h-auto p-0 text-amber-900 dark:text-amber-200"
            onClick={() => setConfirmCopy(true)}
          >
            {t('I understand, enable copy')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <MetaCard label={t('Request ID')} value={capture.requestId} mono />
        <MetaCard
          label={t('Environment')}
          value={capture.environment.toLowerCase()}
        />
        <MetaCard
          label={t('Client network')}
          value={capture.clientIpPrefix ?? t('masked / unavailable')}
          mono
        />
        <MetaCard
          label={t('Body size on the wire')}
          value={webhookRequestUtils.formatBytes(capture.body.size)}
        />
      </div>

      <Section title={t('Headers')} count={Object.keys(capture.headers).length}>
        <MultiValueRecord record={capture.headers} />
      </Section>

      <Section
        title={t('Query parameters')}
        count={Object.keys(capture.queryParams).length}
      >
        <MultiValueRecord record={capture.queryParams} />
      </Section>

      <Section
        title={t('Body')}
        badge={
          <Badge variant="secondary">{capture.body.kind}</Badge>
        }
      >
        <BodySection capture={capture} />
      </Section>

      {(capture.body.files?.length ?? 0) > 0 && (
        <Section
          title={t('Uploaded file metadata')}
          count={capture.body.files!.length}
        >
          <div className="space-y-2">
            {capture.body.files!.map((file, index) => (
              <div
                key={`${file.fieldName}-${index}`}
                className="flex items-center gap-3 rounded-md border p-3 text-sm"
              >
                <FileIcon className="size-5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {file.fileName ?? t('(no filename)')}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {file.fieldName}
                    {file.contentType ? ` · ${file.contentType}` : ''} ·{' '}
                    {webhookRequestUtils.formatBytes(file.size)}
                  </div>
                </div>
                {file.truncated && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    <ShieldAlert className="size-3 mr-1" />
                    {t('truncated')}
                  </Badge>
                )}
                {file.url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(file.url!);
                      toast.success(t('File URL copied'));
                    }}
                  >
                    <ClipboardCopy className="size-4 mr-1" />
                    {t('Copy file URL')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

const StatusPill = ({ status }: { status: number | null }) => {
  if (status === null) {
    return <Badge variant="outline">—</Badge>;
  }
  const tone =
    status >= 500
      ? 'bg-red-100 text-red-700'
      : status >= 400
        ? 'bg-amber-100 text-amber-700'
        : 'bg-green-100 text-green-700';
  return <Badge className={tone}>{status}</Badge>;
};

const MetaCard = ({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className="rounded-md border p-3">
    <div className="text-xs text-muted-foreground uppercase tracking-wide">
      {label}
    </div>
    <div className={`text-sm mt-1 truncate ${mono ? 'font-mono text-xs' : ''}`}>
      {value}
    </div>
  </div>
);

const Section = ({
  title,
  count,
  badge,
  children,
}: {
  title: string;
  count?: number;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <Collapsible defaultOpen>
    <div className="rounded-md border">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50">
        <span className="flex items-center gap-2">
          {title}
          {count !== undefined && (
            <span className="text-muted-foreground">({count})</span>
          )}
        </span>
        {badge}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-4">{children}</CollapsibleContent>
    </div>
  </Collapsible>
);

const MultiValueRecord = ({
  record,
}: {
  record: Record<string, string[]>;
}) => {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return <div className="text-sm text-muted-foreground">—</div>;
  }
  return (
    <ScrollArea className="max-h-72">
      <div className="space-y-1 font-mono text-xs">
        {keys.map((key) => {
          const values = record[key] ?? [];
          return (
            <div key={key} className="grid grid-cols-[minmax(160px,280px)_1fr] gap-3">
              <div className="text-muted-foreground break-all">{key}</div>
              <div className="space-y-0.5">
                {values.map((value, index) => (
                  <div key={index} className="break-all whitespace-pre-wrap">
                    {values.length > 1 && (
                      <span className="text-muted-foreground mr-1">[{index}]</span>
                    )}
                    {value}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
};

const BodySection = ({
  capture,
}: {
  capture: { body: import('@activepieces/shared').WebhookRequestBodySummary };
}) => {
  const { body } = capture;
  return (
    <div className="space-y-3">
      {body.truncated && (
        <Badge variant="outline" className="text-amber-600 border-amber-300">
          <ShieldAlert className="size-3 mr-1" />
          {t('Preview truncated — body was {{size}} on the wire', {
            size: webhookRequestUtils.formatBytes(body.size),
          })}
        </Badge>
      )}
      {renderBody(body)}
    </div>
  );
};

function renderBody(body: import('@activepieces/shared').WebhookRequestBodySummary) {
  if (body.kind === WebhookRequestBodyKind.BINARY) {
    return (
      <div className="text-sm text-muted-foreground">
        {t(
          'Binary body — bytes were streamed straight to storage and are never stored in the inspector. See the file metadata section below.',
        )}
      </div>
    );
  }
  if (body.kind === WebhookRequestBodyKind.EMPTY) {
    return <div className="text-sm text-muted-foreground">{t('No body')}</div>;
  }
  if (typeof body.rawPreview === 'string' && body.preview === undefined) {
    return (
      <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-96 overflow-auto rounded bg-muted p-3">
        {body.rawPreview}
      </pre>
    );
  }
  return <JsonViewer json={body.preview ?? {}} title={t('Body preview')} />;
}
