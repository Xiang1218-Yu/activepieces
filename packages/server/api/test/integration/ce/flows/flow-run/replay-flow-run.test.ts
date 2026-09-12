import { FileCompression, FileType, FlowRunStatus, FlowTriggerType, FlowVersionState, RunEnvironment, StepOutputStatus, StepOutputType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { fileService } from '../../../../../src/app/file/file.service'
import { db } from '../../../../helpers/db'
import { createMockFlow, createMockFlowRun, createMockFlowVersion } from '../../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../../helpers/test-setup'

let app: FastifyInstance
let ctx: TestContext

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    ctx = await createTestContext(app)
})

async function createRunWithTriggerOutput(params: {
    triggerOutput: unknown
    outputType?: StepOutputType
}) {
    const projectId = ctx.project.id
    const platformId = ctx.platform.id
    const flow = createMockFlow({ projectId })
    await db.save('flow', flow)

    const flowVersion = createMockFlowVersion({
        flowId: flow.id,
        state: FlowVersionState.LOCKED,
    })
    await db.save('flow_version', flowVersion)

    const logContent = {
        executionState: {
            steps: {
                [flowVersion.trigger.name]: {
                    type: FlowTriggerType.EMPTY,
                    status: StepOutputStatus.SUCCEEDED,
                    input: {},
                    output: params.triggerOutput,
                    ...(params.outputType ? { outputType: params.outputType } : {}),
                },
            },
            tags: [],
        },
    }
    const logData = Buffer.from(JSON.stringify(logContent), 'utf-8')
    const logFile = await fileService(app.log).save({
        projectId,
        platformId,
        type: FileType.FLOW_RUN_LOG,
        data: logData,
        size: logData.length,
        compression: FileCompression.NONE,
    })

    const flowRun = createMockFlowRun({
        projectId,
        flowId: flow.id,
        flowVersionId: flowVersion.id,
        status: FlowRunStatus.SUCCEEDED,
        environment: RunEnvironment.PRODUCTION,
        logsFileId: logFile.id,
    })
    await db.save('flow_run', flowRun)

    return { flow, flowVersion, flowRun }
}

describe('Replay flow run', () => {
    it('prepares replay with the pinned version, step range and no blockers for a healthy run', async () => {
        const { flowRun } = await createRunWithTriggerOutput({
            triggerOutput: { hello: 'world' },
        })

        const response = await ctx.post(`/v1/flow-runs/${flowRun.id}/replay/prepare`, {})

        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body.sourceRunId).toBe(flowRun.id)
        expect(body.flowVersionId).toBe(flowRun.flowVersionId)
        expect(body.canReplay).toBe(true)
        expect(body.blockers).toEqual([])
        expect(body.steps.length).toBeGreaterThan(0)
        expect(body.steps[0].isTrigger).toBe(true)
    })

    it('blocks replay when the trigger input is missing', async () => {
        const { flowRun } = await createRunWithTriggerOutput({
            triggerOutput: undefined,
        })

        const response = await ctx.post(`/v1/flow-runs/${flowRun.id}/replay/prepare`, {})

        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body.canReplay).toBe(false)
        expect(body.blockers[0].code).toBe('TRIGGER_PAYLOAD_MISSING')
    })

    it('blocks replay when a file referenced by the trigger input has expired', async () => {
        const { flowRun } = await createRunWithTriggerOutput({
            triggerOutput: {
                fileUrl: 'http://localhost/api/v1/files/expired00000000000001?token=abc',
            },
        })

        const response = await ctx.post(`/v1/flow-runs/${flowRun.id}/replay/prepare`, {})

        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body.canReplay).toBe(false)
        expect(body.blockers[0].code).toBe('TRIGGER_INPUT_FILE_EXPIRED')
        expect(body.blockers[0].fileId).toBe('expired00000000000001')

        const replayResponse = await ctx.post(`/v1/flow-runs/${flowRun.id}/replay`, {
            projectId: ctx.project.id,
        })
        expect(replayResponse.statusCode).toBe(400)
    })

    it('creates an independent TESTING run linked to the source run', async () => {
        const { flowRun } = await createRunWithTriggerOutput({
            triggerOutput: { hello: 'world' },
        })

        const response = await ctx.post(`/v1/flow-runs/${flowRun.id}/replay`, {
            projectId: ctx.project.id,
        })

        expect(response.statusCode).toBe(200)
        const replay = response.json()
        expect(replay.id).not.toBe(flowRun.id)
        expect(replay.environment).toBe(RunEnvironment.TESTING)
        expect(replay.replayOfRunId).toBe(flowRun.id)
        expect(replay.flowVersionId).toBe(flowRun.flowVersionId)

        const sourceRunUnchanged = await db.findOneByOrFail<{ status: string }>('flow_run', { id: flowRun.id })
        expect(sourceRunUnchanged.status).toBe(FlowRunStatus.SUCCEEDED)

        const replays = await ctx.get(`/v1/flow-runs/${flowRun.id}/replays`)
        expect(replays.statusCode).toBe(200)
        expect(replays.json().map((r: { id: string }) => r.id)).toContain(replay.id)
    })

    it('materializes a sliced trigger output before replay', async () => {
        const projectId = ctx.project.id
        const platformId = ctx.platform.id
        const realOutput = { items: Array.from({ length: 100 }, (_, i) => ({ id: i })) }
        const sliceData = Buffer.from(JSON.stringify(realOutput), 'utf-8')
        const sliceFile = await fileService(app.log).save({
            projectId,
            platformId,
            type: FileType.FLOW_RUN_LOG_SLICE,
            data: sliceData,
            size: sliceData.length,
            compression: FileCompression.NONE,
        })

        const { flowRun } = await createRunWithTriggerOutput({
            triggerOutput: { fileId: sliceFile.id, size: sliceData.length, url: `http://localhost/api/v1/files/${sliceFile.id}` },
            outputType: StepOutputType.SLICE,
        })

        const prepareResponse = await ctx.post(`/v1/flow-runs/${flowRun.id}/replay/prepare`, {})
        expect(prepareResponse.json().canReplay).toBe(true)

        const response = await ctx.post(`/v1/flow-runs/${flowRun.id}/replay`, {
            projectId,
        })
        expect(response.statusCode).toBe(200)
        expect(response.json().replayOfRunId).toBe(flowRun.id)
    })
})
