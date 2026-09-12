import { describe, expect, it } from 'vitest'

import { getCronOccurrences } from '../../../../../src/app/trigger/trigger-calendar/cron-occurrence-helper'
import { buildConflicts } from '../../../../../src/app/trigger/trigger-calendar/trigger-calendar-service'

describe('buildConflicts', () => {
    const windowStart = new Date('2026-09-12T10:00:00Z').getTime()
    const occurrencesOfA = getCronOccurrences({
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        windowStart: new Date(windowStart),
        windowEnd: new Date(windowStart + 2 * 86_400_000),
    }).map((occurrence) => ({ flowId: 'a', time: occurrence.time, utcOffsetMinutes: 0, dstTransition: false }))

    it('returns no conflict when a single flow fires on multiple days', () => {
        expect(buildConflicts(occurrencesOfA)).toEqual([])
    })

    it('groups distinct flows whose occurrences land in the same minute', () => {
        const conflicts = buildConflicts([
            ...occurrencesOfA,
            { flowId: 'b', time: occurrencesOfA[0].time, utcOffsetMinutes: 0, dstTransition: false },
        ].sort((a, b) => a.time.localeCompare(b.time) || a.flowId.localeCompare(b.flowId)))
        expect(conflicts).toHaveLength(1)
        expect(conflicts[0].flowIds.sort()).toEqual(['a', 'b'])
        expect(conflicts[0].time).toBe(occurrencesOfA[0].time)
    })

    it('does not group occurrences that differ by one minute', () => {
        const oneMinuteLater = new Date(new Date(occurrencesOfA[0].time).getTime() + 60_000).toISOString()
        const conflicts = buildConflicts([
            ...occurrencesOfA,
            { flowId: 'b', time: oneMinuteLater, utcOffsetMinutes: 0, dstTransition: false },
        ])
        expect(conflicts).toEqual([])
    })
})
