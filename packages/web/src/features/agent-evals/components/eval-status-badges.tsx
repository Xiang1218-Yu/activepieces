import { AgentEvalCaseStatus, AgentEvalRunStatus } from '@activepieces/shared';
import { t } from 'i18next';
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock,
  Loader2,
  ShieldQuestion,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const CASE_STATUS_META: Record<
  AgentEvalCaseStatus,
  { label: () => string; className: string; icon: React.ReactNode }
> = {
  [AgentEvalCaseStatus.SUCCESS]: {
    label: () => t('Success'),
    className: 'text-emerald-700 border-emerald-200 bg-emerald-50',
    icon: <CheckCircle2 size={12} />,
  },
  [AgentEvalCaseStatus.FAILED]: {
    label: () => t('Failed'),
    className: 'text-destructive border-destructive/30 bg-destructive/10',
    icon: <XCircle size={12} />,
  },
  [AgentEvalCaseStatus.NEEDS_APPROVAL]: {
    label: () => t('Needs approval'),
    className: 'text-amber-700 border-amber-200 bg-amber-50',
    icon: <ShieldQuestion size={12} />,
  },
  [AgentEvalCaseStatus.TIMEOUT]: {
    label: () => t('Timed out'),
    className: 'text-orange-700 border-orange-200 bg-orange-50',
    icon: <Clock size={12} />,
  },
  [AgentEvalCaseStatus.RUNNING]: {
    label: () => t('Running'),
    className: 'text-blue-700 border-blue-200 bg-blue-50',
    icon: <Loader2 size={12} className="animate-spin" />,
  },
  [AgentEvalCaseStatus.PENDING]: {
    label: () => t('Pending'),
    className: 'text-muted-foreground border-border bg-muted',
    icon: <CircleDashed size={12} />,
  },
  [AgentEvalCaseStatus.SKIPPED]: {
    label: () => t('Skipped'),
    className: 'text-muted-foreground border-border bg-muted',
    icon: <CircleSlash size={12} />,
  },
};

export const EvalCaseStatusBadge = ({
  status,
}: {
  status: AgentEvalCaseStatus;
}) => {
  const meta = CASE_STATUS_META[status];
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-medium', meta.className)}
    >
      {meta.icon}
      {meta.label()}
    </Badge>
  );
};

const RUN_STATUS_META: Record<
  AgentEvalRunStatus,
  { label: () => string; className: string }
> = {
  [AgentEvalRunStatus.RUNNING]: {
    label: () => t('Running'),
    className: 'text-blue-700 border-blue-200 bg-blue-50',
  },
  [AgentEvalRunStatus.COMPLETED]: {
    label: () => t('Completed'),
    className: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  },
  [AgentEvalRunStatus.BUDGET_EXHAUSTED]: {
    label: () => t('Budget exhausted'),
    className: 'text-amber-700 border-amber-200 bg-amber-50',
  },
  [AgentEvalRunStatus.FAILED]: {
    label: () => t('Failed'),
    className: 'text-destructive border-destructive/30 bg-destructive/10',
  },
};

export const EvalRunStatusBadge = ({
  status,
}: {
  status: AgentEvalRunStatus;
}) => {
  const meta = RUN_STATUS_META[status];
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-medium', meta.className)}
    >
      {status === AgentEvalRunStatus.RUNNING && (
        <Loader2 size={12} className="animate-spin" />
      )}
      {meta.label()}
    </Badge>
  );
};

export const formatCredits = (credits: number): string =>
  `${parseFloat(credits.toFixed(2))}`;

export const formatDurationMs = (
  durationMs: number | null | undefined,
): string => {
  if (durationMs === null || durationMs === undefined) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
};
