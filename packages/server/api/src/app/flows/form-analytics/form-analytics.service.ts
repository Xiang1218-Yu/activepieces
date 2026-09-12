import { apId, isNil } from '@activepieces/core-utils'
import {
    FlowRunStatus,
    FormAnalyticsRow,
    FormFieldAbandonment,
    FormFunnelStage,
    FormSessionAttribution,
    FormSessionEvent,
    FormSessionStatus,
    FORM_SESSION_ABANDONMENT_MS,
    ListFormAnalyticsRequestQuery,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { In } from 'typeorm'
import { flowRepo } from '../flow/flow.repo'
import { formAnalyticsRunRepo, formFieldInteractionRepo, formSessionRepo } from './form-analytics.repo'

const eventToStatus: Record<Exclude<FormSessionEvent, FormSessionEvent.VISIT>, FormSessionStatus> = {
    [FormSessionEvent.START]: FormSessionStatus.STARTED,
    [FormSessionEvent.SUBMIT]: FormSessionStatus.SUBMITTED,
    [FormSessionEvent.FAILURE]: FormSessionStatus.FAILED,
    [FormSessionEvent.TIMEOUT]: FormSessionStatus.TIMED_OUT,
}

const TERMINAL_STATUSES: FormSessionStatus[] = [
    FormSessionStatus.SUBMITTED,
    FormSessionStatus.FAILED,
    FormSessionStatus.TIMED_OUT,
]

export const formAnalyticsService = (log: FastifyBaseLogger) => ({
    async startSession(params: StartSessionParams): Promise<{ sessionId: string }> {
        const { flowId, visitorKey, useDraft, attribution, userId } = params
        const flow = await flowRepo().findOneBy({ id: flowId })
        if (isNil(flow) || (isNil(flow.publishedVersionId) && !useDraft)) {
            return { sessionId: apId() }
        }
        const existing = await formSessionRepo().findOne({
            where: {
                flowId,
                visitorKey,
                useDraft: useDraft ?? false,
            },
            order: {
                created: 'DESC',
            },
        })
        if (!isNil(existing) && isOpenStatus(existing.status)) {
            return { sessionId: existing.id }
        }
        const session = await formSessionRepo().save({
            id: apId(),
            projectId: flow.projectId,
            flowId,
            flowVersionId: useDraft ? null : flow.publishedVersionId,
            visitorKey,
            attribution,
            userId,
            status: FormSessionStatus.VISITED,
            runId: null,
            useDraft: useDraft ?? false,
            lastEventAt: new Date().toISOString(),
        })
        log.debug({ flowId, sessionId: session.id }, 'form session started')
        return { sessionId: session.id }
    },

    async trackEvent(params: TrackEventParams): Promise<void> {
        const { flowId, sessionId, event, attribution, userId, reachedFields } = params
        if (event === FormSessionEvent.VISIT) {
            return
        }
        const session = await formSessionRepo().findOneBy({ id: sessionId, flowId })
        if (isNil(session) || session.useDraft) {
            return
        }
        const nextStatus = eventToStatus[event]
        const resolvedAttribution = session.attribution === FormSessionAttribution.AUTHENTICATED
            ? session.attribution
            : attribution
        const shouldAdvanceStatus = !TERMINAL_STATUSES.includes(session.status) || nextStatus !== FormSessionStatus.STARTED
        if (shouldAdvanceStatus) {
            await formSessionRepo().update(session.id, {
                status: nextStatus,
                attribution: resolvedAttribution,
                userId: session.userId ?? userId,
                lastEventAt: new Date().toISOString(),
            })
        }
        for (const fieldName of reachedFields ?? []) {
            await upsertFieldRow({
                session: { ...session, attribution: resolvedAttribution },
                fieldName,
                reached: true,
                interacted: false,
            })
        }
    },

    async trackFieldInteraction(params: TrackFieldInteractionParams): Promise<void> {
        const { sessionId, flowId, fieldName, reachedFieldNames } = params
        const session = await formSessionRepo().findOneBy({ id: sessionId, flowId })
        if (isNil(session) || session.useDraft) {
            return
        }
        for (const reachedField of reachedFieldNames ?? [fieldName]) {
            const isInteracted = reachedField === fieldName
            await upsertFieldRow({
                session,
                fieldName: reachedField,
                reached: true,
                interacted: isInteracted,
            })
        }
    },

    async linkRunToSession(params: LinkRunParams): Promise<void> {
        const { sessionId, flowId, runId } = params
        if (isNil(sessionId) || sessionId.length === 0) {
            return
        }
        await formSessionRepo().update({
            id: sessionId,
            flowId,
            useDraft: false,
        }, {
            runId,
            lastEventAt: new Date().toISOString(),
        })
    },

    async linkLatestRun(params: LinkLatestRunParams): Promise<void> {
        const { sessionId, flowId, submittedAt } = params
        if (isNil(sessionId) || sessionId.length === 0) {
            return
        }
        const session = await formSessionRepo().findOneBy({ id: sessionId, flowId })
        if (isNil(session) || session.useDraft) {
            return
        }
        const lowerBound = new Date(new Date(submittedAt).getTime() - 10 * 1000)
        const upperBound = new Date(new Date(submittedAt).getTime() + 5 * 60 * 1000)
        const candidate = await formAnalyticsRunRepo()
            .createQueryBuilder('run')
            .where('run."flowId" = :flowId', { flowId })
            .andWhere('run."projectId" = :projectId', { projectId: session.projectId })
            .andWhere('run.created BETWEEN :lowerBound AND :upperBound', { lowerBound, upperBound })
            .orderBy('run.created', 'DESC')
            .getOne()
        if (isNil(candidate)) {
            return
        }
        const claimedByAnother = await formSessionRepo().findOne({
            where: {
                runId: candidate.id,
            },
        })
        if (!isNil(claimedByAnother) && claimedByAnother.id !== session.id) {
            return
        }
        await formSessionRepo().update(session.id, {
            runId: candidate.id,
            lastEventAt: new Date().toISOString(),
        })
    },

    async getFunnel(query: ListFormAnalyticsRequestQuery): Promise<{ data: FormAnalyticsRow[] }> {
        const sessions = await querySessions(query)
        const runIds = unique(sessions.map((session) => session.runId).filter((id): id is string => !isNil(id)))
        const runsById = await loadRunsByIds(runIds)

        const enriched: ReconciledSession[] = []
        for (const session of sessions) {
            if (isNil(session.runId)) {
                const reconciled = reconcileWithoutRun(session)
                if (!isNil(reconciled)) {
                    enriched.push(reconciled)
                }
                continue
            }
            const run = runsById.get(session.runId)
            if (isNil(run) || !isNil(run.archivedAt)) {
                continue
            }
            enriched.push(reconcileWithRun(session, run))
        }
        const visibleSessionIds = enriched.map((session) => session.id)
        const fields = await loadFields(visibleSessionIds)

        const rows = aggregate(enriched, fields)
        return { data: rows }
    },
})

async function upsertFieldRow(params: UpsertFieldRowParams): Promise<void> {
    const { session, fieldName, reached, interacted } = params
    const label = extractFieldLabel(fieldName)
    const existing = await formFieldInteractionRepo().findOne({
        where: {
            sessionId: session.id,
            fieldName,
        },
    })
    if (!isNil(existing)) {
        if (interacted && !existing.interacted) {
            await formFieldInteractionRepo().update(existing.id, { interacted: true })
        }
        return
    }
    await formFieldInteractionRepo().insert({
        id: apId(),
        projectId: session.projectId,
        flowId: session.flowId,
        flowVersionId: session.flowVersionId,
        sessionId: session.id,
        fieldName,
        fieldLabel: label,
        reached,
        interacted,
        attribution: session.attribution,
    })
}

function extractFieldLabel(fieldName: string): string {
    const spaced = fieldName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

async function querySessions(query: ListFormAnalyticsRequestQuery): Promise<ReconciledSession[]> {
    const qb = formSessionRepo().createQueryBuilder('session')
    qb.where('session."projectId" = :projectId', { projectId: query.projectId })
        .andWhere('session."useDraft" = false')
    if (!isNil(query.flowId)) {
        qb.andWhere('session."flowId" = :flowId', { flowId: query.flowId })
    }
    if (!isNil(query.flowVersionId)) {
        qb.andWhere('session."flowVersionId" = :flowVersionId', { flowVersionId: query.flowVersionId })
    }
    if (!isNil(query.createdAfter)) {
        qb.andWhere('session.created >= :createdAfter', { createdAfter: query.createdAfter })
    }
    if (!isNil(query.createdBefore)) {
        qb.andWhere('session.created <= :createdBefore', { createdBefore: query.createdBefore })
    }
    if (!isNil(query.attribution)) {
        qb.andWhere('session.attribution = :attribution', { attribution: query.attribution })
    }
    const rows = await qb.getMany()
    return rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        flowId: row.flowId,
        flowVersionId: row.flowVersionId,
        attribution: row.attribution,
        status: row.status,
        runId: row.runId,
        useDraft: row.useDraft,
        created: typeof row.created === 'string' ? row.created : new Date(row.created).toISOString(),
        lastEventAt: typeof row.lastEventAt === 'string' ? row.lastEventAt : new Date(row.lastEventAt).toISOString(),
        effectiveStatus: row.status,
    }))
}

