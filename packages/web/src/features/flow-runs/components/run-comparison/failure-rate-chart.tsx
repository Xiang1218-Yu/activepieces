import {
  FailureRateAggregationInterval,
  FailureRateBucket,
} from '@activepieces/shared';
import { t } from 'i18next';
import { Activity } from 'lucide-react';
import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from 'recharts';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUtils } from '@/lib/format-utils';

import { runComparisonHooks } from '../../hooks/run-comparison-hooks';

type FailureRateChartProps = {
  flowId: string[];
  tags: string[];
  createdAfter: string;
  createdBefore: string;
  interval: FailureRateAggregationInterval;
};

function FailureRateChart({
  flowId,
  tags,
  createdAfter,
  createdBefore,
  interval,
}: FailureRateChartProps) {
  const chartConfig = {
    succeeded: {
      label: t('Succeeded'),
      color: 'hsl(var(--success))',
    },
    failed: {
      label: t('Failed'),
      color: 'hsl(var(--destructive))',
    },
    other: {
      label: t('Other (running, canceled, paused)'),
      color: 'hsl(var(--muted-foreground))',
    },
    failureRatePct: {
      label: t('Failure rate'),
      color: 'hsl(var(--warning))',
    },
  } satisfies ChartConfig;
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = runComparisonHooks.useFailureRate({
    flowId,
    tags,
    createdAfter,
    createdBefore,
    interval,
  });

  const buckets = useMemo(
    () =>
      (data?.pages.flatMap((page) => page.buckets) ?? [])
        .slice()
        .sort(
          (a, b) =>
            new Date(a.bucketStart).getTime() -
            new Date(b.bucketStart).getTime(),
        ),
    [data],
  );

  const chartData = useMemo(
    () =>
      buckets.map((bucket: FailureRateBucket) => ({
        ...bucket,
        failureRatePct: Math.round(bucket.failureRate * 1000) / 10,
      })),
    [buckets],
  );

  const totals = useMemo(
    () =>
      buckets.reduce(
        (acc, bucket) => ({
          total: acc.total + bucket.total,
          failed: acc.failed + bucket.failed,
        }),
        { total: 0, failed: 0 },
      ),
    [buckets],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <Activity className="size-4" />
              {t('Failure rate over time')}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('{{total}} runs, {{failed}} failed', {
                total: formatUtils.formatNumber(totals.total),
                failed: formatUtils.formatNumber(totals.failed),
              })}
              {totals.total > 0 && (
                <>
                  {' '}
                  · {((totals.failed / totals.total) * 100).toFixed(1)}%
                </>
              )}
            </p>
          </div>
          {hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              loading={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {t('Load older buckets')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isError ? (
          <DataFetchErrorState
            entity={t('failure rate buckets')}
            onRetry={refetch}
          />
        ) : chartData.length === 0 ? (
          <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Activity className="size-8" />
            {t('No runs in the selected time window')}
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
            <ComposedChart
              accessibilityLayer
              data={chartData}
              margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="bucketStart"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tick={{
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 12,
                }}
                tickFormatter={(value) => formatBucketLabel(value, interval)}
              />
              <YAxis
                yAxisId="count"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={40}
                tick={{
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 12,
                }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={44}
                tick={{
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 12,
                }}
                tickFormatter={(value) => `${value}%`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      new Date(value).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour:
                          interval === FailureRateAggregationInterval.HOUR
                            ? '2-digit'
                            : undefined,
                        minute:
                          interval === FailureRateAggregationInterval.HOUR
                            ? '2-digit'
                            : undefined,
                      })
                    }
                  />
                }
              />
              <Bar
                yAxisId="count"
                dataKey="succeeded"
                stackId="runs"
                fill="hsl(var(--success))"
              />
              <Bar
                yAxisId="count"
                dataKey="other"
                stackId="runs"
                fill="hsl(var(--muted-foreground))"
              />
              <Bar
                yAxisId="count"
                dataKey="failed"
                stackId="runs"
                fill="hsl(var(--destructive))"
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="failureRatePct"
                stroke="hsl(var(--warning))"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function formatBucketLabel(
  value: string,
  interval: FailureRateAggregationInterval,
): string {
  const date = new Date(value);
  if (interval === FailureRateAggregationInterval.HOUR) {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
    });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export { FailureRateChart };
