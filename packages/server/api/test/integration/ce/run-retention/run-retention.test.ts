import { apId } from '@activepieces/core-utils'
import { ApplicationEventName, FlowRunStatus, PlatformRole, PrincipalType, RunEnvironment, RunRetentionPolicyScope } from '@activepieces/shared'
import dayjs from 'dayjs'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import * as applicationEventsModule from '../../../../src/app/helper/application-events'
import { runRetentionCleanupService } from '../../../../src/app/run-retention/run-retention-cleanup-service'
import { WaitpointStatus } from '../../../../src/app/waitpoints/waitpoint-types'
import { actionsEmitted } from '../../../helpers/application-events'
import { generateMockToken } from '../../../helpers/auth'
import { db } from '../../../helpers/db'
import { createMockFlow, createMockFlowRun, createMockFlowVersion, createMockProject, mockAndSaveBasicSetup, mockBasicUser } from '../../../helpers/mocks'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance
const originalApplicationEvents = applicationEventsModule.applicationEvents

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

const daysAgo = (days: number): string => dayjs().subtract(days, 'days').toISOString()

const saveFlowWithVersion = async (projectId: string) => {
    const flow = createMockFlow({ projectId })
    await db.save('flow', flow)
    const flowVersion = createMockFlowVersion({ flowId: flow.id })
    await db.save('flow_version', flowVersion)
    return { flow, flowVersion }
}

const saveRun = async (params: {
    projectId: string
    flowId: string
    flowVersionId: string
    status: FlowRunStatus
    finishTime: string | null
    archivedAt?: string | null
    parentRunId?: string
}) => {
    const run = createMockFlowRun({
        projectId: params.projectId,
        flowId: params.flowId,
        flowVersionId: params.flowVersionId,
        status: params.status,
        finishTime: params.finishTime,
        parentRunId: params.parentRunId,
        environment: RunEnvironment.PRODUCTION,
    })
    run.archivedAt = params.archivedAt ?? null
    await db.save('flow_run', run)
    return run
}

const survivingRunIds = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) {
        return []
    }
    const rows = await databaseConnection().query('SELECT id FROM flow_run WHERE id = ANY($1)', [ids]) as { id: string }[]
    return rows.map((row) => row.id).sort()
}

const savePolicy = async (params: {
    platformId: string
    projectId?: string | null
    retentionDays?: number
    statuses?: FlowRunStatus[]
    includeArchived?: boolean
}) => {
    await db.save('run_retention_policy', {
        id: apId(),
        platformId: params.platformId,
        projectId: params.projectId ?? null,
        retentionDays: params.retentionDays ?? 10,
        statuses: params.statuses ?? [FlowRunStatus.SUCCEEDED, FlowRunStatus.FAILED],
        includeArchived: params.includeArchived ?? true,
    })
}

