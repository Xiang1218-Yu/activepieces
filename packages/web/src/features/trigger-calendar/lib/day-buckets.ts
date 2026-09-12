import {
  TriggerCalendarOccurrence,
  TriggerCalendarTrigger,
} from '@activepieces/shared';

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

type Ymd = { year: number; month: number; day: number };

function ymdKey(day: Ymd): string {
  const month = String(day.month + 1).padStart(2, '0');
  const date = String(day.day).padStart(2, '0');
  return `${day.year}-${month}-${date}`;
}

function compareYmd(a: Ymd, b: Ymd): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

function addCalendarDay(day: Ymd): Ymd {
  const next = new Date(Date.UTC(day.year, day.month, day.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth(),
    day: next.getUTCDate(),
  };
}

// Calendar (Y/M/D) in timeZone for the given instant. Uses Intl directly so the
// result never depends on the browser's own timezone.
function zonedYmd(instantUtcMs: number, timeZone: string): Ymd {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(instantUtcMs));
  const map = new Map(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')) - 1,
    day: Number(map.get('day')),
  };
}

// UTC epoch ms of local midnight on the given calendar day.
function localMidnightUtcMs(day: Ymd, timeZone: string): number {
  const midnightWall = Date.UTC(day.year, day.month, day.day);
  // Seed with the noon offset (noon is never inside a DST gap/repeat), then
  // resolve the actual offset at the candidate midnight and correct once. On a
  // DST transition day midnight and noon carry different offsets.
  const seedOffset = offsetMinutesAt(
    Date.UTC(day.year, day.month, day.day, 12),
    timeZone,
  );
  const candidate = midnightWall - seedOffset * 60_000;
  const actualOffset = offsetMinutesAt(candidate, timeZone);
  return midnightWall - actualOffset * 60_000;
}

// Produces one bucket per local day in the display timezone that the future
// window [windowStart, windowEnd) touches — including trigger-free days.
//
// All calendar arithmetic goes through Intl + UTC epoch math rather than
// dayjs .tz().startOf('day'): that chain keeps the pre-conversion wall clock
// while swapping the offset, so when the browser TZ differs from the display
// TZ the grid starts a day early and gains an extra bucket. Iterating calendar
// dates and resolving each midnight independently also survives DST (23/25h
// local days cannot make the loop drift or double count).
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

  const windowStartMs = Date.parse(windowStartIso);
  const windowEndMs = Date.parse(windowEndIso);

  const firstDay = zonedYmd(windowStartMs, displayTimezone);
  const lastDayExclusive = zonedYmd(windowEndMs, displayTimezone);

  const buckets = new Map<string, CalendarDayBucket>();
  for (
    let day = firstDay;
    compareYmd(day, lastDayExclusive) < 0;
    day = addCalendarDay(day)
  ) {
    const dayKey = ymdKey(day);
    buckets.set(dayKey, {
      dayKey,
      label: formatDayLabel(localMidnightUtcMs(day, displayTimezone)),
      occurrences: [],
    });
  }

  for (const occurrence of occurrences) {
    const trigger = flowById.get(occurrence.flowId);
    if (!trigger) {
      continue;
    }
    const dayKey = ymdKey(
      zonedYmd(Date.parse(occurrence.time), displayTimezone),
    );
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

// Offset of `timeZone` at the given instant, in minutes (east positive).
export function offsetMinutesAt(
  instantUtcMs: number,
  timeZone: string,
): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(instantUtcMs));
  const map = new Map(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(map.get('year')),
    Number(map.get('month')) - 1,
    Number(map.get('day')),
    Number(map.get('hour')) % 24,
    Number(map.get('minute')),
    Number(map.get('second')),
  );
  return Math.round((asUtc - instantUtcMs) / 60_000);
}

function formatDayLabel(instantUtcMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(instantUtcMs));
}
