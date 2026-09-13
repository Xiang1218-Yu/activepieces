import { ApprovalSlaStatus } from '@activepieces/shared';
import { t } from 'i18next';
import { AlarmClock, Pause, TimerOff } from 'lucide-react';

import { cn } from '@/lib/utils';

const formatRemaining = (ms: number): string => {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return t('{{days}}d {{hours}}h', { days, hours });
  }
  if (hours > 0) {
    return t('{{hours}}h {{mins}}m', { hours, mins });
  }
  return t('{{mins}}m', { mins: Math.max(mins, 1) });
};

const breachReasonText = (
  reason: ApprovalSlaStatus['breachReason'],
): string => {
  switch (reason) {
    case 'PENDING_LIMIT':
      return t('SLA breached: nobody handled it before the deadline.');
    case 'ESCALATION_LIMIT':
      return t('SLA breached after escalation: still no decision.');
    default:
      return '';
  }
};

type ApprovalSlaBadgeProps = {
  sla: ApprovalSlaStatus | undefined;
  className?: string;
  showDetails?: boolean;
};

export function ApprovalSlaBadge({
  sla,
  className,
  showDetails = false,
}: ApprovalSlaBadgeProps) {
  if (!sla || !sla.configured || !sla.deadlineAt) {
    return null;
  }

  if (sla.paused) {
    const pausedLabel =
      sla.pauseReason === 'FLOW_DISABLED'
        ? t('SLA paused: flow is disabled')
        : sla.pauseReason === 'FLOW_DELETED'
        ? t('SLA paused: flow was deleted')
        : t('SLA paused');
    return (
      <div className={cn('flex flex-col gap-0.5', className)}>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Pause className="size-3.5" />
          {pausedLabel}
        </span>
        {showDetails && sla.escalationTargetUserIds.length > 0 && (
          <EscalationTargetText count={sla.escalationTargetUserIds.length} />
        )}
      </div>
    );
  }

  const tone = sla.overdue
    ? 'text-destructive'
    : sla.remainingMs < 60 * 60_000
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-muted-foreground';
  const Icon = sla.overdue ? TimerOff : AlarmClock;
  const label = sla.overdue
    ? t('Overdue by {{time}}', { time: formatRemaining(sla.remainingMs) })
    : t('{{time}} left', { time: formatRemaining(sla.remainingMs) });

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium',
          tone,
        )}
      >
        <Icon className="size-3.5" />
        {label}
        {sla.escalatedAt && !sla.overdue && (
          <span className="text-muted-foreground">· {t('escalated')}</span>
        )}
      </span>
      {showDetails && sla.overdue && sla.breachReason && (
        <span className="text-xs text-destructive">
          {breachReasonText(sla.breachReason)}
        </span>
      )}
      {showDetails && sla.escalationTargetUserIds.length > 0 && (
        <EscalationTargetText count={sla.escalationTargetUserIds.length} />
      )}
    </div>
  );
}

function EscalationTargetText({ count }: { count: number }) {
  return (
    <span className="text-xs text-muted-foreground">
      {t('Escalates to {{count}} member(s)', { count })}
    </span>
  );
}
