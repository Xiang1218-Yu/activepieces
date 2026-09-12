import { describe, expect, it } from 'vitest'
import { getCronOccurrences, validateCronSchedule } from '../../../../../src/app/trigger/trigger-calendar/cron-occurrence-helper'

describe('cron-occurrence-helper', () => {
    describe('validateCronSchedule', () => {
        it('accepts a valid five-field cron and timezone', () => {
            expect(validateCronSchedule({ cronExpression: '0 9 * * 1-5', timezone: 'America/New_York' })).toBeNull()
        })

        it('rejects malformed cron expressions', () => {
            expect(validateCronSchedule({ cronExpression: 'not a cron', timezone: 'UTC' })).toEqual({ kind: 'INVALID_CRON' })
        })

        it('rejects six-field cron expressions', () => {
            expect(validateCronSchedule({ cronExpression: '0 9 * * 1-5 2026', timezone: 'UTC' })).toEqual({ kind: 'INVALID_CRON' })
        })

        it('accepts cron aliases accepted by BullMQ even though cron-validator rejects them', () => {
            expect(validateCronSchedule({ cronExpression: '@daily', timezone: 'UTC' })).toBeNull()
        })

        it('rejects unknown timezones without blaming the cron expression', () => {
            expect(validateCronSchedule({ cronExpression: '0 9 * * *', timezone: 'Mars/Olympus' })).toEqual({ kind: 'INVALID_TIMEZONE' })
        })
    })

    describe('getCronOccurrences', () => {
        const windowStart = new Date('2026-09-12T00:00:00.000Z')
        const windowEnd = new Date('2026-09-19T00:00:00.000Z')

        it('returns occurrences in the instance timezone', () => {
            const occurrences = getCronOccurrences({
                cronExpression: '0 9 * * 1-5',
                timezone: 'America/New_York',
                windowStart,
                windowEnd,
            })
            expect(occurrences).toHaveLength(5)
            expect(occurrences.map((occurrence) => occurrence.time.slice(0, 10))).toEqual([
                '2026-09-14',
                '2026-09-15',
                '2026-09-16',
                '2026-09-17',
                '2026-09-18',
            ])
            expect(occurrences[0].time).toBe('2026-09-14T13:00:00.000Z')
            expect(occurrences[0].utcOffsetMinutes).toBe(-240)
        })

        it('marks the occurrence crossing the spring-forward DST transition', () => {
            const occurrences = getCronOccurrences({
                cronExpression: '30 2 * * *',
                timezone: 'America/New_York',
                windowStart: new Date('2026-03-05T00:00:00.000Z'),
                windowEnd: new Date('2026-03-12T00:00:00.000Z'),
            })
            const transitionDay = occurrences.find((occurrence) => occurrence.time.startsWith('2026-03-08'))
            expect(transitionDay?.dstTransition).toBe(true)
            expect(occurrences.filter((occurrence) => occurrence.dstTransition)).toHaveLength(1)
        })

        it('marks the occurrence crossing the fall-back DST transition', () => {
            const occurrences = getCronOccurrences({
                cronExpression: '0 1 * * *',
                timezone: 'America/New_York',
                windowStart: new Date('2026-10-30T00:00:00.000Z'),
                windowEnd: new Date('2026-11-03T00:00:00.000Z'),
            })
            expect(occurrences.find((occurrence) => occurrence.time.startsWith('2026-11-02'))?.dstTransition).toBe(true)
        })

        it('does not flag DST before any offset change has been observed', () => {
            const occurrences = getCronOccurrences({
                cronExpression: '30 2 * * *',
                timezone: 'Australia/Sydney',
                windowStart: new Date('2026-10-02T00:00:00.000Z'),
                windowEnd: new Date('2026-10-03T00:00:00.000Z'),
            })
            expect(occurrences).toHaveLength(1)
            expect(occurrences[0].dstTransition).toBe(false)
        })

        it('marks the first offset change after the transition day', () => {
            const occurrences = getCronOccurrences({
                cronExpression: '30 2 * * *',
                timezone: 'Australia/Sydney',
                windowStart: new Date('2026-10-02T00:00:00.000Z'),
                windowEnd: new Date('2026-10-05T00:00:00.000Z'),
            })
            const flagged = occurrences.filter((occurrence) => occurrence.dstTransition)
            expect(flagged).toHaveLength(1)
            expect(flagged[0].time.startsWith('2026-10-03')).toBe(true)
        })

        it('does not flag DST for fixed-offset timezones', () => {
            const occurrences = getCronOccurrences({
                cronExpression: '0 * * * *',
                timezone: 'UTC',
                windowStart,
                windowEnd,
            })
            expect(occurrences.some((occurrence) => occurrence.dstTransition)).toBe(false)
        })
    })
})
