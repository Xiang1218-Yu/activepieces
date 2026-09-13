import { apId } from '@activepieces/core-utils'
import {
    FileCompression,
    FileType,
    FlowRunStatus,
    FlowTestScenarioConnectionStrategy,
    FlowTestScenarioRunStatus,
    FlowTriggerType,
    FlowVersionState,
    logSerializer,
    RunEnvironment,
} from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { fileService } from '../../../../../src/app/file/file.service'
import { db } from '../../../../helpers/db'
import {
    createMockFlow,
    createMockFlowRun,
    createMockFlowVersion,
} from '../../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function setupFlowWithVersion(ctx: TestContext, versionOverrides: Record<string, unknown> = {}) {
    const mockFlow = createMockFlow({ projectId: ctx.project.id })
    await db.save('flow', mockFlow)
    const mockFlowVersion = createMockFlowVersion({
        flowId: mockFlow.id,
        state: FlowVersionState.DRAFT,
        ...versionOverrides,
    })
    await db.save('flow_version', mockFlowVersion)
    return { mockFlow, mockFlowVersion }
}

async function createScenario(ctx: TestContext, flowId: string, flowVersionId: string, overrides: Record<string, unknown> = {}) {
    const response = await ctx.post('/v1/flow-test-scenarios', {
        projectId: ctx.project.id,
        flowId,
        flowVersionId,
        name: 'scenario',
        triggerInput: { orderId: 42 },
        expectedOutputs: { trigger: { orderId: 42 } },
        ...overrides,
    }, { query: { projectId: ctx.project.id } })
    return response
}

