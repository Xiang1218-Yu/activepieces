import { isNil } from '@activepieces/core-utils'
import {
    TriggerCalendarIssueKind,
    TriggerCalendarMaxOccurrencesPerTrigger,
} from '@activepieces/shared'
import { parseExpression } from 'cron-parser'
import { isValidCron } from 'cron-validator'

export type CronOccurrence = {
    time: string
    utcOffsetMinutes: number
    dstTransition: boolean
}

export type CronScheduleProblem =
    | { kind: typeof TriggerCalendarIssueKind.INVALID_CRON }
    | { kind: typeof TriggerCalendarIssueKind.INVALID_TIMEZONE }

export function validateCronSchedule({ cronExpression, timezone }: ValidateCronScheduleParams): CronScheduleProblem | null {
    if (!isValidTimeZone(timezone)) {
        return { kind: TriggerCalendarIssueKind.INVALID_TIMEZONE }
    }
    if (!isValidCron(cronExpression, { alias: false, seconds: false, allowSevenAsSunday: false, allowBlankDay: false })) {
        if (!canParseCron({ cronExpression, timezone })) {
            return { kind: TriggerCalendarIssueKind.INVALID_CRON }
        }
    }
    else if (!canParseCron({ cronExpression, timezone })) {
        return { kind: TriggerCalendarIssueKind.INVALID_CRON }
    }
    return null
}

function canParseCron({ cronExpression, timezone }: { cronExpression: string, timezone: string }): boolean {
    try {
        parseExpression(cronExpression, { tz: timezone, currentDate: new Date(0) })
        return true
    }
    catch {
        return false
    }
}

function isValidTimeZone(timezone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone })
        return true
    }
    catch {
        return false
    }
}

export function getCronOccurrences({ cronExpression, timezone, windowStart, windowEnd }: GetCronOccurrencesParams): CronOccurrence[] {
    const interval = parseExpression(cronExpression, {
        tz: timezone,
        currentDate: windowStart,
        iterator: false,
    })
    const occurrences: CronOccurrence[] = []
    let cursor: Date | null = interval.next().toDate()
    while (!isNil(cursor) && cursor.getTime() < windowEnd.getTime()) {
        const previous = occurrences.length > 0 ? occurrences[occurrences.length - 1] : null
        occurrences.push(describeOccurrence({ date: cursor, timezone, previous }))
        if (occurrences.length >= TriggerCalendarMaxOccurrencesPerTrigger) {
            break
        }
        cursor = interval.next().toDate()
    }
    return occurrences
}

function describeOccurrence({ date, timezone, previous }: DescribeOccurrenceParams): CronOccurrence {
    const utcOffsetMinutes = getOffsetMinutes({ date, timezone })
    const dstTransition = !isNil(previous) && previous.utcOffsetMinutes !== utcOffsetMinutes
    return {
        time: date.toISOString(),
        utcOffsetMinutes,
        dstTransition,
    }
}

function getOffsetMinutes({ date, timezone }: { date: Date, timezone: string }): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
    const asUTC = Date.UTC(
        Number(map.get('year')),
        Number(map.get('month')) - 1,
        Number(map.get('day')),
        Number(map.get('hour')) % 24,
        Number(map.get('minute')),
        Number(map.get('second')),
    )
    return Math.round((asUTC - date.getTime()) / 60000)
}

type ValidateCronScheduleParams = {
    cronExpression: string
    timezone: string
}

type GetCronOccurrencesParams = {
    cronExpression: string
    timezone: string
    windowStart: Date
    windowEnd: Date
}

type DescribeOccurrenceParams = {
    date: Date
    timezone: string
    previous: CronOccurrence | null
}