describe('Run retention policy API', () => {
    let sendUserEventSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
        sendUserEventSpy = vi.fn()
        vi.spyOn(applicationEventsModule, 'applicationEvents').mockImplementation((log) => {
            const real = originalApplicationEvents(log)
            return {
                ...real,
                sendUserEvent: sendUserEventSpy,
            }
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    const defaultPolicyBody = {
        retentionDays: 30,
        statuses: [FlowRunStatus.SUCCEEDED, FlowRunStatus.FAILED],
        includeArchived: true,
    }

    it('platform admin can set, get and delete the default policy with audit events', async () => {
        const ctx = await createTestContext(app)

        const upsertResponse = await ctx.post('/v1/run-retention-policies/default', defaultPolicyBody)
        expect(upsertResponse?.statusCode).toBe(StatusCodes.OK)
        const upserted = upsertResponse?.json()
        expect(upserted.platformId).toBe(ctx.platform.id)
        expect(upserted.projectId).toBeNull()
        expect(upserted.retentionDays).toBe(30)

        const getResponse = await ctx.get('/v1/run-retention-policies/default')
        expect(getResponse?.statusCode).toBe(StatusCodes.OK)
        expect(getResponse?.json().id).toBe(upserted.id)

        const deleteResponse = await ctx.delete('/v1/run-retention-policies/default')
        expect(deleteResponse?.statusCode).toBe(StatusCodes.NO_CONTENT)

        const getAfterDelete = await ctx.get('/v1/run-retention-policies/default')
        expect(getAfterDelete?.statusCode).toBe(StatusCodes.NOT_FOUND)

        expect(actionsEmitted(sendUserEventSpy)).toEqual([
            ApplicationEventName.RUN_RETENTION_POLICY_UPDATED,
            ApplicationEventName.RUN_RETENTION_POLICY_DELETED,
        ])
    })

    it('rejects the default policy from a non-admin user', async () => {
        const ctx = await createTestContext(app)
        const { mockUser } = await mockBasicUser({
            user: {
                platformId: ctx.platform.id,
                platformRole: PlatformRole.MEMBER,
            },
        })
        const memberToken = await generateMockToken({
            id: mockUser.id,
            type: PrincipalType.USER,
            platform: { id: ctx.platform.id },
        })

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/run-retention-policies/default',
            body: defaultPolicyBody,
            headers: { authorization: `Bearer ${memberToken}` },
        })
        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('rejects non-terminal statuses in the policy', async () => {
        const ctx = await createTestContext(app)

        const response = await ctx.post('/v1/run-retention-policies/default', {
            ...defaultPolicyBody,
            statuses: [FlowRunStatus.RUNNING],
        })
        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('project override must be shorter than the platform default and wins as effective policy', async () => {
        const ctx = await createTestContext(app)
        await ctx.post('/v1/run-retention-policies/default', defaultPolicyBody)

        const tooLong = await ctx.post('/v1/run-retention-policies/override', {
            projectId: ctx.project.id,
            retentionDays: 30,
            statuses: [FlowRunStatus.SUCCEEDED],
            includeArchived: true,
        })
        expect(tooLong?.statusCode).toBe(StatusCodes.CONFLICT)

        const shorter = await ctx.post('/v1/run-retention-policies/override', {
            projectId: ctx.project.id,
            retentionDays: 7,
            statuses: [FlowRunStatus.SUCCEEDED],
            includeArchived: false,
        })
        expect(shorter?.statusCode).toBe(StatusCodes.OK)

        const effective = await ctx.get('/v1/run-retention-policies/effective', {
            projectId: ctx.project.id,
        })
        expect(effective?.statusCode).toBe(StatusCodes.OK)
        const effectiveBody = effective?.json()
        expect(effectiveBody.source).toBe(RunRetentionPolicyScope.PROJECT)
        expect(effectiveBody.retentionDays).toBe(7)

        const deleteOverride = await ctx.delete('/v1/run-retention-policies/override', {
            projectId: ctx.project.id,
        })
        expect(deleteOverride?.statusCode).toBe(StatusCodes.NO_CONTENT)

        const effectiveAfterDelete = await ctx.get('/v1/run-retention-policies/effective', {
            projectId: ctx.project.id,
        })
        const afterDeleteBody = effectiveAfterDelete?.json()
        expect(afterDeleteBody.source).toBe(RunRetentionPolicyScope.PLATFORM)
        expect(afterDeleteBody.retentionDays).toBe(30)

        expect(actionsEmitted(sendUserEventSpy)).toEqual([
            ApplicationEventName.RUN_RETENTION_POLICY_UPDATED,
            ApplicationEventName.RUN_RETENTION_POLICY_UPDATED,
            ApplicationEventName.RUN_RETENTION_POLICY_DELETED,
        ])
    })

    it('effective policy is null when nothing is configured', async () => {
        const ctx = await createTestContext(app)

        const response = await ctx.get('/v1/run-retention-policies/effective', {
            projectId: ctx.project.id,
        })
        expect(response?.statusCode).toBe(StatusCodes.OK)
        expect(response?.json()).toBeNull()
    })
})

describe('Run retention preview', () => {
    it('reports the estimated count and earliest finish time for the effective policy', async () => {
        const ctx = await createTestContext(app)
        await ctx.post('/v1/run-retention-policies/default', {
            retentionDays: 10,
            statuses: [FlowRunStatus.SUCCEEDED],
            includeArchived: false,
        })
        const { flow, flowVersion } = await saveFlowWithVersion(ctx.project.id)

        const oldest = await saveRun({ projectId: ctx.project.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(40) })
        await saveRun({ projectId: ctx.project.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(20) })
        await saveRun({ projectId: ctx.project.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(2) })
        await saveRun({ projectId: ctx.project.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.FAILED, finishTime: daysAgo(40) })
        await saveRun({ projectId: ctx.project.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(40), archivedAt: daysAgo(1) })

        const response = await ctx.post('/v1/run-retention-policies/preview', {
            projectId: ctx.project.id,
        })
        expect(response?.statusCode).toBe(StatusCodes.OK)
        const preview = response?.json()
        expect(preview.estimatedCount).toBe(2)
        expect(dayjs(preview.earliestFinishTime).toISOString()).toBe(dayjs(oldest.finishTime).toISOString())
    })

    it('previews an ad-hoc policy without saving it', async () => {
        const ctx = await createTestContext(app)
        const { flow, flowVersion } = await saveFlowWithVersion(ctx.project.id)
        await saveRun({ projectId: ctx.project.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.FAILED, finishTime: daysAgo(5) })

        const response = await ctx.post('/v1/run-retention-policies/preview', {
            projectId: ctx.project.id,
            policy: {
                retentionDays: 1,
                statuses: [FlowRunStatus.FAILED],
                includeArchived: true,
            },
        })
        expect(response?.statusCode).toBe(StatusCodes.OK)
        expect(response?.json().estimatedCount).toBe(1)

        const effective = await ctx.get('/v1/run-retention-policies/effective', {
            projectId: ctx.project.id,
        })
        expect(effective?.json()).toBeNull()
    })

    it('returns zero when no policy is configured', async () => {
        const ctx = await createTestContext(app)

        const response = await ctx.post('/v1/run-retention-policies/preview', {
            projectId: ctx.project.id,
        })
        expect(response?.statusCode).toBe(StatusCodes.OK)
        expect(response?.json()).toEqual({ estimatedCount: 0, earliestFinishTime: null })
    })
})

describe('Run retention cleanup', () => {
    beforeEach(async () => {
        await databaseConnection().query('TRUNCATE TABLE flow_run, run_retention_policy, waitpoint CASCADE')
    })

    it('deletes only expired terminal runs and keeps executing, recent and other-status runs', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup()
        await savePolicy({ platformId: mockPlatform.id })
        const { flow, flowVersion } = await saveFlowWithVersion(mockProject.id)

        const expiredSucceeded = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(30) })
        const expiredFailed = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.FAILED, finishTime: daysAgo(15) })
        const recentSucceeded = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(2) })
        const oldRunning = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.RUNNING, finishTime: null })
        const oldPaused = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.PAUSED, finishTime: null })
        const oldCanceled = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.CANCELED, finishTime: daysAgo(30) })
        const allIds = [expiredSucceeded, expiredFailed, recentSucceeded, oldRunning, oldPaused, oldCanceled].map((run) => run.id)

        const summary = await runRetentionCleanupService(app.log).cleanup()

        expect(summary.deletedCount).toBe(2)
        expect(await survivingRunIds(allIds)).toEqual([
            recentSucceeded.id,
            oldRunning.id,
            oldPaused.id,
            oldCanceled.id,
        ].sort())
    })

    it('keeps runs referenced as a parent and runs with waitpoints', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup()
        await savePolicy({ platformId: mockPlatform.id })
        const { flow, flowVersion } = await saveFlowWithVersion(mockProject.id)

        const parent = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(30) })
        const child = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(30), parentRunId: parent.id })
        const withWaitpoint = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(30) })
        await db.save('waitpoint', {
            id: apId(),
            flowRunId: withWaitpoint.id,
            projectId: mockProject.id,
            type: 'WEBHOOK',
            status: WaitpointStatus.PENDING,
            stepName: 'step_1',
            version: 'V1',
        })
        const plain = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(30) })

        const summary = await runRetentionCleanupService(app.log).cleanup()

        expect(summary.deletedCount).toBe(2)
        expect(await survivingRunIds([parent.id, child.id, withWaitpoint.id, plain.id])).toEqual([parent.id, withWaitpoint.id].sort())
    })

    it('respects the includeArchived flag', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup()
        await savePolicy({ platformId: mockPlatform.id, includeArchived: false })
        const { flow, flowVersion } = await saveFlowWithVersion(mockProject.id)

        const archived = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(30), archivedAt: daysAgo(5) })
        const notArchived = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(30) })

        const summary = await runRetentionCleanupService(app.log).cleanup()

        expect(summary.deletedCount).toBe(1)
        expect(await survivingRunIds([archived.id, notArchived.id])).toEqual([archived.id])
    })

    it('applies the shorter project override instead of the platform default', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup()
        await savePolicy({ platformId: mockPlatform.id, retentionDays: 60 })
        const otherProject = createMockProject({ ownerId: mockProject.ownerId, platformId: mockPlatform.id })
        await db.save('project', otherProject)
        await savePolicy({ platformId: mockPlatform.id, projectId: mockProject.id, retentionDays: 5, statuses: [FlowRunStatus.SUCCEEDED] })
        const { flow, flowVersion } = await saveFlowWithVersion(mockProject.id)
        const other = await saveFlowWithVersion(otherProject.id)

        const overrideProjectRun = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(10) })
        const defaultProjectRun = await saveRun({ projectId: otherProject.id, flowId: other.flow.id, flowVersionId: other.flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(10) })

        const summary = await runRetentionCleanupService(app.log).cleanup()

        expect(summary.deletedCount).toBe(1)
        expect(await survivingRunIds([overrideProjectRun.id, defaultProjectRun.id])).toEqual([defaultProjectRun.id])
    })

    it('does not delete anything when no policy exists and is idempotent on re-run', async () => {
        const { mockProject } = await mockAndSaveBasicSetup()
        const { flow, flowVersion } = await saveFlowWithVersion(mockProject.id)
        const run = await saveRun({ projectId: mockProject.id, flowId: flow.id, flowVersionId: flowVersion.id, status: FlowRunStatus.SUCCEEDED, finishTime: daysAgo(365) })

        const noPolicySummary = await runRetentionCleanupService(app.log).cleanup()
        expect(noPolicySummary.deletedCount).toBe(0)

        await savePolicy({ platformId: mockProject.platformId })
        const firstPass = await runRetentionCleanupService(app.log).cleanup()
        expect(firstPass.deletedCount).toBe(1)

        const secondPass = await runRetentionCleanupService(app.log).cleanup()
        expect(secondPass.deletedCount).toBe(0)
        expect(await survivingRunIds([run.id])).toEqual([])
    })
})