async function loadRunsByIds(runIds: string[]): Promise<Map<string, ReconciledRun>> {
    if (runIds.length === 0) {
        return new Map()
    }
    const runs = new Map<string, ReconciledRun>()
    for (const batch of chunk(runIds, 500)) {
        const batchRuns = await formAnalyticsRunRepo().find({
            where: {
                id: In(batch),
            },
        })
        for (const run of batchRuns) {
            runs.set(run.id, {
                status: run.status,
                archivedAt: run.archivedAt,
                flowVersionId: run.flowVersionId,
            })
        }
    }
    return runs
}

async function loadFields(sessionIds: string[]): Promise<Map<string, FieldRow[]>> {
    if (sessionIds.length === 0) {
        return new Map()
    }
    const result = new Map<string, FieldRow[]>()
    for (const batch of chunk(sessionIds, 500)) {
        const rows = await formFieldInteractionRepo().find({
            where: {
                sessionId: In(batch),
            },
        })
        for (const row of rows) {
            const list = result.get(row.sessionId) ?? []
            list.push({
                fieldName: row.fieldName,
                fieldLabel: row.fieldLabel,
                reached: row.reached,
                interacted: row.interacted,
                flowVersionId: row.flowVersionId,
            })
            result.set(row.sessionId, list)
        }
    }
    return result
}

