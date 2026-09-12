import {
  TriggerCalendarResponse,
  TriggerCalendarTrigger,
} from '@activepieces/shared';
import { t } from 'i18next';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { authenticationSession } from '@/lib/authentication-session';

import { CalendarDayBucket, buildDayBuckets } from '../lib/day-buckets';
import { triggerCalendarTimeUtils as timeUtils } from '../lib/time-utils';

type CalendarGridProps = {
  calendar: TriggerCalendarResponse;
  displayTimezone: string;
};

export function TriggerCalendarGrid({
  calendar,
  displayTimezone,
}: CalendarGridProps) {
  const flowById = useMemo(() => {
    const map = new Map<string, TriggerCalendarTrigger>();
    for (const trigger of calendar.scheduled) {
      map.set(trigger.flowId, trigger);
    }
    return map;
  }, [calendar.scheduled]);

  const conflictingFlowIds = useMemo(() => {
    const set = new Set<string>();
    for (const conflict of calendar.conflicts) {
      for (const flowId of conflict.flowIds) {
        set.add(`${conflict.time}|${flowId}`);
      }
    }
    return set;
  }, [calendar.conflicts]);

  const days: CalendarDayBucket[] = useMemo(
    () =>
      buildDayBuckets({
        occurrences: calendar.occurrences,
        flowById,
        conflictingFlowIds,
        displayTimezone,
        windowStartIso: calendar.windowStart,
        windowEndIso: calendar.windowEnd,
      }),
    [
      calendar.occurrences,
      calendar.windowStart,
      calendar.windowEnd,
      flowById,
      conflictingFlowIds,
      displayTimezone,
    ],
  );

  if (calendar.scheduled.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <CalendarClock className="size-8" />
        <p className="text-sm">{t('No schedule triggers in this project')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => (
        <div
          key={day.dayKey}
          className="overflow-hidden rounded-md border bg-card"
        >
          <div className="border-b bg-muted/40 px-4 py-2 text-sm font-medium">
            {day.label}
          </div>
          {day.occurrences.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              {t('No triggers on this day')}
            </div>
          ) : (
            <div className="divide-y">
              {day.occurrences.map((entry, index) => (
                <Link
                  key={`${entry.occurrence.flowId}-${entry.occurrence.time}-${index}`}
                  to={authenticationSession.appendProjectRoutePrefix(
                    `/flows/${entry.occurrence.flowId}`,
                  )}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50"
                >
                  <span className="w-20 shrink-0 font-mono text-xs tabular-nums">
                    {timeUtils.formatInZone(
                      entry.occurrence.time,
                      displayTimezone,
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {entry.flowName}
                  </span>
                  {entry.instanceTimezone &&
                    entry.instanceTimezone !== displayTimezone && (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {entry.instanceTimezone}
                      </span>
                    )}
                  {entry.occurrence.utcOffsetMinutes !== 0 && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {timeUtils.formatOffset(
                        entry.occurrence.utcOffsetMinutes,
                      )}
                    </span>
                  )}
                  {entry.occurrence.dstTransition && (
                    <span
                      className="flex shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      title={t(
                        'Daylight saving time changes on this day; the UTC offset differs from the previous occurrence',
                      )}
                    >
                      <AlertTriangle className="size-3" />
                      {t('DST')}
                    </span>
                  )}
                  {entry.conflict && (
                    <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
                      {t('Collision')}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
