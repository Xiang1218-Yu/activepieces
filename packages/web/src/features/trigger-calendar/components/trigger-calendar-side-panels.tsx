import {
  TriggerCalendarIssue,
  TriggerCalendarIssueKind,
  TriggerCalendarResponse,
  TriggerCalendarTrigger,
  TriggerCalendarTriggerKind,
} from '@activepieces/shared';
import { t } from 'i18next';
import { AlertTriangle, Globe, Pause, Repeat, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';

import { authenticationSession } from '@/lib/authentication-session';

function FlowNameLink({
  flowId,
  children,
}: {
  flowId: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={authenticationSession.appendProjectRoutePrefix(`/flows/${flowId}`)}
      className="truncate hover:underline"
    >
      {children}
    </Link>
  );
}

type SidePanelsProps = {
  calendar: TriggerCalendarResponse;
};

export function TriggerCalendarSidePanels({ calendar }: SidePanelsProps) {
  const grouped = groupNonScheduled(calendar.nonScheduled);

  return (
    <div className="flex flex-col gap-4">
      {calendar.conflicts.length > 0 && (
        <Panel
          icon={<AlertTriangle className="size-4 text-red-600" />}
          title={t('Same-minute collisions ({{count}})', {
            count: calendar.conflicts.length,
          })}
        >
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            {t(
              'Multiple flows trigger within the same minute. Each occurrence is also marked in the calendar.',
            )}
          </p>
          <ConflictList calendar={calendar} />
        </Panel>
      )}

      {calendar.issues.length > 0 && (
        <Panel
          icon={<AlertTriangle className="size-4 text-amber-600" />}
          title={t('Cannot be calculated ({{count}})', {
            count: calendar.issues.length,
          })}
        >
          <IssueList issues={calendar.issues} />
        </Panel>
      )}

      <Panel
        icon={<Webhook className="size-4" />}
        title={t('Event and manual triggers ({{count}})', {
          count: calendar.nonScheduled.length,
        })}
      >
        {calendar.nonScheduled.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('None')}</p>
        ) : (
          <div className="flex flex-col">
            {GROUP_ORDER.filter((kind) => grouped[kind]).map((kind) => (
              <GroupSection
                key={kind}
                kind={kind}
                triggers={grouped[kind] ?? []}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function ConflictList({ calendar }: { calendar: TriggerCalendarResponse }) {
  const flowNameById = new Map<string, string>();
  for (const trigger of [...calendar.scheduled, ...calendar.nonScheduled]) {
    flowNameById.set(trigger.flowId, trigger.flowName);
  }
  return (
    <div className="flex flex-col">
      {calendar.conflicts.slice(0, 20).map((conflict) => (
        <div
          key={conflict.time}
          className="border-t px-3 py-2 text-xs first:border-t-0"
        >
          <span className="font-mono tabular-nums">
            {conflict.time.slice(0, 16).replace('T', ' ')}
          </span>
          <span className="mx-2 text-muted-foreground">UTC</span>
          <span className="text-muted-foreground">·</span>
          <span className="ml-2 inline-flex flex-wrap gap-x-1">
            {conflict.flowIds.map((flowId, index) => (
              <span key={flowId} className="inline-flex gap-1">
                {index > 0 && <span className="text-muted-foreground">,</span>}
                <FlowNameLink flowId={flowId}>
                  {flowNameById.get(flowId) ?? flowId}
                </FlowNameLink>
              </span>
            ))}
          </span>
        </div>
      ))}
      {calendar.conflicts.length > 20 && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          {t('And {{count}} more', { count: calendar.conflicts.length - 20 })}
        </p>
      )}
    </div>
  );
}

function IssueList({ issues }: { issues: TriggerCalendarIssue[] }) {
  return (
    <div className="flex flex-col">
      {issues.map((issue) => (
        <div
          key={`${issue.flowId}-${issue.kind}`}
          className="border-t px-3 py-2 first:border-t-0"
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <FlowNameLink flowId={issue.flowId}>
              <span className="font-medium">{issue.flowName}</span>
            </FlowNameLink>
            <span className="shrink-0 text-amber-700 dark:text-amber-400">
              {issueLabel(issue.kind)}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {issue.kind === TriggerCalendarIssueKind.INVALID_INTERVAL
              ? `intervalMs=${issue.intervalMs ?? 'null'}`
              : `${issue.cronExpression ?? ''} ${
                  issue.timezone ? `(${issue.timezone})` : ''
                }`}
          </p>
        </div>
      ))}
    </div>
  );
}

function issueLabel(kind: TriggerCalendarIssue['kind']): string {
  switch (kind) {
    case TriggerCalendarIssueKind.INVALID_CRON:
      return t('Invalid cron expression');
    case TriggerCalendarIssueKind.INVALID_TIMEZONE:
      return t('Invalid timezone');
    case TriggerCalendarIssueKind.INVALID_INTERVAL:
      return t('Invalid interval');
  }
}

function groupNonScheduled(
  triggers: TriggerCalendarTrigger[],
): Partial<Record<TriggerCalendarTriggerKind, TriggerCalendarTrigger[]>> {
  const result: Partial<
    Record<TriggerCalendarTriggerKind, TriggerCalendarTrigger[]>
  > = {};
  for (const trigger of triggers) {
    const list = result[trigger.kind] ?? [];
    list.push(trigger);
    result[trigger.kind] = list;
  }
  return result;
}

function GroupSection({
  kind,
  triggers,
}: {
  kind: Exclude<
    TriggerCalendarTriggerKind,
    typeof TriggerCalendarTriggerKind.SCHEDULED
  >;
  triggers: TriggerCalendarTrigger[];
}) {
  const meta = GROUP_META[kind];
  return (
    <div className="border-t first:border-t-0">
      <div className="flex items-center gap-2 px-3 pt-2 text-[11px] font-medium uppercase text-muted-foreground">
        {meta.icon}
        {t(meta.label)} ({triggers.length})
      </div>
      {triggers.map((trigger) => (
        <div
          key={trigger.flowId}
          className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
        >
          <FlowNameLink flowId={trigger.flowId}>
            {trigger.flowName}
          </FlowNameLink>
          {trigger.kind === TriggerCalendarTriggerKind.INTERVAL &&
            trigger.intervalMs && (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {formatInterval(trigger.intervalMs)}
              </span>
            )}
        </div>
      ))}
    </div>
  );
}

function formatInterval(intervalMs: number): string {
  const minutes = Math.round(intervalMs / 60000);
  if (minutes % 60 === 0) {
    return `every ${minutes / 60}h`;
  }
  return `every ${minutes}m`;
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

const GROUP_META: Record<
  Exclude<
    TriggerCalendarTriggerKind,
    typeof TriggerCalendarTriggerKind.SCHEDULED
  >,
  { label: string; icon: React.ReactNode }
> = {
  [TriggerCalendarTriggerKind.INTERVAL]: {
    label: 'Rolling interval',
    icon: <Repeat className="size-3" />,
  },
  [TriggerCalendarTriggerKind.WEBHOOK]: {
    label: 'Webhook',
    icon: <Globe className="size-3" />,
  },
  [TriggerCalendarTriggerKind.APP_WEBHOOK]: {
    label: 'App webhook',
    icon: <Globe className="size-3" />,
  },
  [TriggerCalendarTriggerKind.MANUAL]: {
    label: 'Manual',
    icon: <Pause className="size-3" />,
  },
};

const GROUP_ORDER: Exclude<
  TriggerCalendarTriggerKind,
  typeof TriggerCalendarTriggerKind.SCHEDULED
>[] = [
  TriggerCalendarTriggerKind.INTERVAL,
  TriggerCalendarTriggerKind.WEBHOOK,
  TriggerCalendarTriggerKind.APP_WEBHOOK,
  TriggerCalendarTriggerKind.MANUAL,
];