function reconcileWithoutRun(session: ReconciledSession): ReconciledSession | null {
    if (isOpenStatus(session.status)) {
        if (!isStale(session)) {
            return { ...session, effectiveStatus: session.status }
        }
        return { ...session, effectiveStatus: FormSessionStatus.ABANDONED }
    }
    return null
}

function reconcileWithRun(session: ReconciledSession, run: ReconciledRun): ReconciledSession {
    const statusFromRun = mapRunStatus(run.status)
    const sessionRank = TERMINAL_STATUSES.indexOf(session.status)
    const runRank = isNil(statusFromRun) ? -1 : TERMINAL_STATUSES.indexOf(statusFromRun)
    const shouldPromote = runRank > sessionRank
    return {
        ...session,
        flowVersionId: run.flowVersionId ?? session.flowVersionId,
        effectiveStatus: shouldPromote && !isNil(statusFromRun) ? statusFromRun : session.status,
    }
}

function isStale(session: ReconciledSession): boolean {
    const lastEvent = new Date(session.lastEventAt).getTime()
    if (Number.isNaN(lastEvent)) {
        return true
    }
    return Date.now() - lastEvent > FORM_SESSION_ABANDONMENT_MS
}

function isOpenStatus(status: FormSessionStatus): boolean {
    return status === FormSessionStatus.VISITED || status === FormSessionStatus.STARTED
}

function mapRunStatus(status: FlowRunStatus): FormSessionStatus | null {
    switch (status) {
        case FlowRunStatus.SUCCEEDED:
            return FormSessionStatus.SUBMITTED
        case FlowRunStatus.FAILED:
        case FlowRunStatus.INTERNAL_ERROR:
        case FlowRunStatus.QUOTA_EXCEEDED:
        case FlowRunStatus.MEMORY_LIMIT_EXCEEDED:
        case FlowRunStatus.LOG_SIZE_EXCEEDED:
        case FlowRunStatus.CANCELED:
            return FormSessionStatus.FAILED
        case FlowRunStatus.TIMEOUT:
            return FormSessionStatus.TIMED_OUT
        default:
            return null
    }
}

function aggregate(sessions: ReconciledSession[], fieldsBySession: Map<string, FieldRow[]>): FormAnalyticsRow[] {
    const groups = new Map<string, ReconciledSession[]>()
    for (const session of sessions) {
        const date = session.created.slice(0, 10)
        const versionId = session.flowVersionId ?? 'unversioned'
        const key = `${date}|${session.flowId}|${versionId}|${session.attribution}`
        const list = groups.get(key) ?? []
        list.push(session)
        groups.set(key, list)
    }

    const rows: FormAnalyticsRow[] = []
    for (const [key, groupSessions] of groups.entries()) {
        const [date, flowId, flowVersionId, attribution] = key.split('|')
        const funnel = buildFunnel(countStatuses(groupSessions))
        const fields = aggregateFields(groupSessions, fieldsBySession)
        rows.push({
            date,
            flowId,
            flowVersionId,
            attribution: attribution as FormSessionAttribution,
            funnel,
            fields,
        })
    }
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return rows
}

