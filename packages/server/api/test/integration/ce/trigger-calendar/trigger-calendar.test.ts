import { apId } from '@activepieces/core-utils'
import { FlowStatus, FlowVersionState, ScheduleOptions, TriggerSourceScheduleType, TriggerStrategy, UncategorizedFolderId } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import {
    createMockFlow,
    createMockFlowVersion,
} from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Trigger Calendar API', () => {
    it('lists upcoming occurrences, non-scheduled triggers and invalid schedules', async () => {
        const ctx = await createTestContext(app!)

        const scheduledFlow = await seedFlow({
            ctx,
            displayName: 'daily-new-york',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 9 * * *',
                timezone: 'America/New_York',
            },
            triggerType: TriggerStrategy.POLLING,
        })
        const collidingFlow = await seedFlow({
            ctx,
            displayName: 'daily-utc',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 14 * * *',
                timezone: 'UTC',
            },
            triggerType: TriggerStrategy.POLLING,
        })
        const webhookFlow = await seedFlow({
            ctx,
            displayName: 'on-webhook',
            schedule: null,
            triggerType: TriggerStrategy.WEBHOOK,
        })
        const intervalFlow = await seedFlow({
            ctx,
            displayName: 'rolling',
            schedule: {
                type: TriggerSourceScheduleType.INTERVAL,
                intervalMs: 300_000,
            },
            triggerType: TriggerStrategy.POLLING,
        })
        const invalidFlow = await seedFlow({
            ctx,
            displayName: 'broken-cron',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: 'not a cron',
                timezone: 'UTC',
            },
            triggerType: TriggerStrategy.POLLING,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days: 7 })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = response.json()

        expect(body.windowStart).toBeDefined()
        expect(body.windowEnd).toBeDefined()
        expect(body.scheduled.map((trigger: { flowId: string }) => trigger.flowId).sort()).toEqual(
            [scheduledFlow.id, collidingFlow.id, invalidFlow.id].sort(),
        )
        expect(body.occurrences.length).toBeGreaterThan(0)
        expect(body.occurrences.every((occurrence: { time: string }) => occurrence.time > body.windowStart)).toBe(true)

        const issueFlowIds = body.issues.map((issue: { flowId: string, kind: string }) => issue.flowId)
        expect(issueFlowIds).toContain(invalidFlow.id)
        expect(body.issues.find((issue: { flowId: string }) => issue.flowId === invalidFlow.id).kind).toBe('INVALID_CRON')

        const nonScheduledFlowIds = body.nonScheduled.map((trigger: { flowId: string }) => trigger.flowId)
        expect(nonScheduledFlowIds).toContain(webhookFlow.id)
        expect(nonScheduledFlowIds).toContain(intervalFlow.id)
        expect(body.nonScheduled.find((trigger: { flowId: string }) => trigger.flowId === webhookFlow.id).kind).toBe('WEBHOOK')
        expect(body.restrictedCount).toBe(0)
    })

    it('excludes disabled flows even when a trigger source row exists', async () => {
        const ctx = await createTestContext(app!)

        const enabled = await seedFlow({
            ctx,
            displayName: 'enabled-flow',
            schedule: cronEveryMidnight(),
            triggerType: TriggerStrategy.POLLING,
        })
        const disabled = await seedFlow({
            ctx,
            displayName: 'disabled-flow',
            schedule: cronEveryMidnight(),
            triggerType: TriggerStrategy.POLLING,
            status: FlowStatus.DISABLED,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days: 7 })
        const body = response.json()

        const flowIds = body.scheduled.map((trigger: { flowId: string }) => trigger.flowId)
        expect(flowIds).toContain(enabled.id)
        expect(flowIds).not.toContain(disabled.id)
        expect(body.occurrences.every((occurrence: { flowId: string }) => occurrence.flowId !== disabled.id)).toBe(true)
        expect(body.nonScheduled.map((trigger: { flowId: string }) => trigger.flowId)).not.toContain(disabled.id)
        expect(body.restrictedCount).toBe(0)
    })

    it('returns an empty calendar for a project with no enabled schedule triggers', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days: 7 })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = response.json()
        expect(body.scheduled).toEqual([])
        expect(body.occurrences).toEqual([])
        expect(body.conflicts).toEqual([])
        expect(body.issues).toEqual([])
        expect(body.nonScheduled).toEqual([])
        expect(body.restrictedCount).toBe(0)
        expect(new Date(body.windowEnd).getTime() - new Date(body.windowStart).getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    })

    it('does not list occurrences for valid cron schedules with no match inside the window', async () => {
        const ctx = await createTestContext(app!)

        const flow = await seedFlow({
            ctx,
            displayName: 'feb-twenty-ninth',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 0 29 2 *',
                timezone: 'UTC',
            },
            triggerType: TriggerStrategy.POLLING,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days: 7 })
        const body = response.json()

        expect(body.scheduled.map((trigger: { flowId: string }) => trigger.flowId)).toEqual([flow.id])
        expect(body.occurrences).toEqual([])
        expect(body.issues).toEqual([])
        expect(body.conflicts).toEqual([])
    })

    it('carries the DST flag on occurrences crossing a daylight saving transition', async () => {
        const ctx = await createTestContext(app!)

        const transition = nextDstTransition(new Date())
        const days = Math.ceil((transition.date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) + 2
        if (days > 90) {
            return
        }

        await seedFlow({
            ctx,
            displayName: 'dst-zone-daily',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: transition.cronExpression,
                timezone: transition.timezone,
            },
            triggerType: TriggerStrategy.POLLING,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days })
        const body = response.json()

        const flagged = body.occurrences.filter((occurrence: { dstTransition: boolean, time: string }) => {
            const distance = Math.abs(new Date(occurrence.time).getTime() - transition.date.getTime())
            return occurrence.dstTransition && distance < 36 * 60 * 60 * 1000
        })
        expect(flagged.length).toBeGreaterThanOrEqual(1)
    })

    it('filters by flow, folder and timezone', async () => {
        const ctx = await createTestContext(app!)

        const kept = await seedFlow({
            ctx,
            displayName: 'kept',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 9 * * *',
                timezone: 'America/New_York',
            },
            triggerType: TriggerStrategy.POLLING,
        })
        await seedFlow({
            ctx,
            displayName: 'filtered-out',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 9 * * *',
                timezone: 'Asia/Tokyo',
            },
            triggerType: TriggerStrategy.POLLING,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', {
            projectId: ctx.project.id,
            days: 7,
            flowIds: kept.id,
            timezones: 'America/New_York',
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = response.json()
        expect(body.scheduled).toHaveLength(1)
        expect(body.scheduled[0].flowId).toBe(kept.id)
        expect(body.occurrences.every((occurrence: { flowId: string }) => occurrence.flowId === kept.id)).toBe(true)
        expect(body.nonScheduled).toHaveLength(0)
    })

    it('filters by folder including the uncategorized sentinel', async () => {
        const ctx = await createTestContext(app!)

        const folder = await db.save('folder', [{
            id: apId(),
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            projectId: ctx.project.id,
            displayName: 'folder-a',
            externalId: apId(),
            displayOrder: 0,
        }])

        const inFolder = await seedFlow({
            ctx,
            displayName: 'in-folder',
            schedule: { type: TriggerSourceScheduleType.CRON_EXPRESSION, cronExpression: '0 9 * * *', timezone: 'UTC' },
            triggerType: TriggerStrategy.POLLING,
            folderId: folder[0].id,
        })
        const withoutFolder = await seedFlow({
            ctx,
            displayName: 'no-folder',
            schedule: { type: TriggerSourceScheduleType.CRON_EXPRESSION, cronExpression: '0 9 * * *', timezone: 'UTC' },
            triggerType: TriggerStrategy.POLLING,
        })

        const folderResponse = await ctx.get('/v1/trigger-calendar/calendar', {
            projectId: ctx.project.id,
            days: 7,
            folderIds: folder[0].id,
        })
        expect(folderResponse.json().scheduled.map((trigger: { flowId: string }) => trigger.flowId)).toEqual([inFolder.id])

        const uncategorizedResponse = await ctx.get('/v1/trigger-calendar/calendar', {
            projectId: ctx.project.id,
            days: 7,
            folderIds: UncategorizedFolderId,
        })
        const uncategorizedIds = uncategorizedResponse.json().scheduled.map((trigger: { flowId: string }) => trigger.flowId)
        expect(uncategorizedIds).toContain(withoutFolder.id)
        expect(uncategorizedIds).not.toContain(inFolder.id)
    })

    it('never leaks triggers of a different project', async () => {
        const ctx = await createTestContext(app!)
        const otherCtx = await createTestContext(app!)

        await seedFlow({
            ctx,
            displayName: 'mine',
            schedule: cronEveryMidnight(),
            triggerType: TriggerStrategy.POLLING,
        })
        await seedFlow({
            ctx: otherCtx,
            displayName: 'theirs',
            schedule: cronEveryMidnight(),
            triggerType: TriggerStrategy.POLLING,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days: 7 })
        const body = response.json()

        expect(body.scheduled.map((trigger: { flowName: string }) => trigger.flowName)).toEqual(['mine'])
        const otherFlowIds = new Set(body.scheduled.filter((trigger: { flowName: string }) => trigger.flowName === 'theirs').map((trigger: { flowId: string }) => trigger.flowId))
        expect(body.occurrences.some((occurrence: { flowId: string }) => otherFlowIds.has(occurrence.flowId))).toBe(false)
    })

    it('never lets disabled flows participate in same-minute conflicts', async () => {
        const ctx = await createTestContext(app!)

        await seedFlow({
            ctx,
            displayName: 'enabled-midnight',
            schedule: cronEveryMidnight(),
            triggerType: TriggerStrategy.POLLING,
        })
        await seedFlow({
            ctx,
            displayName: 'disabled-midnight',
            schedule: cronEveryMidnight(),
            triggerType: TriggerStrategy.POLLING,
            status: FlowStatus.DISABLED,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days: 3 })
        const body = response.json()

        expect(body.scheduled.map((trigger: { flowName: string }) => trigger.flowName)).toEqual(['enabled-midnight'])
        expect(body.conflicts).toEqual([])
        expect(body.restrictedCount).toBe(0)
    })

    it('marks same-minute collisions across distinct flows but not repeated occurrences of one flow', async () => {
        const ctx = await createTestContext(app!)
        await seedFlow({
            ctx,
            displayName: 'collision-a',
            schedule: cronEveryMidnight(),
            triggerType: TriggerStrategy.POLLING,
        })
        await seedFlow({
            ctx,
            displayName: 'collision-b',
            schedule: cronEveryMidnight(),
            triggerType: TriggerStrategy.POLLING,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days: 3 })
        const body = response.json()
        expect(body.conflicts.length).toBeGreaterThan(0)
        expect(body.conflicts[0].flowIds).toHaveLength(2)
    })
})

