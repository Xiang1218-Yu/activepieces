import {
    apId,
    ApprovalSlaBreachReason,
    DefaultProjectRole,
    Flow,
    FlowApprovalPriority,
    FlowApprovalRequest,
    FlowApprovalRequestState,
    FlowStatus,
    FlowVersion,
    FlowVersionState,
} from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { approvalSlaPolicyService } from '../../../../src/app/ee/flows/flow-approval/approval-sla-policy.service'
import { approvalSlaSweepService } from '../../../../src/app/ee/flows/flow-approval/approval-sla-sweep.service'
import { flowApprovalRequestService } from '../../../../src/app/ee/flows/flow-approval/flow-approval-request.service'
import { db } from '../../../helpers/db'
import {
    createMockFlow,
    createMockFlowVersion,
} from '../../../helpers/mocks'
import {
    createMemberContext,
    createTestContext,
    TestContext,
} from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function setupSensitiveCtx(): Promise<TestContext> {
    const ctx = await createTestContext(app!, {
        plan: { environmentsEnabled: true },
    })
    await db.update('project', ctx.project.id, { sensitive: true })
    return ctx
}

async function seedPendingApprovalWithDeadline(
    ctx: TestContext,
    submitterId: string,
    deadlineIso: string,
    priority: FlowApprovalPriority = FlowApprovalPriority.HIGH,
    overrides: Partial<FlowApprovalRequest> = {},
): Promise<{ flow: Flow, version: FlowVersion, approval: FlowApprovalRequest }> {
    const flow = createMockFlow({
        projectId: ctx.project.id,
        status: FlowStatus.DISABLED,
    })
    await db.save('flow', flow)
    const version = createMockFlowVersion({
        flowId: flow.id,
        state: FlowVersionState.LOCKED,
        valid: true,
    })
    await db.save('flow_version', version)
    const now = new Date().toISOString()
    const approval: FlowApprovalRequest = {
        id: apId(),
        created: now,
        updated: now,
        flowId: flow.id,
        flowVersionId: version.id,
        projectId: ctx.project.id,
        platformId: ctx.platform.id,
        submitterId,
        submittedAt: now,
        approverId: null,
        decidedAt: null,
        state: FlowApprovalRequestState.PENDING,
        requestedStatus: FlowStatus.DISABLED,
        rejectionReason: null,
        priority,
        slaDeadlineAt: deadlineIso,
        pausedAt: null,
        escalatedAt: null,
        slaBreachReason: null,
        ...overrides,
    }
    await db.save('flow_approval_request', approval)
    return { flow, version, approval }
}

describe('approval SLA — policy', () => {
    it('persists a per-project policy and validates the time zone', async () => {
        const ctx = await setupSensitiveCtx()
        const saved = await approvalSlaPolicyService(app!.log).upsert({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            request: {
                timezone: 'Europe/Berlin',
                rules: {
                    [FlowApprovalPriority.HIGH]: {
                        timeoutMinutes: 120,
                        escalationTargetUserIds: [],
                    },
                },
            },
        })
        expect(saved.timezone).toBe('Europe/Berlin')
        expect(saved.rules[FlowApprovalPriority.HIGH]?.timeoutMinutes).toBe(120)

        const fetched = await approvalSlaPolicyService(app!.log).getForProject({ projectId: ctx.project.id })
        expect(fetched?.id).toBe(saved.id)

        await expect(approvalSlaPolicyService(app!.log).upsert({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            request: {
                timezone: 'Mars/Olympus',
                rules: {
                    [FlowApprovalPriority.HIGH]: { timeoutMinutes: 120, escalationTargetUserIds: [] },
                },
            },
        })).rejects.toThrow(/Unsupported time zone/)
    })

    it('GET policy returns null when none is configured', async () => {
        const ctx = await setupSensitiveCtx()
        const response = await ctx.get('/v1/approval-sla-policies', {
            projectId: ctx.project.id,
        })
        expect(response?.statusCode).toBe(StatusCodes.OK)
        expect(response?.body).toBeNull()
    })
})

describe('approval SLA — deadline and visibility', () => {
    it('computes the deadline from the priority rule on submit and returns it in the populated response', async () => {
        const ctx = await setupSensitiveCtx()
        await approvalSlaPolicyService(app!.log).upsert({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            request: {
                timezone: 'Etc/UTC',
                rules: {
                    [FlowApprovalPriority.HIGH]: { timeoutMinutes: 30, escalationTargetUserIds: [] },
                },
            },
        })
        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.DISABLED })
        await db.save('flow', flow)

        const submitted = await flowApprovalRequestService(app!.log).submitForApproval({
            flow,
            userId: ctx.user.id,
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            requestedStatus: FlowStatus.ENABLED,
            priority: FlowApprovalPriority.HIGH,
        })
        expect(submitted.slaDeadlineAt).not.toBeNull()
        const elapsed = new Date(submitted.slaDeadlineAt as string).getTime() - new Date(submitted.submittedAt).getTime()
        expect(elapsed).toBe(30 * 60_000)

        const populated = await flowApprovalRequestService(app!.log).getPopulatedOrThrow({
            requestId: submitted.id,
            projectId: ctx.project.id,
        })
        expect(populated.sla?.configured).toBe(true)
        expect(populated.sla?.overdue).toBe(false)
    })

    it('hides approvals from a member without the approval permission unless they submitted it', async () => {
        const ctx = await setupSensitiveCtx()
        const memberCtx = await createMemberContext(app!, ctx, {
            projectRole: DefaultProjectRole.EDITOR,
        })
        await approvalSlaPolicyService(app!.log).upsert({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            request: {
                timezone: 'Etc/UTC',
                rules: {
                    [FlowApprovalPriority.NORMAL]: { timeoutMinutes: 60, escalationTargetUserIds: [] },
                },
            },
        })
        const { approval } = await seedPendingApprovalWithDeadline(
            ctx,
            ctx.user.id,
            new Date(Date.now() + 60 * 60_000).toISOString(),
        )

        const ownApproval = await seedPendingApprovalWithDeadline(
            ctx,
            memberCtx.user.id,
            new Date(Date.now() + 60 * 60_000).toISOString(),
        )

        const editorPage = await flowApprovalRequestService(app!.log).list({
            projectId: ctx.project.id,
            viewerId: memberCtx.user.id,
        })
        const visibleIds = editorPage.data.map((row) => row.id)
        expect(visibleIds).toContain(ownApproval.approval.id)
        expect(visibleIds).not.toContain(approval.id)

        const approverPage = await flowApprovalRequestService(app!.log).list({
            projectId: ctx.project.id,
            viewerId: ctx.user.id,
        })
        expect(approverPage.data.map((row) => row.id)).toContain(approval.id)
    })
})

