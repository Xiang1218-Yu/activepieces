import { isNil } from '@activepieces/core-utils'
import {
    GetTriggerCalendarRequest,
    ScheduleOptions,
    TriggerCalendarConflict,
    TriggerCalendarIssue,
    TriggerCalendarIssueKind,
    TriggerCalendarOccurrence,
    TriggerCalendarResponse,
    TriggerCalendarTrigger,
    TriggerCalendarTriggerKind,
    TriggerCalendarWindowDefaultDays,
    TriggerSourceScheduleType,
    TriggerStrategy,
    UncategorizedFolderId,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../core/db/repo-factory'
import { TriggerSourceEntity } from '../trigger-source/trigger-source-entity'
import { getCronOccurrences, validateCronSchedule } from './cron-occurrence-helper'

const triggerCalendarRepo = repoFactory(TriggerSourceEntity)

export type CalendarSourceRow = {
    id: string
    type: TriggerStrategy
    pieceName: string
    pieceVersion: string
    triggerName: string
    schedule: ScheduleOptions | null
    flowId: string
    flowFolderId: string | null
    folderName: string | null
    flowName: string
}

export const triggerCalendarService = (log: FastifyBaseLogger): TriggerCalendarService => ({
    async getCalendar(params: GetCalendarParams): Promise<TriggerCalendarResponse> {
        const { projectId, request } = params
        const now = new Date()
        const days = request.days ?? TriggerCalendarWindowDefaultDays
        const windowStart = now
        const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

        const rows = await queryEnabledSources({ projectId, request })

        const scheduled: TriggerCalendarTrigger[] = []
        const nonScheduled: TriggerCalendarTrigger[] = []
        const issues: TriggerCalendarIssue[] = []
        const occurrences: TriggerCalendarOccurrence[] = []

        for (const row of rows) {
            if (row.type !== TriggerStrategy.POLLING) {
                nonScheduled.push(toNonScheduledTrigger(row))
                continue
            }

            const classification = classifyPollingTrigger(row)
            if (classification.kind === TriggerCalendarTriggerKind.INTERVAL) {
                nonScheduled.push({
                    ...toTriggerBase(row),
                    kind: TriggerCalendarTriggerKind.INTERVAL,
                    cronExpression: null,
                    timezone: null,
                    intervalMs: Number.isFinite(classification.intervalMs) ? classification.intervalMs : null,
                })
                if (!Number.isSafeInteger(classification.intervalMs) || classification.intervalMs < 60_000) {
                    issues.push(toIssue({
                        row,
                        kind: TriggerCalendarIssueKind.INVALID_INTERVAL,
                        cronExpression: null,
                        timezone: null,
                        intervalMs: Number.isFinite(classification.intervalMs) ? classification.intervalMs : null,
                    }))
                }
                continue
            }

            const timezones = request.timezones
            const matchesTimezone = isNil(timezones) || timezones.length === 0 || timezones.includes(classification.timezone)
            if (!matchesTimezone) {
                continue
            }

            scheduled.push({
                ...toTriggerBase(row),
                kind: TriggerCalendarTriggerKind.SCHEDULED,
                cronExpression: classification.cronExpression,
                timezone: classification.timezone,
                intervalMs: null,
            })

            const problem = validateCronSchedule({
                cronExpression: classification.cronExpression,
                timezone: classification.timezone,
            })
            if (!isNil(problem)) {
                issues.push(toIssue({
                    row,
                    kind: problem.kind,
                    cronExpression: classification.cronExpression,
                    timezone: classification.timezone,
                    intervalMs: null,
                }))
                continue
            }

            const computed = getCronOccurrences({
                cronExpression: classification.cronExpression,
                timezone: classification.timezone,
                windowStart,
                windowEnd,
            })
            for (const occurrence of computed) {
                occurrences.push({
                    flowId: row.flowId,
                    time: occurrence.time,
                    utcOffsetMinutes: occurrence.utcOffsetMinutes,
                    dstTransition: occurrence.dstTransition,
                })
            }
        }

        occurrences.sort((a, b) => a.time.localeCompare(b.time) || a.flowId.localeCompare(b.flowId))
        const conflicts = buildConflicts(occurrences)

        log.info({
            projectId,
            flows: rows.length,
            scheduled: scheduled.length,
            nonScheduled: nonScheduled.length,
            occurrences: occurrences.length,
            conflicts: conflicts.length,
            issues: issues.length,
        }, '[triggerCalendarService#getCalendar] computed trigger calendar')

        return {
            generatedAt: now.toISOString(),
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            scheduled,
            occurrences,
            conflicts,
            issues,
            nonScheduled,
            restrictedCount: 0,
        }
    },
})

async function queryEnabledSources({ projectId, request }: { projectId: string, request: GetTriggerCalendarRequest }): Promise<CalendarSourceRow[]> {
    const query = triggerCalendarRepo()
        .createQueryBuilder('ts')
        .innerJoin('flow', 'flow', 'flow.id = ts."flowId"')
        .leftJoin('folder', 'folder', 'folder.id = flow."folderId"')
        .innerJoin('flow_version', 'fv', 'fv.id = flow."publishedVersionId"')
        .select([
            'ts.id AS id',
            'ts.type AS type',
            'ts."pieceName" AS "pieceName"',
            'ts."pieceVersion" AS "pieceVersion"',
            'ts."triggerName" AS "triggerName"',
            'ts.schedule AS schedule',
            'ts."flowId" AS "flowId"',
            'flow."folderId" AS "flowFolderId"',
            'folder."displayName" AS "folderName"',
            'fv."displayName" AS "flowName"',
        ])
        .where('ts."projectId" = :projectId', { projectId })
        .andWhere('ts.simulate = false')
        .andWhere('ts.deleted IS NULL')
        .andWhere('flow."operationStatus" != :deleting', { deleting: 'DELETING' })

    if (!isNil(request.flowIds) && request.flowIds.length > 0) {
        query.andWhere('ts."flowId" IN (:...flowIds)', { flowIds: request.flowIds })
    }
    if (!isNil(request.folderIds) && request.folderIds.length > 0) {
        if (request.folderIds.includes(UncategorizedFolderId)) {
            const explicitFolders = request.folderIds.filter((folderId) => folderId !== UncategorizedFolderId)
            query.andWhere('(flow."folderId" IS NULL OR flow."folderId" IN (:...explicitFolders))', { explicitFolders: explicitFolders.length > 0 ? explicitFolders : ['__none__'] })
        }
        else {
            query.andWhere('flow."folderId" IN (:...folderIds)', { folderIds: request.folderIds })
        }
    }

    return query.getRawMany<CalendarSourceRow>()
}

type PollingClassification =
    | {
        kind: typeof TriggerCalendarTriggerKind.SCHEDULED
        cronExpression: string
        timezone: string
    }
    | {
        kind: typeof TriggerCalendarTriggerKind.INTERVAL
        intervalMs: number
    }

function classifyPollingTrigger(row: CalendarSourceRow): PollingClassification {
    const schedule: unknown = row.schedule
    if (!isRecord(schedule)) {
        return {
            kind: TriggerCalendarTriggerKind.INTERVAL,
            intervalMs: Number.NaN,
        }
    }
    if (schedule.type === TriggerSourceScheduleType.CRON_EXPRESSION) {
        return {
            kind: TriggerCalendarTriggerKind.SCHEDULED,
            cronExpression: typeof schedule.cronExpression === 'string' ? schedule.cronExpression : '',
            timezone: typeof schedule.timezone === 'string' ? schedule.timezone : 'UTC',
        }
    }
    if (schedule.type === TriggerSourceScheduleType.INTERVAL) {
        return {
            kind: TriggerCalendarTriggerKind.INTERVAL,
            intervalMs: Number(schedule.intervalMs),
        }
    }
    return {
        kind: TriggerCalendarTriggerKind.INTERVAL,
        intervalMs: Number.NaN,
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function toTriggerBase(row: CalendarSourceRow): Omit<TriggerCalendarTrigger, 'kind' | 'cronExpression' | 'timezone' | 'intervalMs'> {
    return {
        flowId: row.flowId,
        flowName: row.flowName,
        folderId: row.flowFolderId,
        folderName: row.folderName,
        pieceName: row.pieceName,
        pieceVersion: row.pieceVersion,
        triggerName: row.triggerName,
    }
}

function toNonScheduledTrigger(row: CalendarSourceRow): TriggerCalendarTrigger {
    return {
        ...toTriggerBase(row),
        kind: mapNonScheduledKind(row.type),
        cronExpression: null,
        timezone: null,
        intervalMs: null,
    }
}

function mapNonScheduledKind(type: TriggerStrategy): Exclude<TriggerCalendarTriggerKind, typeof TriggerCalendarTriggerKind.SCHEDULED | typeof TriggerCalendarTriggerKind.INTERVAL> {
    switch (type) {
        case TriggerStrategy.WEBHOOK:
            return TriggerCalendarTriggerKind.WEBHOOK
        case TriggerStrategy.APP_WEBHOOK:
            return TriggerCalendarTriggerKind.APP_WEBHOOK
        case TriggerStrategy.MANUAL:
        case TriggerStrategy.POLLING:
            return TriggerCalendarTriggerKind.MANUAL
    }
}

function toIssue(params: ToIssueParams): TriggerCalendarIssue {
    return {
        flowId: params.row.flowId,
        flowName: params.row.flowName,
        kind: params.kind,
        cronExpression: params.cronExpression,
        timezone: params.timezone,
        intervalMs: isNil(params.intervalMs) || Number.isNaN(params.intervalMs) ? null : params.intervalMs,
    }
}

function buildConflicts(occurrences: TriggerCalendarOccurrence[]): TriggerCalendarConflict[] {
    const conflicts: TriggerCalendarConflict[] = []
    let index = 0
    while (index < occurrences.length) {
        const minuteKey = occurrences[index].time.slice(0, 16)
        let end = index + 1
        while (end < occurrences.length && occurrences[end].time.slice(0, 16) === minuteKey) {
            end++
        }
        if (end - index > 1) {
            const flowIds = [...new Set(occurrences.slice(index, end).map((occurrence) => occurrence.flowId))]
            if (flowIds.length > 1) {
                conflicts.push({
                    time: occurrences[index].time,
                    flowIds,
                })
            }
        }
        index = end
    }
    return conflicts
}

type GetCalendarParams = {
    projectId: string
    request: GetTriggerCalendarRequest
}

type TriggerCalendarService = {
    getCalendar(params: GetCalendarParams): Promise<TriggerCalendarResponse>
}

type ToIssueParams = {
    row: CalendarSourceRow
    kind: (typeof TriggerCalendarIssueKind)[keyof typeof TriggerCalendarIssueKind]
    cronExpression: string | null
    timezone: string | null
    intervalMs: number | null
}