function cronEveryMidnight(): ScheduleOptions {
    return {
        type: TriggerSourceScheduleType.CRON_EXPRESSION,
        cronExpression: '0 0 * * *',
        timezone: 'UTC',
    }
}

type DstTransition = {
    date: Date
    timezone: string
    cronExpression: string
}

const DST_TRANSITION_CANDIDATES: Array<Omit<DstTransition, 'date'> & { month: number, weekday: number, weekOfMonth: number, hourUtc: number }> = [
    // US spring-forward: second Sunday in March, 02:30 local resolves to 07:30 UTC
    { month: 2, weekday: 0, weekOfMonth: 2, hourUtc: 7, timezone: 'America/New_York', cronExpression: '30 2 * * *' },
    // EU spring-forward: last Sunday in March, 02:30 local resolves to 01:30 UTC
    { month: 2, weekday: 0, weekOfMonth: -1, hourUtc: 1, timezone: 'Europe/Berlin', cronExpression: '30 2 * * *' },
    // Australia spring-forward: first Sunday in October, 02:30 local resolves to 15:30 UTC (previous day)
    { month: 9, weekday: 0, weekOfMonth: 1, hourUtc: 15, timezone: 'Australia/Sydney', cronExpression: '30 2 * * *' },
    // New Zealand spring-forward: last Sunday in September, 02:30 local resolves to 13:30 UTC
    { month: 8, weekday: 0, weekOfMonth: -1, hourUtc: 13, timezone: 'Pacific/Auckland', cronExpression: '30 2 * * *' },
]