function countStatuses(sessions: ReconciledSession[]): Record<FormSessionStatus, number> {
    const counts: Record<FormSessionStatus, number> = {
        [FormSessionStatus.VISITED]: 0,
        [FormSessionStatus.STARTED]: 0,
        [FormSessionStatus.SUBMITTED]: 0,
        [FormSessionStatus.FAILED]: 0,
        [FormSessionStatus.TIMED_OUT]: 0,
        [FormSessionStatus.ABANDONED]: 0,
    }
    for (const session of sessions) {
        counts[session.effectiveStatus] += 1
    }
    return counts
}

function buildFunnel(counts: Record<FormSessionStatus, number>): FormFunnelStage[] {
    const visited = Object.values(counts).reduce((sum, count) => sum + count, 0)
    const started = counts[FormSessionStatus.STARTED] + counts[FormSessionStatus.SUBMITTED]
        + counts[FormSessionStatus.FAILED] + counts[FormSessionStatus.TIMED_OUT]
    return [
        { key: FormSessionStatus.VISITED, label: 'Visited', count: visited },
        { key: FormSessionStatus.STARTED, label: 'Started', count: started },
        { key: FormSessionStatus.SUBMITTED, label: 'Submitted', count: counts[FormSessionStatus.SUBMITTED] },
        { key: FormSessionStatus.FAILED, label: 'Failed', count: counts[FormSessionStatus.FAILED] },
        { key: FormSessionStatus.TIMED_OUT, label: 'Timed out', count: counts[FormSessionStatus.TIMED_OUT] },
        { key: FormSessionStatus.ABANDONED, label: 'Abandoned', count: counts[FormSessionStatus.ABANDONED] },
    ]
}

function aggregateFields(sessions: ReconciledSession[], fieldsBySession: Map<string, FieldRow[]>): FormFieldAbandonment[] {
    const byField = new Map<string, { reached: number, interacted: number, label: string }>()
    for (const session of sessions) {
        const rows = fieldsBySession.get(session.id) ?? []
        for (const row of rows) {
            if (!row.reached) {
                continue
            }
            const entry = byField.get(row.fieldName) ?? { reached: 0, interacted: 0, label: row.fieldLabel }
            entry.reached += 1
            if (row.interacted) {
                entry.interacted += 1
            }
            byField.set(row.fieldName, entry)
        }
    }
    return Array.from(byField.entries())
        .map(([fieldName, entry]) => {
            const abandonedAt = entry.reached - entry.interacted
            return {
                fieldName,
                fieldLabel: entry.label,
                reached: entry.reached,
                interacted: entry.interacted,
                abandonedAt,
                abandonmentRate: entry.reached === 0 ? 0 : Number((abandonedAt / entry.reached).toFixed(4)),
            }
        })
        .sort((a, b) => b.abandonedAt - a.abandonedAt)
}

function unique<T>(values: T[]): T[] {
    return Array.from(new Set(values))
}

function chunk<T>(values: T[], size: number): T[][] {
    const batches: T[][] = []
    for (let i = 0; i < values.length; i += size) {
        batches.push(values.slice(i, i + size))
    }
    return batches
}

type StartSessionParams = {
    flowId: string
    visitorKey: string
    useDraft: boolean
    attribution: FormSessionAttribution
    userId: string | null
}

type TrackEventParams = {
    flowId: string
    sessionId: string
    event: FormSessionEvent
    attribution: FormSessionAttribution
    userId: string | null
    reachedFields?: string[]
}

type TrackFieldInteractionParams = {
    sessionId: string
    flowId: string
    fieldName: string
    reachedFieldNames?: string[]
}

type LinkRunParams = {
    sessionId: string
    flowId: string
    runId: string
}

type LinkLatestRunParams = {
    sessionId: string
    flowId: string
    submittedAt: string
}

type UpsertFieldRowParams = {
    session: {
        id: string
        projectId: string
        flowId: string
        flowVersionId: string | null
        attribution: FormSessionAttribution
    }
    fieldName: string
    reached: boolean
    interacted: boolean
}

type ReconciledRun = {
    status: FlowRunStatus
    archivedAt: string | null
    flowVersionId: string
}

type FieldRow = {
    fieldName: string
    fieldLabel: string
    reached: boolean
    interacted: boolean
    flowVersionId: string | null
}

type ReconciledSession = {
    id: string
    projectId: string
    flowId: string
    flowVersionId: string | null
    attribution: FormSessionAttribution
    status: FormSessionStatus
    runId: string | null
    useDraft: boolean
    created: string
    lastEventAt: string
    effectiveStatus: FormSessionStatus
}
