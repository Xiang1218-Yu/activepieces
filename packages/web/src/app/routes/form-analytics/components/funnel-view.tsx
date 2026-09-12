import {
  FormAnalyticsRow,
  FormFunnelStage,
  FormSessionStatus,
} from '@activepieces/shared';
import { t } from 'i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { toPercentage } from '@/features/form-analytics/lib/form-analytics-utils';

import { DailyBreakdownTable } from './daily-breakdown-table';

type FunnelViewProps = {
  rows: FormAnalyticsRow[];
  funnel: FormFunnelStage[];
  isLoading: boolean;
};

const STATUS_BADGE_CLASS: Partial<Record<FormSessionStatus, string>> = {
  [FormSessionStatus.VISITED]: 'bg-muted text-muted-foreground',
  [FormSessionStatus.STARTED]: 'bg-blue-100 text-blue-700',
  [FormSessionStatus.SUBMITTED]: 'bg-green-100 text-green-700',
  [FormSessionStatus.FAILED]: 'bg-red-100 text-red-700',
  [FormSessionStatus.TIMED_OUT]: 'bg-orange-100 text-orange-700',
  [FormSessionStatus.ABANDONED]: 'bg-yellow-100 text-yellow-700',
};

export function FunnelView({ rows, funnel, isLoading }: FunnelViewProps) {
  const visited = stageCount(funnel, FormSessionStatus.VISITED);
  const started = stageCount(funnel, FormSessionStatus.STARTED);
  const submitted = stageCount(funnel, FormSessionStatus.SUBMITTED);
  const conversion = toPercentage(submitted, visited);
  const startRate = toPercentage(started, visited);

  if (isLoading) {
    return (
      <div className="px-7 flex flex-col gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="px-7 flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          label={t('Visitors')}
          value={visited}
          hint={t('Opened the form')}
        />
        <MetricCard
          label={t('Started')}
          value={started}
          hint={`${startRate}% ${t('of visitors')}`}
        />
        <MetricCard
          label={t('Submitted')}
          value={submitted}
          hint={`${conversion}% ${t('conversion')}`}
          highlight
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Conversion funnel')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {funnel.map((stage) => (
            <FunnelBar
              key={stage.key}
              stage={stage}
              total={visited}
            />
          ))}
        </CardContent>
      </Card>

      <DailyBreakdownTable rows={rows} />
    </div>
  );
}

function stageCount(funnel: FormFunnelStage[], key: FormSessionStatus): number {
  return funnel.find((stage) => stage.key === key)?.count ?? 0;
}

function MetricCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: number;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-green-300' : undefined}>
      <CardContent className="py-5 flex flex-col gap-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span className="text-3xl font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardContent>
    </Card>
  );
}

function FunnelBar({
  stage,
  total,
}: {
  stage: FormFunnelStage;
  total: number;
}) {
  const width = total === 0 ? 0 : Math.max(toPercentage(stage.count, total), 4);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              STATUS_BADGE_CLASS[stage.key] ?? 'bg-muted'
            }`}
          >
            {t(stage.label)}
          </span>
        </div>
        <span className="font-medium">
          {stage.count}
          <span className="ml-2 text-muted-foreground">
            {toPercentage(stage.count, total)}%
          </span>
        </span>
      </div>
      <Progress value={width} className="h-2.5" />
    </div>
  );
}
