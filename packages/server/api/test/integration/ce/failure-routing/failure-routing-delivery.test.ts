import { apId } from '@activepieces/core-utils'
import {
    ApplicationEventName,
    FailureDeliveryStatus,
    FailureRoutingTargetType,
    FlowRunStatus,
    RunEnvironment,
} from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { failureRoutingService } from '../../../../src/app/failure-routing/failure-routing.service'
import { db } from '../../../helpers/db'
import {
    createMockFlow,
    createMockFlowRun,
    createMockFlowVersion,
} from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

const createRule = async (ctx: TestContext, overrides: Record<string, unknown> = {}) => {
    const response = await ctx.post('/v1/failure-routing/rules', {
        projectId: ctx.project.id,
        displayName: 'On-call webhook',
        enabled: true,
        priority: 10,
        stopOnMatch: false,
        filter: {},
        target: {
            type: FailureRoutingTargetType.EVENT_DESTINATION,
            url: 'https://example.com/oncall',
        },
        ...overrides,
    })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json()
}

const failedRunFinishedEvent = (params: { projectId: string, platformId: string, flowId: string, flowVersionId: string, flowRunId: string }) => ({
    id: apId(),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    platformId: params.platformId,
    projectId: params.projectId,
    action: ApplicationEventName.FLOW_RUN_FINISHED,
    data: {
        flowRun: {
            id: params.flowRunId,
            startTime: new Date().toISOString(),
            finishTime: new Date().toISOString(),
            environment: RunEnvironment.PRODUCTION,
            flowId: params.flowId,
            flowVersionId: params.flowVersionId,
            status: FlowRunStatus.FAILED,
        },
    },
})

