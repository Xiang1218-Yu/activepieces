// @vitest-environment node
import {
  TriggerCalendarOccurrence,
  TriggerCalendarTrigger,
  TriggerCalendarTriggerKind,
} from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import { buildDayBuckets, offsetMinutesAt } from './day-buckets';

const flow = (
  flowId: string,
  flowName: string,
  timezone = 'UTC',
): TriggerCalendarTrigger => ({
  flowId,
  flowName,
  folderId: null,
  folderName: null,
  pieceName: '@activepieces/piece-schedule',
  pieceVersion: '0.1.0',
  triggerName: 'cron_expression',
  kind: TriggerCalendarTriggerKind.SCHEDULED,
  cronExpression: '0 9 * * *',
  timezone,
  intervalMs: null,
});

const occurrence = (
  flowId: string,
  isoTime: string,
): TriggerCalendarOccurrence => ({
  flowId,
  time: isoTime,
  utcOffsetMinutes: 0,
  dstTransition: false,
});

// A 7-day window starting 2026-09-12 15:00 UTC.
const WINDOW_START = '2026-09-12T15:00:00.000Z';
const WINDOW_END = '2026-09-19T15:00:00.000Z';

describe('buildDayBuckets', () => {
  it('creates one bucket per local day in the window, including trigger-free days', () => {
    const buckets = buildDayBuckets({
      occurrences: [occurrence('a', '2026-09-13T09:00:00.000Z')],
      flowById: new Map([['a', flow('a', 'A')]]),
      conflictingFlowIds: new Set(),
      displayTimezone: 'UTC',
      windowStartIso: WINDOW_START,
      windowEndIso: WINDOW_END,
    });

    expect(buckets.map((bucket) => bucket.dayKey)).toEqual([
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ]);
    expect(buckets[0].occurrences).toEqual([]);
    expect(buckets[1].occurrences).toHaveLength(1);
    expect(buckets[2].occurrences).toEqual([]);
  });

  it('covers exactly the future window and never starts a day early in a non-UTC display timezone', () => {
    // 03:00 UTC on Sep 13 is still Sep 12 in New York. A 7-day window starting
    // 15:00 UTC Sep 12 must span Sep 12..Sep 18 NY local days, seven buckets —
    // not eight starting Sep 11 (the dayjs browser-TZ bug).
    const buckets = buildDayBuckets({
      occurrences: [occurrence('a', '2026-09-13T03:00:00.000Z')],
      flowById: new Map([['a', flow('a', 'A', 'America/New_York')]]),
      conflictingFlowIds: new Set(),
      displayTimezone: 'America/New_York',
      windowStartIso: WINDOW_START,
      windowEndIso: WINDOW_END,
    });

    expect(buckets.map((bucket) => bucket.dayKey)).toEqual([
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ]);
    expect(
      buckets.find((bucket) => bucket.dayKey === '2026-09-12')?.occurrences,
    ).toHaveLength(1);
    expect(
      buckets.find((bucket) => bucket.dayKey === '2026-09-11'),
    ).toBeUndefined();
    expect(
      buckets.find((bucket) => bucket.dayKey === '2026-09-19'),
    ).toBeUndefined();
  });

  it('handles a display timezone ahead of UTC without gaining an extra trailing day', () => {
    // Tokyo is UTC+9. The window start (Sep 12 15:00 UTC) is already Sep 13
    // local, and the end (Sep 19 15:00 UTC) is Sep 20 local — but the end
    // instant is the local day of Sep 20, so local days covered are
    // Sep 13..Sep 19, still seven buckets.
    const buckets = buildDayBuckets({
      occurrences: [],
      flowById: new Map(),
      conflictingFlowIds: new Set(),
      displayTimezone: 'Asia/Tokyo',
      windowStartIso: WINDOW_START,
      windowEndIso: WINDOW_END,
    });

    expect(buckets.map((bucket) => bucket.dayKey)).toEqual([
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
    ]);
    expect(buckets.every((bucket) => bucket.occurrences.length === 0)).toBe(
      true,
    );
  });

  it('stays correct across a DST transition without dropping or doubling a day', () => {
    // US spring-forward is Mar 8 2026; window covers 9 local days either side.
    const buckets = buildDayBuckets({
      occurrences: [],
      flowById: new Map(),
      conflictingFlowIds: new Set(),
      displayTimezone: 'America/New_York',
      windowStartIso: '2026-03-04T15:00:00.000Z',
      windowEndIso: '2026-03-13T15:00:00.000Z',
    });

    expect(buckets.map((bucket) => bucket.dayKey)).toEqual([
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
    ]);
  });

  it('drops occurrences for flows missing from flowById (disabled or invisible)', () => {
    const buckets = buildDayBuckets({
      occurrences: [
        occurrence('visible', '2026-09-13T09:00:00.000Z'),
        occurrence('restricted', '2026-09-13T10:00:00.000Z'),
      ],
      flowById: new Map([['visible', flow('visible', 'Visible')]]),
      conflictingFlowIds: new Set(),
      displayTimezone: 'UTC',
      windowStartIso: '2026-09-12T00:00:00.000Z',
      windowEndIso: '2026-09-14T00:00:00.000Z',
    });

    const busyDay = buckets.find((bucket) => bucket.dayKey === '2026-09-13');
    expect(busyDay?.occurrences.map((entry) => entry.flowName)).toEqual([
      'Visible',
    ]);
  });

  it('marks entries that are part of a server-computed conflict', () => {
    const conflictTime = '2026-09-13T09:00:00.000Z';
    const buckets = buildDayBuckets({
      occurrences: [
        occurrence('a', conflictTime),
        occurrence('b', conflictTime),
      ],
      flowById: new Map([
        ['a', flow('a', 'A')],
        ['b', flow('b', 'B')],
      ]),
      conflictingFlowIds: new Set([`${conflictTime}|a`, `${conflictTime}|b`]),
      displayTimezone: 'UTC',
      windowStartIso: '2026-09-12T00:00:00.000Z',
      windowEndIso: '2026-09-14T00:00:00.000Z',
    });

    const busyDay = buckets.find((bucket) => bucket.dayKey === '2026-09-13');
    expect(busyDay?.occurrences.every((entry) => entry.conflict)).toBe(true);
  });
});

describe('offsetMinutesAt', () => {
  it('returns the offset in effect at the instant, independent of browser TZ', () => {
    expect(offsetMinutesAt(Date.parse('2026-01-15T12:00:00Z'), 'UTC')).toBe(0);
    expect(
      offsetMinutesAt(Date.parse('2026-01-15T12:00:00Z'), 'Asia/Tokyo'),
    ).toBe(540);
    expect(
      offsetMinutesAt(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York'),
    ).toBe(-300);
    expect(
      offsetMinutesAt(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York'),
    ).toBe(-240);
  });
});
