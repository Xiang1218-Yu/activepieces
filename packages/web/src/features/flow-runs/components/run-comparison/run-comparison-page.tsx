import {
  FailureRateAggregationInterval,
  RunErrorCategory,
} from '@activepieces/shared';
import { t } from 'i18next';
import { GitCompare, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDebounce } from 'use-debounce';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { DateTimePickerWithRange } from '@/components/custom/date-time-picker-range';
import { getDefaultRange } from '@/components/custom/date-time-picker-range';
import { LoadingSpinner } from '@/components/custom/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { flowHooks } from '@/features/flows/hooks/flow-hooks';
import { authenticationSession } from '@/lib/authentication-session';

import { runComparisonHooks } from '../../hooks/run-comparison-hooks';
import { CompareTable } from './compare-table';
import { FailureRateChart } from './failure-rate-chart';
import { RunPicker } from './run-picker';

const SELECTED_RUNS_PARAM = 'runId';
const FLOW_PARAM = 'flowId';
const TAG_PARAM = 'tag';
const TAB_PARAM = 'tab';

type CompareTab = 'compare' | 'failure-rate';

function RunComparisonPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: flowsData } = flowHooks.useFlows({
    limit: 1000,
    cursor: undefined,
  });

  const selectedRunIds = searchParams.getAll(SELECTED_RUNS_PARAM);
  const selectedFlowIds = searchParams.getAll(FLOW_PARAM);
  const selectedTags = searchParams.getAll(TAG_PARAM);
  const tabParam = searchParams.get(TAB_PARAM);
  const tab: CompareTab =
    tabParam === 'failure-rate' ? 'failure-rate' : 'compare';

  const defaultRange = getDefaultRange('7days');
  const [dateRange, setDateRange] = useState(() => ({
    from: searchParams.get('createdAfter')
      ? new Date(searchParams.get('createdAfter')!)
      : defaultRange.from,
    to: searchParams.get('createdBefore')
      ? new Date(searchParams.get('createdBefore')!)
      : defaultRange.to,
  }));

  const createdAfter = dateRange.from.toISOString();
  const createdBefore = dateRange.to.toISOString();

  const flows = flowsData?.data ?? [];
  const flowOptions = useMemo(
    () =>
      flows.map((flow) => ({
        label: flow.version.displayName,
        value: flow.id,
      })),
    [flows],
  );

  const compareQuery = runComparisonHooks.useCompareRuns(
    tab === 'compare' ? selectedRunIds : [],
  );

  const openRun = (flowRunId: string, newWindow = false) => {
    const path = authenticationSession.appendProjectRoutePrefix(
      `/runs/${flowRunId}`,
    );
    if (newWindow) {
      window.open(path, '_blank');
    } else {
      navigate(path);
    }
  };

  const updateParams = useCallback(
    (updater: (next: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        updater(next);
        return next;
      });
    },
    [setSearchParams],
  );

  const setSelectedRunIds = useCallback(
    (runIds: string[]) =>
      updateParams((next) => {
        next.delete(SELECTED_RUNS_PARAM);
        runIds.forEach((id) => next.append(SELECTED_RUNS_PARAM, id));
      }),
    [updateParams],
  );

  const setFlowFilter = useCallback(
    (flowIds: string[]) =>
      updateParams((next) => {
        next.delete(FLOW_PARAM);
        flowIds.forEach((id) => next.append(FLOW_PARAM, id));
      }),
    [updateParams],
  );

  const setTagFilter = useCallback(
    (tags: string[]) =>
      updateParams((next) => {
        next.delete(TAG_PARAM);
        tags.forEach((tag) => next.append(TAG_PARAM, tag));
      }),
    [updateParams],
  );

  const [interval, setIntervalBucket] =
    useState<FailureRateAggregationInterval>(
      FailureRateAggregationInterval.DAY,
    );

  const errorCategoryCounts = useMemo(() => {
    const counts = new Map<RunErrorCategory, number>();
    for (const column of compareQuery.data?.columns ?? []) {
      counts.set(
        column.errorCategory,
        (counts.get(column.errorCategory) ?? 0) + 1,
      );
    }
    return [...counts.entries()]
      .filter(([category]) => category !== RunErrorCategory.NONE)
      .sort((a, b) => b[1] - a[1]);
  }, [compareQuery.data]);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={tab}
          onValueChange={(value) =>
            updateParams((next) => next.set(TAB_PARAM, value))
          }
        >
          <TabsList>
            <TabsTrigger value="compare">
              <GitCompare className="mr-1 size-4" />
              {t('Compare runs')}
            </TabsTrigger>
            <TabsTrigger value="failure-rate">{t('Failure rate')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DateTimePickerWithRange
            presetType="past"
            defaultSelectedRange="7days"
            from={createdAfter}
            to={createdBefore}
            onChange={(range) =>
              setDateRange({
                from: range?.from ?? defaultRange.from,
                to: range?.to ?? defaultRange.to,
              })
            }
          />
        </div>
      </div>

      {tab === 'failure-rate' && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedFlowIds[0] ?? 'all'}
            onValueChange={(value) =>
              setFlowFilter(value === 'all' ? [] : [value])
            }
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t('All flows')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All flows')}</SelectItem>
              {flowOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={interval}
            onValueChange={(value) =>
              setIntervalBucket(value as FailureRateAggregationInterval)
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FailureRateAggregationInterval.DAY}>
                {t('Daily')}
              </SelectItem>
              <SelectItem value={FailureRateAggregationInterval.HOUR}>
                {t('Hourly')}
              </SelectItem>
            </SelectContent>
          </Select>
          <TagFilterInput
            selectedTags={selectedTags}
            onChange={setTagFilter}
          />
        </div>
      )}

      {tab === 'compare' && (
        <div className="flex flex-wrap items-center gap-2">
          <RunPicker
            selectedRunIds={selectedRunIds}
            flowId={selectedFlowIds}
            tags={selectedTags}
            createdAfter={createdAfter}
            createdBefore={createdBefore}
            onChange={setSelectedRunIds}
          />
          <Select
            value={selectedFlowIds[0] ?? 'all'}
            onValueChange={(value) =>
              setFlowFilter(value === 'all' ? [] : [value])
            }
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder={t('Filter picker by flow')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All flows')}</SelectItem>
              {flowOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedRunIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedRunIds([])}
            >
              <X className="mr-1 size-4" />
              {t('Clear selection')}
            </Button>
          )}
          <TagFilterInput
            selectedTags={selectedTags}
            onChange={setTagFilter}
          />
        </div>
      )}

      {tab === 'failure-rate' && (
        <FailureRateChart
          flowId={selectedFlowIds}
          tags={selectedTags}
          createdAfter={createdAfter}
          createdBefore={createdBefore}
          interval={interval}
        />
      )}

      {tab === 'compare' && (
        <CompareView
          selectedRunIds={selectedRunIds}
          compareQuery={compareQuery}
          errorCategoryCounts={errorCategoryCounts}
          onOpenRun={openRun}
        />
      )}
    </div>
  );
}

