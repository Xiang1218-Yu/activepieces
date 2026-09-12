import { z } from 'zod'
import { OptionalArrayFromQuery } from '@activepieces/core-utils'

export const TriggerCalendarWindowDefaultDays = 7
export const TriggerCalendarWindowMaxDays = 90
export const TriggerCalendarMaxOccurrencesPerTrigger = 500

export const TriggerCalendarIssueKind = {
    INVALID_CRON: 'INVALID_CRON',
    INVALID_TIMEZONE: 'INVALID_TIMEZONE',
    INVALID_INTERVAL: 'INVALID_INTERVAL',
} as const

export const TriggerCalendarTriggerKind = {
    SCHEDULED: 'SCHEDULED',
    INTERVAL: 'INTERVAL',
    WEBHOOK: 'WEBHOOK',
    APP_WEBHOOK: 'APP_WEBHOOK',
    MANUAL: 'MANUAL',
} as const

export type TriggerCalendarTriggerKind = typeof TriggerCalendarTriggerKind[keyof typeof TriggerCalendarTriggerKind]

export const GetTriggerCalendarRequest = z.object({
    projectId: z.string(),
    flowIds: OptionalArrayFromQuery(z.string()),
    folderIds: OptionalArrayFromQuery(z.string()),
    timezones: OptionalArrayFromQuery(z.string()),
    days: z.coerce.number().int().min(1).max(TriggerCalendarWindowMaxDays).optional(),
})
export type GetTriggerCalendarRequest = z.infer<typeof GetTriggerCalendarRequest>

export const TriggerCalendarTrigger = z.object({
    flowId: z.string(),
    flowName: z.string(),
    folderId: z.string().nullable(),
    folderName: z.string().nullable(),
    pieceName: z.string(),
    pieceVersion: z.string(),
    triggerName: z.string(),
    kind: z.enum([
        TriggerCalendarTriggerKind.SCHEDULED,
        TriggerCalendarTriggerKind.INTERVAL,
        TriggerCalendarTriggerKind.WEBHOOK,
        TriggerCalendarTriggerKind.APP_WEBHOOK,
        TriggerCalendarTriggerKind.MANUAL,
    ]),
    cronExpression: z.string().nullable(),
    timezone: z.string().nullable(),
    intervalMs: z.number().nullable(),
})
export type TriggerCalendarTrigger = z.infer<typeof TriggerCalendarTrigger>

export const TriggerCalendarOccurrence = z.object({
    flowId: z.string(),
    time: z.string(),
    utcOffsetMinutes: z.number(),
    dstTransition: z.boolean(),
})
export type TriggerCalendarOccurrence = z.infer<typeof TriggerCalendarOccurrence>

export const TriggerCalendarConflict = z.object({
    time: z.string(),
    flowIds: z.array(z.string()),
})
export type TriggerCalendarConflict = z.infer<typeof TriggerCalendarConflict>

export const TriggerCalendarIssue = z.object({
    flowId: z.string(),
    flowName: z.string(),
    kind: z.enum([
        TriggerCalendarIssueKind.INVALID_CRON,
        TriggerCalendarIssueKind.INVALID_TIMEZONE,
        TriggerCalendarIssueKind.INVALID_INTERVAL,
    ]),
    cronExpression: z.string().nullable(),
    timezone: z.string().nullable(),
    intervalMs: z.number().nullable(),
})
export type TriggerCalendarIssue = z.infer<typeof TriggerCalendarIssue>

export const TriggerCalendarResponse = z.object({
    generatedAt: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    scheduled: z.array(TriggerCalendarTrigger),
    occurrences: z.array(TriggerCalendarOccurrence),
    conflicts: z.array(TriggerCalendarConflict),
    issues: z.array(TriggerCalendarIssue),
    nonScheduled: z.array(TriggerCalendarTrigger),
    restrictedCount: z.number(),
})
export type TriggerCalendarResponse = z.infer<typeof TriggerCalendarResponse>
