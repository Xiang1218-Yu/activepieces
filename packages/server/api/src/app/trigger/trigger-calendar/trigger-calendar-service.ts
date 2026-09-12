import { ActivepiecesError, ErrorCode, isNil, Permission } from '@activepieces/core-utils'
import {
    ApEdition,
    FlowOperationStatus,
    FlowStatus,
    GetTriggerCalendarRequest,
    Principal,
    PrincipalType,
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
import { getPrincipalRoleOrThrow } from '../../ee/authentication/project-role/rbac-middleware'
import { system } from '../../helper/system/system'
import { TriggerSourceEntity } from '../trigger-source/trigger-source-entity'
import { getCronOccurrences, validateCronSchedule } from './cron-occurrence-helper'

const EDITION_REQUIRES_RBAC = [ApEdition.CLOUD, ApEdition.ENTERPRISE].includes(system.getEdition())

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
        const { projectId, request, principal } = params
        const now = new Date()
        const days = request.days ?? TriggerCalendarWindowDefaultDays
        const windowStart = now
        const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

        const canReadFlows = await principalCanReadFlows({ projectId, principal, log })
        if (isNil(canReadFlows)) {
            return emptyCalendar({ windowStart, windowEnd, now })
        }

        // All enabled, published trigger sources matching the requested filters.
        // The visibility partition is applied in memory so that restrictedCount
        // reflects the exact same flow/folder slice the caller asked for.
        const candidateRows = await queryEnabledSources({ projectId, request })
        const rows = canReadFlows ? candidateRows : []
        const restrictedCount = canReadFlows ? 0 : candidateRows.length

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
            restrictedCount,
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
            restrictedCount,
        }
    },
})

// True when the principal may read every flow in the project; false when it is
// a project member whose role lacks READ_FLOW; null for callers with no project
// membership at all (the route membership guard normally prevents reaching this).
async function principalCanReadFlows(params: {
    projectId: string
    principal: Principal
    log: FastifyBaseLogger
}): Promise<boolean | null> {
    const { projectId, principal, log } = params
    if (principal.type === PrincipalType.SERVICE || principal.type === PrincipalType.ENGINE || !EDITION_REQUIRES_RBAC) {
        return true
    }
    if (principal.type !== PrincipalType.USER) {
        return false
    }
    let role
    try {
        role = await getPrincipalRoleOrThrow(principal.id, projectId, log)
    }
    catch (error) {
        if (error instanceof ActivepiecesError && error.error.code === ErrorCode.AUTHORIZATION) {
            return null
        }
        throw error
    }
    return role.permissions.includes(Permission.READ_FLOW)
}

function emptyCalendar(params: { windowStart: Date, windowEnd: Date, now: Date }): TriggerCalendarResponse {
    return {
        generatedAt: params.now.toISOString(),
        windowStart: params.windowStart.toISOString(),
        windowEnd: params.windowEnd.toISOString(),
        scheduled: [],
        occurrences: [],
        conflicts: [],
        issues: [],
        nonScheduled: [],
        restrictedCount: 0,
    }
}

async function queryEnabledSources(params: {
    projectId: string
    request: GetTriggerCalendarRequest
}): Promise<CalendarSourceRow[]> {
    const { projectId, request } = params
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
        .andWhere('flow.status = :enabled', { enabled: FlowStatus.ENABLED })
        .andWhere('flow."operationStatus" != :deleting', { deleting: FlowOperationStatus.DELETING })

    if (!isNil(request.flowIds) && request.flowIds.length > 0) {
        query.andWhere('ts."flowId" IN (:...requestedFlowIds)', { requestedFlowIds: request.flowIds })
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

export function buildConflicts(occurrences: TriggerCalendarOccurrence[]): TriggerCalendarConflict[] {
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
    principal: Principal
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
