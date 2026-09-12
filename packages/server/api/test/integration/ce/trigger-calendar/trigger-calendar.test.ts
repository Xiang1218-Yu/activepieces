import { apId } from '@activepieces/core-utils'
import { FlowStatus, FlowVersionState, ScheduleOptions, TriggerSourceScheduleType, TriggerStrategy, UncategorizedFolderId } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import {
    createMockFlow,
    createMockFlowVersion,
} from '../../../helpers/mocks'
import { createTestContext } from '../../../helpers/test-context'
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

        const scheduledFlow = await seedEnabledFlow({
            ctx,
            displayName: 'daily-new-york',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 9 * * *',
                timezone: 'America/New_York',
            },
            triggerType: TriggerStrategy.POLLING,
        })
        const collidingFlow = await seedEnabledFlow({
            ctx,
            displayName: 'daily-utc',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 14 * * *',
                timezone: 'UTC',
            },
            triggerType: TriggerStrategy.POLLING,
        })
        const webhookFlow = await seedEnabledFlow({
            ctx,
            displayName: 'on-webhook',
            schedule: null,
            triggerType: TriggerStrategy.WEBHOOK,
        })
        const intervalFlow = await seedEnabledFlow({
            ctx,
            displayName: 'rolling',
            schedule: {
                type: TriggerSourceScheduleType.INTERVAL,
                intervalMs: 300_000,
            },
            triggerType: TriggerStrategy.POLLING,
        })
        const invalidFlow = await seedEnabledFlow({
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
    })

    it('filters by flow, folder and timezone', async () => {
        const ctx = await createTestContext(app!)

        const kept = await seedEnabledFlow({
            ctx,
            displayName: 'kept',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 9 * * *',
                timezone: 'America/New_York',
            },
            triggerType: TriggerStrategy.POLLING,
        })
        await seedEnabledFlow({
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

        const inFolder = await seedEnabledFlow({
            ctx,
            displayName: 'in-folder',
            schedule: { type: TriggerSourceScheduleType.CRON_EXPRESSION, cronExpression: '0 9 * * *', timezone: 'UTC' },
            triggerType: TriggerStrategy.POLLING,
            folderId: folder[0].id,
        })
        const withoutFolder = await seedEnabledFlow({
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

    it('marks same-minute collisions across flows', async () => {
        const ctx = await createTestContext(app!)
        await seedEnabledFlow({
            ctx,
            displayName: 'collision-a',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 0 * * *',
                timezone: 'UTC',
            },
            triggerType: TriggerStrategy.POLLING,
        })
        await seedEnabledFlow({
            ctx,
            displayName: 'collision-b',
            schedule: {
                type: TriggerSourceScheduleType.CRON_EXPRESSION,
                cronExpression: '0 0 * * *',
                timezone: 'UTC',
            },
            triggerType: TriggerStrategy.POLLING,
        })

        const response = await ctx.get('/v1/trigger-calendar/calendar', { projectId: ctx.project.id, days: 3 })
        const body = response.json()
        expect(body.conflicts.length).toBeGreaterThan(0)
        expect(body.conflicts[0].flowIds).toHaveLength(2)
    })
})

async function seedEnabledFlow(params: SeedEnabledFlowParams): Promise<{ id: string }> {
    const { ctx, displayName, schedule, triggerType, folderId } = params
    const flow = createMockFlow({
        projectId: ctx.project.id,
        status: FlowStatus.ENABLED,
        folderId: folderId ?? null,
    })
    const version = createMockFlowVersion({
        flowId: flow.id,
        displayName,
        state: FlowVersionState.LOCKED,
    })
    await db.save('flow', [flow])
    await db.save('flow_version', [version])
    await db.update('flow', flow.id, { publishedVersionId: version.id })
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

type SeedEnabledFlowParams = {
    ctx: Awaited<ReturnType<typeof createTestContext>>
    displayName: string
    schedule: ScheduleOptions | null
    triggerType: TriggerStrategy
    folderId?: string | null
}
