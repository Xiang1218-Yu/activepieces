// @vitest-environment node
import {
  TriggerCalendarOccurrence,
  TriggerCalendarTrigger,
  TriggerCalendarTriggerKind,
} from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import { buildDayBuckets } from './day-buckets';

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

describe('buildDayBuckets', () => {
  it('creates one bucket per local day in the window, including days without triggers', () => {
    const buckets = buildDayBuckets({
      occurrences: [occurrence('a', '2026-09-13T09:00:00.000Z')],
      flowById: new Map([['a', flow('a', 'A')]]),
      conflictingFlowIds: new Set(),
      displayTimezone: 'UTC',
      windowStartIso: '2026-09-12T10:00:00.000Z',
      windowEndIso: '2026-09-15T10:00:00.000Z',
    });

    expect(buckets.map((bucket) => bucket.dayKey)).toEqual([
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    ]);
    expect(buckets[0].occurrences).toEqual([]);
    expect(buckets[1].occurrences).toHaveLength(1);
    expect(buckets[2].occurrences).toEqual([]);
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

  it('buckets occurrences by the local day of the display timezone, not UTC', () => {
    // 03:00 UTC on Sep 13 is 23:00 EDT on Sep 12
    const buckets = buildDayBuckets({
      occurrences: [occurrence('a', '2026-09-13T03:00:00.000Z')],
      flowById: new Map([['a', flow('a', 'A', 'America/New_York')]]),
      conflictingFlowIds: new Set(),
      displayTimezone: 'America/New_York',
      windowStartIso: '2026-09-12T04:00:00.000Z',
      windowEndIso: '2026-09-14T04:00:00.000Z',
    });

    expect(buckets.map((bucket) => bucket.dayKey)).toEqual([
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(
      buckets.find((bucket) => bucket.dayKey === '2026-09-12')?.occurrences,
    ).toHaveLength(1);
    expect(
      buckets.find((bucket) => bucket.dayKey === '2026-09-13')?.occurrences,
    ).toEqual([]);
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