describe('approval SLA — pause stops the countdown', () => {
    it('freezes the deadline while paused and shifts it by the paused duration on resume', async () => {
        const ctx = await setupSensitiveCtx()
        await approvalSlaPolicyService(app!.log).upsert({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            request: {
                timezone: 'Etc/UTC',
                rules: {
                    [FlowApprovalPriority.HIGH]: { timeoutMinutes: 60, escalationTargetUserIds: [] },
                },
            },
        })
        const memberCtx = await createMemberContext(app!, ctx, {
            projectRole: DefaultProjectRole.EDITOR,
        })
        const initialDeadline = new Date(Date.now() + 30 * 60_000).toISOString()
        const { approval } = await seedPendingApprovalWithDeadline(
            ctx,
            memberCtx.user.id,
            initialDeadline,
        )

        const paused = await flowApprovalRequestService(app!.log).pause({
            requestId: approval.id,
            projectId: ctx.project.id,
        })
        expect(paused.sla?.paused).toBe(true)
        const pausedAt = (await db.findOneByOrFail<FlowApprovalRequest>('flow_approval_request', { id: approval.id })).pausedAt
        expect(pausedAt).not.toBeNull()

        await new Promise((resolve) => setTimeout(resolve, 1100))

        const resumed = await flowApprovalRequestService(app!.log).resume({
            requestId: approval.id,
            projectId: ctx.project.id,
        })
        expect(resumed.sla?.paused).toBe(false)
        const reloaded = await db.findOneByOrFail<FlowApprovalRequest>('flow_approval_request', { id: approval.id })
        expect(reloaded.pausedAt).toBeNull()
        const shift = new Date(reloaded.slaDeadlineAt as string).getTime() - new Date(initialDeadline).getTime()
        expect(shift).toBeGreaterThanOrEqual(1000)
        expect(shift).toBeLessThan(5000)
    })
})

describe('approval SLA — sweep', () => {
    it('marks a past-due approval breached but skips paused rows', async () => {
        const ctx = await setupSensitiveCtx()
        await approvalSlaPolicyService(app!.log).upsert({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            request: {
                timezone: 'Etc/UTC',
                rules: {
                    [FlowApprovalPriority.HIGH]: { timeoutMinutes: 60, escalationTargetUserIds: [] },
                },
            },
        })
        const pastDue = await seedPendingApprovalWithDeadline(
            ctx,
            ctx.user.id,
            new Date(Date.now() - 60_000).toISOString(),
        )
        const paused = await seedPendingApprovalWithDeadline(
            ctx,
            ctx.user.id,
            new Date(Date.now() - 60_000).toISOString(),
            FlowApprovalPriority.HIGH,
            { pausedAt: new Date().toISOString() },
        )

        const result = await approvalSlaSweepService(app!.log).run()
        expect(result.breached).toBeGreaterThanOrEqual(1)

        const breachedRow = await db.findOneByOrFail<FlowApprovalRequest>('flow_approval_request', { id: pastDue.approval.id })
        expect(breachedRow.slaBreachReason).toBe(ApprovalSlaBreachReason.PENDING_LIMIT)

        const pausedRow = await db.findOneByOrFail<FlowApprovalRequest>('flow_approval_request', { id: paused.approval.id })
        expect(pausedRow.slaBreachReason).toBeNull()
    })

    it('escalates at most once: repeated sweeps do not overwrite escalatedAt', async () => {
        const ctx = await setupSensitiveCtx()
        await approvalSlaPolicyService(app!.log).upsert({
            projectId: ctx.project.id,
            platformId: ctx.platform.id,
            request: {
                timezone: 'Etc/UTC',
                rules: {
                    [FlowApprovalPriority.URGENT]: {
                        timeoutMinutes: 60,
                        escalationMinutes: 90,
                        escalationTargetUserIds: [ctx.user.id],
                    },
                },
            },
        })

        const submittedAt = new Date(Date.now() - 120 * 60_000).toISOString()
        const pastDue = await seedPendingApprovalWithDeadline(
            ctx,
            ctx.user.id,
            new Date(Date.now() - 30 * 60_000).toISOString(),
            FlowApprovalPriority.URGENT,
            { submittedAt },
        )

        await approvalSlaSweepService(app!.log).run()
        const first = await db.findOneByOrFail<FlowApprovalRequest>('flow_approval_request', { id: pastDue.approval.id })
        expect(first.escalatedAt).not.toBeNull()
        const firstEscalatedAt = first.escalatedAt

        await approvalSlaSweepService(app!.log).run()
        const second = await db.findOneByOrFail<FlowApprovalRequest>('flow_approval_request', { id: pastDue.approval.id })
        expect(second.escalatedAt).toBe(firstEscalatedAt)
    })
})