type CompareViewProps = {
  selectedRunIds: string[];
  compareQuery: ReturnType<typeof runComparisonHooks.useCompareRuns>;
  errorCategoryCounts: Array<[RunErrorCategory, number]>;
  onOpenRun: (flowRunId: string, newWindow?: boolean) => void;
};

function CompareView({
  selectedRunIds,
  compareQuery,
  errorCategoryCounts,
  onOpenRun,
}: CompareViewProps) {
  if (selectedRunIds.length === 0) {
    return (
      <Alert>
        <GitCompare className="size-4" />
        <AlertTitle>{t('Select runs to compare')}</AlertTitle>
        <AlertDescription>
          {t(
            'Pick up to 10 runs across flows or with shared tags to align them by trigger, step duration, output and error category.',
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (compareQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner isLarge={true} />
      </div>
    );
  }

  if (compareQuery.isError) {
    return (
      <DataFetchErrorState
        entity={t('run comparison')}
        onRetry={compareQuery.refetch}
      />
    );
  }

  const columns = compareQuery.data?.columns ?? [];
  const rows = compareQuery.data?.rows ?? [];
  const notFoundRunIds = compareQuery.data?.notFoundRunIds ?? [];
  const stepsMissing = columns.filter((column) => !column.stepsAvailable);

  if (columns.length === 0) {
    return (
      <Alert>
        <AlertTitle>{t('No readable runs found')}</AlertTitle>
        <AlertDescription>
          {t(
            'The selected runs could not be loaded. They may belong to another project or you may not have permission to read them.',
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notFoundRunIds.length > 0 && (
        <Alert>
          <X className="size-4" />
          <AlertTitle>
            {t('{{count}} selected run(s) excluded', {
              count: notFoundRunIds.length,
            })}
          </AlertTitle>
          <AlertDescription>
            {t(
              'Some runs were not found in this project (or are outside retention) and were excluded from the comparison.',
            )}
          </AlertDescription>
        </Alert>
      )}
      {stepsMissing.length > 0 && (
        <Alert>
          <AlertTitle>
            {t('{{count}} run(s) have no step outputs available', {
              count: stepsMissing.length,
            })}
          </AlertTitle>
          <AlertDescription>
            {t(
              'Execution data for these runs was purged or never recorded; their cells show as missing.',
            )}
          </AlertDescription>
        </Alert>
      )}
      {errorCategoryCounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {errorCategoryCounts.map(([category, count]) => (
            <span
              key={category}
              className="rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-0.5 text-xs text-destructive"
            >
              {category}: {count}
            </span>
          ))}
        </div>
      )}
      <CompareTable columns={columns} rows={rows} onOpenRun={onOpenRun} />
    </div>
  );
}

function TagFilterInput({
  selectedTags,
  onChange,
}: {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [value, setValue] = useState(selectedTags.join(', '));
  const [debouncedValue] = useDebounce(value, 300);

  useEffect(() => {
    const parsed = debouncedValue
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (parsed.join(',') !== selectedTags.join(',')) {
      onChange(parsed);
    }
  }, [debouncedValue, onChange, selectedTags]);

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{t('Tags')}</Label>
      <Input
        className="h-9 w-56 text-sm"
        placeholder={t('Comma-separated tags')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}

export { RunComparisonPage };
