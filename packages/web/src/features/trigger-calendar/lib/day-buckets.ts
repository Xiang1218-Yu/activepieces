import {
  TriggerCalendarOccurrence,
  TriggerCalendarTrigger,
} from '@activepieces/shared';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export type CalendarDayBucket = {
  dayKey: string;
  label: string;
  occurrences: Array<{
    occurrence: TriggerCalendarOccurrence;
    flowName: string;
    instanceTimezone: string | null;
    conflict: boolean;
  }>;
};

type BuildDayBucketsParams = {
  occurrences: TriggerCalendarOccurrence[];
  flowById: Map<string, TriggerCalendarTrigger>;
  conflictingFlowIds: Set<string>;
  displayTimezone: string;
  windowStartIso: string;
  windowEndIso: string;
};

// Produces one bucket per local day in [windowStart, windowEnd) as seen in the
// selected display timezone — including days with no triggers, so quiet days
// stay visible instead of silently disappearing. Days follow local wall-clock
// boundaries in the display timezone, not UTC midnight.
export function buildDayBuckets(
  params: BuildDayBucketsParams,
): CalendarDayBucket[] {
  const {
    occurrences,
    flowById,
    conflictingFlowIds,
    displayTimezone,
    windowStartIso,
    windowEndIso,
  } = params;

  const buckets = new Map<string, CalendarDayBucket>();
  const startDay = dayjs.utc(windowStartIso).tz(displayTimezone).startOf('day');
  const endDay = dayjs.utc(windowEndIso).tz(displayTimezone).startOf('day');
  for (let day = startDay; day.isBefore(endDay); day = day.add(1, 'day')) {
    const dayKey = day.format('YYYY-MM-DD');
    buckets.set(dayKey, {
      dayKey,
      label: day.format('ddd, MMM D'),
      occurrences: [],
    });
  }

  for (const occurrence of occurrences) {
    const trigger = flowById.get(occurrence.flowId);
    if (!trigger) {
      continue;
    }
    const dayKey = dayjs
      .utc(occurrence.time)
      .tz(displayTimezone)
      .format('YYYY-MM-DD');
    const bucket = buckets.get(dayKey);
    if (!bucket) {
      continue;
    }
    bucket.occurrences.push({
      occurrence,
      flowName: trigger.flowName,
      instanceTimezone: trigger.timezone,
      conflict: conflictingFlowIds.has(
        `${occurrence.time}|${occurrence.flowId}`,
      ),
    });
  }

  return [...buckets.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}
