import { apId, Permission, RoleType } from '@activepieces/core-utils'
import { FlowStatus, FlowVersionState, ScheduleOptions, TriggerSourceScheduleType, TriggerStrategy } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import {
    createMockFlow,
    createMockFlowVersion,
    createMockProjectRole,
} from '../../../helpers/mocks'
import { createMemberContext, createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Trigger Calendar API authorization', () => {
    it('hides every flow from a member whose custom role lacks READ_FLOW but reports the restricted count', async () => {
        const owner = await createTestContext(app!)

        await seedEnabledScheduledFlow(owner)
        await seedEnabledScheduledFlow(owner, { displayName: 'webhook-only', triggerType: TriggerStrategy.WEBHOOK })

        const role = createMockProjectRole({
            platformId: owner.platform.id,
            name: `calendar-no-read-${apId()}`,
            type: RoleType.CUSTOM,
            permissions: [Permission.READ_RUN],
        })
        await db.save('project_role', role)
        const restrictedMember = await createMemberContext(app!, owner, { projectRole: role.name })

        const response = await restrictedMember.get('/v1/trigger-calendar/calendar', {
            projectId: owner.project.id,
            days: 7,
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = response.json()
        expect(body.restrictedCount).toBe(2)
        expect(body.scheduled).toEqual([])
        expect(body.nonScheduled).toEqual([])
        expect(body.occurrences).toEqual([])
        expect(body.conflicts).toEqual([])
        expect(body.issues).toEqual([])
        expect(JSON.stringify(body)).not.toContain('daily-visible')
        expect(JSON.stringify(body)).not.toContain('webhook-only')
    })

    it('lists flows for a member with READ_FLOW and reports no restricted flows', async () => {
        const owner = await createTestContext(app!)
        await seedEnabledScheduledFlow(owner)

        const role = createMockProjectRole({
            platformId: owner.platform.id,
            name: `calendar-read-${apId()}`,
            type: RoleType.CUSTOM,
            permissions: [Permission.READ_FLOW],
        })
        await db.save('project_role', role)
        const member = await createMemberContext(app!, owner, { projectRole: role.name })

        const response = await member.get('/v1/trigger-calendar/calendar', {
            projectId: owner.project.id,
            days: 7,
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = response.json()
        expect(body.restrictedCount).toBe(0)
        expect(body.scheduled.map((trigger: { flowName: string }) => trigger.flowName)).toEqual(['daily-visible'])
    })
})

async function seedEnabledScheduledFlow(
    ctx: TestContext,
    options: { displayName?: string, triggerType?: TriggerStrategy } = {},
): Promise<void> {
    const displayName = options.displayName ?? 'daily-visible'
    const triggerType = options.triggerType ?? TriggerStrategy.POLLING
    const schedule: ScheduleOptions | null = triggerType === TriggerStrategy.POLLING
        ? {
            type: TriggerSourceScheduleType.CRON_EXPRESSION,
            cronExpression: '0 9 * * *',
            timezone: 'UTC',
        }
        : null
    const flow = createMockFlow({
        projectId: ctx.project.id,
        status: FlowStatus.ENABLED,
        folderId: null,
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
}