function nextDstTransition(now: Date): DstTransition {
    const years = [now.getUTCFullYear(), now.getUTCFullYear() + 1]
    const candidates: DstTransition[] = years.flatMap((year) => DST_TRANSITION_CANDIDATES.map((candidate) => ({
        date: candidate.weekOfMonth === -1
            ? lastWeekdayUtc({ year, month: candidate.month, weekday: candidate.weekday, hourUtc: candidate.hourUtc })
            : nthWeekdayUtc({ year, month: candidate.month, weekday: candidate.weekday, nth: candidate.weekOfMonth, hourUtc: candidate.hourUtc }),
        timezone: candidate.timezone,
        cronExpression: candidate.cronExpression,
    })))
    const upcoming = candidates
        .filter((candidate) => candidate.date.getTime() > now.getTime())
        .sort((a, b) => a.date.getTime() - b.date.getTime())
    return upcoming[0]
}

function nthWeekdayUtc(params: { year: number, month: number, weekday: number, nth: number, hourUtc: number }): Date {
    const first = new Date(Date.UTC(params.year, params.month, 1))
    const offset = (params.weekday - first.getUTCDay() + 7) % 7
    const day = 1 + offset + (params.nth - 1) * 7
    return new Date(Date.UTC(params.year, params.month, day, params.hourUtc, 30, 0))
}