describe('Failure routing delivery lifecycle', () => {
    it('creates a PENDING delivery when a failed run matches, moves it to FAILED when the worker reports a transport failure, and exposes it through the query API', async () => {
        const ctx = await createTestContext(app)

        const rule = await createRule(ctx)
        expect(rule.priority).toBe(10)
        expect(rule.lastDelivery).toBeNull()

        const flow = createMockFlow({ projectId: ctx.project.id })
        await db.save('flow', flow)
        const flowVersion = createMockFlowVersion({ flowId: flow.id })
        await db.save('flow_version', flowVersion)
        const flowRun = createMockFlowRun({
            projectId: ctx.project.id,
            flowId: flow.id,
            flowVersionId: flowVersion.id,
            status: FlowRunStatus.FAILED,
            environment: RunEnvironment.PRODUCTION,
        })
        await db.save('flow_run', flowRun)

        const event = failedRunFinishedEvent({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            flowId: flow.id,
            flowVersionId: flowVersion.id,
            flowRunId: flowRun.id,
        })

        // This is what the FLOW_RUN_FINISHED worker event triggers.
        await failureRoutingService(app.log).handleRunFinished(event as never)

        const pendingDeliveries = await db.findBy<{
            id: string
            ruleId: string
            flowRunId: string
            status: FailureDeliveryStatus
            errorMessage: string | null
            attempts: number
        }>('failure_delivery', { flowRunId: flowRun.id, ruleId: rule.id })

        expect(pendingDeliveries).toHaveLength(1)
        const pending = pendingDeliveries[0]
        expect(pending.status).toBe(FailureDeliveryStatus.PENDING)
        expect(pending.errorMessage).toBeNull()
        expect(pending.attempts).toBe(0)

        // Simulate the worker RPC callback after a 500 from the destination.
        await failureRoutingService(app.log).reportDeliveryResult({
            deliveryId: pending.id,
            platformId: ctx.platform.id,
            success: false,
            httpStatus: 500,
            errorMessage: 'Request failed with status code 500',
        })

        const failed = await db.findOneByOrFail<{
            status: FailureDeliveryStatus
            errorMessage: string | null
            attempts: number
        }>('failure_delivery', { id: pending.id })
        expect(failed.status).toBe(FailureDeliveryStatus.FAILED)
        expect(failed.errorMessage).toContain('500')
        expect(failed.attempts).toBe(1)

        // The delivery must be queryable through the project API and carry the error.
        const listResponse = await ctx.get('/v1/failure-routing/rules/deliveries', {
            projectId: ctx.project.id,
            ruleId: rule.id,
        })
        expect(listResponse?.statusCode).toBe(StatusCodes.OK)
        const page = listResponse?.json()
        const listed = page.data.find((entry: { id: string }) => entry.id === pending.id)
        expect(listed).toBeDefined()
        expect(listed.status).toBe(FailureDeliveryStatus.FAILED)
        expect(listed.errorMessage).toContain('500')

        // The rule list surfaces the latest delivery snapshot.
        const rulesResponse = await ctx.get('/v1/failure-routing/rules', {
            projectId: ctx.project.id,
        })
        const refreshedRule = rulesResponse?.json().data.find((entry: { id: string }) => entry.id === rule.id)
        expect(refreshedRule.lastDelivery.status).toBe(FailureDeliveryStatus.FAILED)
        expect(refreshedRule.lastDelivery.errorMessage).toContain('500')
    })

    it('deduplicates a repeated report for the same run and rule (only one delivery row)', async () => {
        const ctx = await createTestContext(app)
        const rule = await createRule(ctx, { displayName: 'Dedup rule' })

        const flow = createMockFlow({ projectId: ctx.project.id })
        await db.save('flow', flow)
        const flowVersion = createMockFlowVersion({ flowId: flow.id })
        await db.save('flow_version', flowVersion)
        const flowRun = createMockFlowRun({
            projectId: ctx.project.id,
            flowId: flow.id,
            flowVersionId: flowVersion.id,
            status: FlowRunStatus.TIMEOUT,
            environment: RunEnvironment.PRODUCTION,
        })
        await db.save('flow_run', flowRun)

        const event = failedRunFinishedEvent({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            flowId: flow.id,
            flowVersionId: flowVersion.id,
            flowRunId: flowRun.id,
        })

        await failureRoutingService(app.log).handleRunFinished(event as never)
        await failureRoutingService(app.log).handleRunFinished(event as never)

        const deliveries = await db.findBy<{ id: string }>('failure_delivery', {
            flowRunId: flowRun.id,
            ruleId: rule.id,
        })
        expect(deliveries).toHaveLength(1)
    })

    it('records SUCCEEDED and clears the error when the worker reports a successful delivery', async () => {
        const ctx = await createTestContext(app)
        const rule = await createRule(ctx, { displayName: 'Success rule' })

        const flow = createMockFlow({ projectId: ctx.project.id })
        await db.save('flow', flow)
        const flowVersion = createMockFlowVersion({ flowId: flow.id })
        await db.save('flow_version', flowVersion)
        const flowRun = createMockFlowRun({
            projectId: ctx.project.id,
            flowId: flow.id,
            flowVersionId: flowVersion.id,
            status: FlowRunStatus.FAILED,
            environment: RunEnvironment.PRODUCTION,
        })
        await db.save('flow_run', flowRun)

        await failureRoutingService(app.log).handleRunFinished(failedRunFinishedEvent({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            flowId: flow.id,
            flowVersionId: flowVersion.id,
            flowRunId: flowRun.id,
        }) as never)

        const [delivery] = await db.findBy<{ id: string }>('failure_delivery', {
            flowRunId: flowRun.id,
            ruleId: rule.id,
        })

        await failureRoutingService(app.log).reportDeliveryResult({
            deliveryId: delivery.id,
            platformId: ctx.platform.id,
            success: true,
        })

        const updated = await db.findOneByOrFail<{
            status: FailureDeliveryStatus
            errorMessage: string | null
        }>('failure_delivery', { id: delivery.id })
        expect(updated.status).toBe(FailureDeliveryStatus.SUCCEEDED)
        expect(updated.errorMessage).toBeNull()
    })
})
