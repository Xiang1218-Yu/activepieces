import { Permission } from '@activepieces/core-utils';
import { CalendarDays } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TriggerCalendarFilters,
  TriggerCalendarGrid,
  TriggerCalendarSidePanels,
  triggerCalendarHooks,
  triggerCalendarTimeUtils as timeUtils,
} from '@/features/trigger-calendar';
import { useAuthorization } from '@/hooks/authorization-hooks';

const WINDOW_OPTIONS = [7, 14, 30] as const;

export const TriggerCalendarPage = () => {
  const { t } = useTranslation();
  const { checkAccess } = useAuthorization();

  const [days, setDays] = useState<number>(7);
  const [flowIds, setFlowIds] = useState<string[]>([]);
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [timezones, setTimezones] = useState<string[]>([]);
  const [displayTimezone, setDisplayTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );

  const requestFilters = useMemo(
    () => ({
      days,
      ...(flowIds.length > 0 ? { flowIds } : {}),
      ...(folderIds.length > 0 ? { folderIds } : {}),
      ...(timezones.length > 0 ? { timezones } : {}),
    }),
    [days, flowIds, folderIds, timezones],
  );

  const query = triggerCalendarHooks.useCalendar(requestFilters);

  const instanceTimezones = useMemo(() => {
    const values = new Set<string>();
    for (const trigger of query.data?.scheduled ?? []) {
      if (trigger.timezone) {
        values.add(trigger.timezone);
      }
    }
    return [...values];
  }, [query.data]);

  useEffect(() => {
    if (timezones.length === 1) {
      setDisplayTimezone(timezones[0]);
    }
  }, [timezones]);

  if (!checkAccess(Permission.READ_FLOW)) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <CalendarDays className="size-8" />
        <p className="text-sm">
          {t('You do not have access to the trigger calendar')}
        </p>
      </div>
    );
  }

  const hasActiveFilters =
    flowIds.length > 0 || folderIds.length > 0 || timezones.length > 0;

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('Trigger Calendar')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {query.data
              ? t('{{start}} to {{end}} — calculated by the server', {
                  start: timeUtils.windowLabel(query.data.windowStart),
                  end: timeUtils.windowLabel(query.data.windowEnd),
                })
              : t('Upcoming schedule trigger occurrences in this project')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(days)}
            onValueChange={(value) => setDays(Number(value))}
          >
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {t('Next {{count}} days', { count: option })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : query.isError || !query.data ? (
        <DataFetchErrorState
          entity={t('trigger calendar')}
          onRetry={() => query.refetch()}
          className="py-16"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TriggerCalendarFilters
              calendar={query.data}
              selectedFlowIds={flowIds}
              selectedFolderIds={folderIds}
              selectedTimezones={timezones}
              onFlowIdsChange={setFlowIds}
              onFolderIdsChange={setFolderIds}
              onTimezonesChange={setTimezones}
            />
            <div className="flex items-center gap-2">
              <Select
                value={displayTimezone}
                onValueChange={setDisplayTimezone}
              >
                <SelectTrigger className="h-8 w-52 text-xs">
                  <SelectValue placeholder={t('Display timezone')} />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ...new Set(['UTC', displayTimezone, ...instanceTimezones]),
                  ].map((timezone) => (
                    <SelectItem key={timezone} value={timezone}>
                      {timezone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFlowIds([]);
                    setFolderIds([]);
                    setTimezones([]);
                  }}
                >
                  {t('Clear filters')}
                </Button>
              )}
            </div>
          </div>

          {query.data.restrictedCount > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              {t(
                '{{count}} flow(s) are hidden because you do not have permission to view them',
                { count: query.data.restrictedCount },
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
            <TriggerCalendarGrid
              calendar={query.data}
              displayTimezone={displayTimezone}
            />
            <TriggerCalendarSidePanels calendar={query.data} />
          </div>
        </>
      )}
    </div>
  );
};