describe('Flow Test Scenario API', () => {
    describe('Create endpoint', () => {
        it('creates a scenario bound to the exact flow version with a structure snapshot', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)

            const response = await createScenario(ctx, mockFlow.id, mockFlowVersion.id, {
                description: 'my first scenario',
                allowedDynamicFields: ['trigger.orderId'],
            })

            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            const body = response?.json()

            expect(body.id).toHaveLength(21)
            expect(body.projectId).toBe(ctx.project.id)
            expect(body.flowId).toBe(mockFlow.id)
            expect(body.flowVersionId).toBe(mockFlowVersion.id)
            expect(body.name).toBe('scenario')
            expect(body.description).toBe('my first scenario')
            expect(body.triggerInput).toEqual({ orderId: 42 })
            expect(body.expectedOutputs).toEqual({ trigger: { orderId: 42 } })
            expect(body.allowedDynamicFields).toEqual(['trigger.orderId'])
            // Safest default: connections (and their external side effects) are blocked
            expect(body.connectionStrategy).toBe(FlowTestScenarioConnectionStrategy.BLOCK)
            expect(body.connectionMocks).toEqual({})
            expect(body.versionSnapshot).toEqual({
                displayName: mockFlowVersion.displayName,
                schemaVersion: mockFlowVersion.schemaVersion,
                state: FlowVersionState.DRAFT,
                valid: mockFlowVersion.valid,
            })
            expect(body.executable).toBe(true)
            expect(body.missingInputFileIds).toEqual([])
        })

        it('rejects binding to a flow version of another flow', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow } = await setupFlowWithVersion(ctx)
            const { mockFlowVersion: otherVersion } = await setupFlowWithVersion(ctx)

            const response = await createScenario(ctx, mockFlow.id, otherVersion.id)

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })

        it('rejects binding to a non-existent flow version', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow } = await setupFlowWithVersion(ctx)

            const response = await createScenario(ctx, mockFlow.id, 'HtKsJHgUjZXhVbNvBnHgF')

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })

    describe('List and get endpoints', () => {
        it('lists scenarios of a flow with executability', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)
            await createScenario(ctx, mockFlow.id, mockFlowVersion.id)

            const response = await ctx.get('/v1/flow-test-scenarios', {
                projectId: ctx.project.id,
                flowId: mockFlow.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.data).toHaveLength(1)
            expect(body.data[0].flowVersionId).toBe(mockFlowVersion.id)
            expect(body.data[0].executable).toBe(true)
        })

        it('marks scenarios with missing input files as not executable instead of failing', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id, {
                inputFileIds: ['missingInputFileId001'],
            })
            expect(createResponse?.statusCode).toBe(StatusCodes.CREATED)
            const scenarioId = createResponse?.json().id

            const response = await ctx.get(`/v1/flow-test-scenarios/${scenarioId}`, undefined, {
                query: { projectId: ctx.project.id },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.executable).toBe(false)
            expect(body.missingInputFileIds).toEqual(['missingInputFileId001'])
        })
    })

    describe('Update endpoint', () => {
        it('updates fields and re-snapshots only on explicit rebind', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id)
            const scenarioId = createResponse?.json().id

            // A new draft version appears (e.g. the flow was published and edited)
            const newerVersion = createMockFlowVersion({
                flowId: mockFlow.id,
                state: FlowVersionState.DRAFT,
                displayName: 'renamed flow',
            })
            await db.save('flow_version', newerVersion)

            // Unrelated update keeps the pinned version
            const renameResponse = await ctx.post(`/v1/flow-test-scenarios/${scenarioId}`, {
                name: 'renamed scenario',
            }, { query: { projectId: ctx.project.id } })
            expect(renameResponse?.statusCode).toBe(StatusCodes.OK)
            expect(renameResponse?.json().name).toBe('renamed scenario')
            expect(renameResponse?.json().flowVersionId).toBe(mockFlowVersion.id)

            // Explicit rebind moves the pin and re-snapshots the structure
            const rebindResponse = await ctx.post(`/v1/flow-test-scenarios/${scenarioId}`, {
                flowVersionId: newerVersion.id,
            }, { query: { projectId: ctx.project.id } })
            expect(rebindResponse?.statusCode).toBe(StatusCodes.OK)
            expect(rebindResponse?.json().flowVersionId).toBe(newerVersion.id)
            expect(rebindResponse?.json().versionSnapshot.displayName).toBe('renamed flow')
        })

        it('rejects rebinding to a version of another flow', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)
            const { mockFlowVersion: otherVersion } = await setupFlowWithVersion(ctx)
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id)
            const scenarioId = createResponse?.json().id

            const response = await ctx.post(`/v1/flow-test-scenarios/${scenarioId}`, {
                flowVersionId: otherVersion.id,
            }, { query: { projectId: ctx.project.id } })

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })

    describe('Version pinning', () => {
        it('keeps reproducing the original structure after the flow is published and edited', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx, {
                state: FlowVersionState.LOCKED,
            })
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id)
            const scenarioId = createResponse?.json().id

            // Simulate publish + edit: the locked version stays, a new draft is forked
            const newDraft = createMockFlowVersion({
                flowId: mockFlow.id,
                state: FlowVersionState.DRAFT,
                displayName: 'edited after publish',
            })
            await db.save('flow_version', newDraft)

            const response = await ctx.get(`/v1/flow-test-scenarios/${scenarioId}`, undefined, {
                query: { projectId: ctx.project.id },
            })
            const body = response?.json()
            expect(body.flowVersionId).toBe(mockFlowVersion.id)
            expect(body.versionSnapshot).toEqual({
                displayName: mockFlowVersion.displayName,
                schemaVersion: mockFlowVersion.schemaVersion,
                state: FlowVersionState.LOCKED,
                valid: mockFlowVersion.valid,
            })
        })
    })

    describe('Execute endpoint', () => {
        it('marks the run as not executable when input files are missing', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id, {
                inputFileIds: ['missingInputFileId002'],
            })
            const scenarioId = createResponse?.json().id

            const response = await ctx.post(`/v1/flow-test-scenarios/${scenarioId}/execute`, undefined, {
                query: { projectId: ctx.project.id },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const run = response?.json()
            expect(run.status).toBe(FlowTestScenarioRunStatus.NOT_EXECUTABLE)
            expect(run.flowRunId).toBeNull()
            expect(run.failureReason).toContain('missingInputFileId002')

            const runsResponse = await ctx.get(`/v1/flow-test-scenarios/${scenarioId}/runs`, undefined, {
                query: { projectId: ctx.project.id },
            })
            expect(runsResponse?.json().data).toHaveLength(1)
            expect(runsResponse?.json().data[0].status).toBe(FlowTestScenarioRunStatus.NOT_EXECUTABLE)
        })

        it('blocks execution explicitly when the pinned version uses connections and the strategy is BLOCK', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx, {
                connectionIds: ['someConnectionId00001'],
            })
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id)
            const scenarioId = createResponse?.json().id

            const response = await ctx.post(`/v1/flow-test-scenarios/${scenarioId}/execute`, undefined, {
                query: { projectId: ctx.project.id },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const run = response?.json()
            expect(run.status).toBe(FlowTestScenarioRunStatus.BLOCKED)
            expect(run.flowRunId).toBeNull()
            expect(run.failureReason).toContain('BLOCK')
        })

        it('starts an isolated test run pinned to the scenario version when mocks are provided', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx, {
                connectionIds: ['someConnectionId00002'],
            })
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id, {
                connectionStrategy: FlowTestScenarioConnectionStrategy.MOCK,
                connectionMocks: {
                    'some-connection': { type: 'SECRET_TEXT', secret_text: 'mocked' },
                },
            })
            const scenarioId = createResponse?.json().id

            const response = await ctx.post(`/v1/flow-test-scenarios/${scenarioId}/execute`, undefined, {
                query: { projectId: ctx.project.id },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const run = response?.json()
            expect(run.status).toBe(FlowTestScenarioRunStatus.PENDING)
            expect(run.flowRunId).toHaveLength(21)
            expect(run.flowVersionId).toBe(mockFlowVersion.id)

            const flowRun = await db.findOneByOrFail<Record<string, unknown>>('flow_run', { id: run.flowRunId })
            expect(flowRun.environment).toBe(RunEnvironment.TESTING)
            expect(flowRun.flowVersionId).toBe(mockFlowVersion.id)
        })
    })

    describe('Diff report', () => {
        async function saveFinishedRunLogs(ctx: TestContext, steps: Record<string, unknown>) {
            const logsFileId = apId()
            const outputFile = {
                executionState: {
                    steps,
                    tags: [],
                },
            }
            const data = await logSerializer.serialize(outputFile)
            await fileService(app!.log).save({
                fileId: logsFileId,
                projectId: ctx.project.id,
                platformId: ctx.platform.id,
                type: FileType.FLOW_RUN_LOG,
                data,
                size: data.length,
                compression: FileCompression.NONE,
            })
            return logsFileId
        }

        it('generates a passing diff report once the isolated run finishes', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id, {
                expectedOutputs: { trigger: { orderId: 42, total: 100, createdAt: '1970-01-01T00:00:00Z' } },
                allowedDynamicFields: ['trigger.createdAt'],
            })
            const scenarioId = createResponse?.json().id

            const logsFileId = await saveFinishedRunLogs(ctx, {
                trigger: {
                    type: FlowTriggerType.EMPTY,
                    status: 'SUCCEEDED',
                    input: {},
                    output: { orderId: 42, total: 100, createdAt: '2026-09-12T10:00:00Z' },
                },
            })
            const mockFlowRun = createMockFlowRun({
                projectId: ctx.project.id,
                flowId: mockFlow.id,
                flowVersionId: mockFlowVersion.id,
                environment: RunEnvironment.TESTING,
                status: FlowRunStatus.SUCCEEDED,
                logsFileId,
            })
            await db.save('flow_run', mockFlowRun)
            const scenarioRunId = apId()
            await db.save('flow_test_scenario_run', {
                id: scenarioRunId,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                projectId: ctx.project.id,
                scenarioId,
                flowId: mockFlow.id,
                flowVersionId: mockFlowVersion.id,
                flowRunId: mockFlowRun.id,
                status: FlowTestScenarioRunStatus.PENDING,
                failureReason: null,
                diffReport: null,
                triggeredBy: null,
            })

            const response = await ctx.get(`/v1/flow-test-scenarios/${scenarioId}/runs/${scenarioRunId}`, undefined, {
                query: { projectId: ctx.project.id },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const run = response?.json()
            expect(run.status).toBe(FlowTestScenarioRunStatus.PASSED)
            expect(run.diffReport.summary).toEqual({
                matched: 2,
                mismatched: 0,
                missing: 0,
                dynamicSkipped: 1,
            })
            expect(run.diffReport.steps[0].stepName).toBe('trigger')
            expect(run.diffReport.steps[0].status).toBe('MATCH')
        })

        it('generates a failing diff report when outputs diverge', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id, {
                expectedOutputs: { trigger: { orderId: 42 } },
            })
            const scenarioId = createResponse?.json().id

            const logsFileId = await saveFinishedRunLogs(ctx, {
                trigger: {
                    type: FlowTriggerType.EMPTY,
                    status: 'SUCCEEDED',
                    input: {},
                    output: { orderId: 43 },
                },
            })
            const mockFlowRun = createMockFlowRun({
                projectId: ctx.project.id,
                flowId: mockFlow.id,
                flowVersionId: mockFlowVersion.id,
                environment: RunEnvironment.TESTING,
                status: FlowRunStatus.SUCCEEDED,
                logsFileId,
            })
            await db.save('flow_run', mockFlowRun)
            const scenarioRunId = apId()
            await db.save('flow_test_scenario_run', {
                id: scenarioRunId,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                projectId: ctx.project.id,
                scenarioId,
                flowId: mockFlow.id,
                flowVersionId: mockFlowVersion.id,
                flowRunId: mockFlowRun.id,
                status: FlowTestScenarioRunStatus.PENDING,
                failureReason: null,
                diffReport: null,
                triggeredBy: null,
            })

            const response = await ctx.get(`/v1/flow-test-scenarios/${scenarioId}/runs/${scenarioRunId}`, undefined, {
                query: { projectId: ctx.project.id },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const run = response?.json()
            expect(run.status).toBe(FlowTestScenarioRunStatus.FAILED)
            expect(run.diffReport.summary.mismatched).toBe(1)
            expect(run.diffReport.steps[0].fields).toEqual([
                { path: 'trigger.orderId', status: 'MISMATCH', expected: 42, actual: 43 },
            ])
        })
    })

    describe('Delete endpoint', () => {
        it('deletes the scenario and its runs', async () => {
            const ctx = await createTestContext(app!)
            const { mockFlow, mockFlowVersion } = await setupFlowWithVersion(ctx)
            const createResponse = await createScenario(ctx, mockFlow.id, mockFlowVersion.id)
            const scenarioId = createResponse?.json().id

            const deleteResponse = await ctx.delete(`/v1/flow-test-scenarios/${scenarioId}`, undefined, {
                query: { projectId: ctx.project.id },
            })
            expect(deleteResponse?.statusCode).toBe(StatusCodes.NO_CONTENT)

            const getResponse = await ctx.get(`/v1/flow-test-scenarios/${scenarioId}`, undefined, {
                query: { projectId: ctx.project.id },
            })
            expect(getResponse?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })
})
