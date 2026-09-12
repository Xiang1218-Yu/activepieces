import { WebhookRequestCapture } from '@activepieces/shared';
import { t } from 'i18next';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { flowHooks } from '@/features/flows/hooks/flow-hooks';
import { authenticationSession } from '@/lib/authentication-session';

import { WebhookRequestsTable } from '../components/webhook-requests-table';
import { webhookRequestHooks } from '../hooks/webhook-request-hooks';

const STATUS_OPTIONS = [
  { label: '2xx', value: '2xx' },
  { label: '3xx', value: '3xx' },
  { label: '4xx', value: '4xx' },
  { label: '5xx', value: '5xx' },
  { label: '200 OK', value: '200' },
  { label: '202 Accepted', value: '202' },
  { label: '404 Not Found', value: '404' },
  { label: '410 Gone', value: '410' },
  { label: '413 Payload Too Large', value: '413' },
  { label: '500 Error', value: '500' },
];

const STATUS_CLASS_VALUES = new Set(['2xx', '3xx', '4xx', '5xx']);

const PAGE_SIZE = 25;

export const WebhookRequestsPage = () => {
  const projectId = authenticationSession.getProjectId()!;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [requestIdInput, setRequestIdInput] = useState(
    searchParams.get('requestId') ?? '',
  );

  const { data: flowsData } = flowHooks.useFlows({
    limit: 1000,
    cursor: undefined,
  });
  const flows = flowsData?.data ?? [];
  const flowName = useMemo(() => {
    const map = new Map(flows.map((flow) => [flow.id, flow.version.displayName]));
    return (flowId: string) => map.get(flowId);
  }, [flows]);

  const flowId = searchParams.get('flowId') ?? undefined;
  const statusFilter = searchParams.get('statusFilter') ?? undefined;
  const requestId = searchParams.get('requestId') ?? undefined;
  const createdAfter = searchParams.get('createdAfter') ?? undefined;
  const createdBefore = searchParams.get('createdBefore') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;

  const statusClass =
    statusFilter && STATUS_CLASS_VALUES.has(statusFilter)
      ? ([statusFilter] as ('2xx' | '3xx' | '4xx' | '5xx')[])
      : undefined;
  const exactStatus =
    statusFilter && !STATUS_CLASS_VALUES.has(statusFilter)
      ? Number(statusFilter)
      : undefined;

  const { data, isLoading, isError, refetch } = webhookRequestHooks.useCaptures({
    projectId,
    flowId: flowId ? [flowId] : undefined,
    status: exactStatus && !Number.isNaN(exactStatus) ? [exactStatus] : undefined,
    statusClass,
    requestId: requestId || undefined,
    createdAfter,
    createdBefore,
    cursor,
    limit: PAGE_SIZE,
  });

  const { data: retention } = webhookRequestHooks.useRetentionDays(projectId);

  const updateParam = (key: string, value: string | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === undefined || value === 'all' || value === '') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      if (key !== 'cursor') {
        next.delete('cursor');
      }
      return next;
    });
  };

  const openCapture = (capture: WebhookRequestCapture) => {
    navigate(
      authenticationSession.appendProjectRoutePrefix(
        `/webhook-requests/${capture.id}`,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-4 p-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('Webhook Requests')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t(
              'Redacted snapshots of incoming webhook HTTP requests, retained for {{days}} days. Secrets, signature headers, connection information and oversized bodies are masked or truncated before storage.',
              { days: retention?.retentionDays ?? '…' },
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={flowId ?? 'all'}
          onValueChange={(value) => updateParam('flowId', value)}
        >
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder={t('All flows')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All flows')}</SelectItem>
            {flows.map((flow) => (
              <SelectItem key={flow.id} value={flow.id}>
                {flow.version.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter ?? 'all'}
          onValueChange={(value) => updateParam('statusFilter', value)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('All statuses')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All statuses')}</SelectItem>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="datetime-local"
          className="w-[220px]"
          value={createdAfter ? toLocalInput(createdAfter) : ''}
          onChange={(event) =>
            updateParam(
              'createdAfter',
              event.target.value ? new Date(event.target.value).toISOString() : undefined,
            )
          }
        />
        <span className="text-muted-foreground text-sm">{t('to')}</span>
        <Input
          type="datetime-local"
          className="w-[220px]"
          value={createdBefore ? toLocalInput(createdBefore) : ''}
          onChange={(event) =>
            updateParam(
              'createdBefore',
              event.target.value ? new Date(event.target.value).toISOString() : undefined,
            )
          }
        />

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            updateParam('requestId', requestIdInput.trim() || undefined);
          }}
        >
          <Input
            className="w-[240px] font-mono text-xs"
            placeholder={t('Filter by x-webhook-id')}
            value={requestIdInput}
            onChange={(event) => setRequestIdInput(event.target.value)}
          />
          <Button type="submit" variant="outline" size="icon">
            <Search className="size-4" />
          </Button>
        </form>

        {(flowId || statusFilter || requestId || createdAfter || createdBefore) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRequestIdInput('');
              setSearchParams({});
            }}
          >
            {t('Clear filters')}
          </Button>
        )}
      </div>

      {isError ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <span>{t('Failed to load webhook requests')}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t('Retry')}
          </Button>
        </div>
      ) : (
        <>
          <WebhookRequestsTable
            captures={data?.data ?? []}
            isLoading={isLoading}
            flowName={flowName}
            onOpen={openCapture}
          />
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="font-normal">
              {t('{{count}} request(s)', { count: data?.data.length ?? 0 })}
            </Badge>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!data?.previous}
                onClick={() =>
                  updateParam('cursor', data?.previous ?? undefined)
                }
              >
                <ArrowLeft className="size-4 mr-1" />
                {t('Previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!data?.next}
                onClick={() => updateParam('cursor', data?.next ?? undefined)}
              >
                {t('Next')}
                <ArrowRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