function lastWeekdayUtc(params: { year: number, month: number, weekday: number, hourUtc: number }): Date {
    const lastDay = new Date(Date.UTC(params.year, params.month + 1, 0))
    const day = lastDay.getUTCDate() - ((lastDay.getUTCDay() - params.weekday + 7) % 7)
    return new Date(Date.UTC(params.year, params.month, day, params.hourUtc, 30, 0))
}

async function seedFlow(params: SeedFlowParams): Promise<{ id: string }> {
    const { ctx, displayName, schedule, triggerType, folderId, status = FlowStatus.ENABLED } = params
    const flow = createMockFlow({
        projectId: ctx.project.id,
        status,
        folderId: folderId ?? null,
    })
    const version = createMockFlowVersion({
        flowId: flow.id,
        displayName,
        state: FlowVersionState.LOCKED,
    })
    await db.save('flow', [flow])
    await db.save('flow_version', [version])
    if (status === FlowStatus.ENABLED) {
        await db.update('flow', flow.id, { publishedVersionId: version.id })
    }
    await db.save('trigger_source', [{
        id: apId(),
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        flowId: flow.id,
        flowVersionId: version.id,
        projectId: ctx.project.id,
        pieceName: '@activepieces/piece-schedule',
        pieceVersion: '0.1.0',
        triggerName: 'cron_expression',
        type: triggerType,
        simulate: false,
        schedule,
        deleted: null,
    }])
    return { id: flow.id }
}

type SeedFlowParams = {
    ctx: TestContext
    displayName: string
    schedule: ScheduleOptions | null
    triggerType: TriggerStrategy
    folderId?: string | null
    status?: FlowStatus
}
