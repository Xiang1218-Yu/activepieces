import { FileType, Flow, FlowStatus, FlowVersionState, WebhookRequestBodyKind } from '@activepieces/shared'
import FormData from 'form-data'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { createMockFlow, createMockFlowVersion } from '../../../helpers/mocks'
import { db } from '../../../helpers/db'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

const captureRepo = () => databaseConnection().getRepository('webhook_request_capture')
const flowRunRepo = () => databaseConnection().getRepository('flow_run')

describe('Webhook request inspector', () => {
    it('persists a redacted capture and serves it project-scoped', async () => {
        const ctx = await createTestContext(app)
        const { mockFlow } = await createEnabledFlow(ctx)

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/webhooks/${mockFlow.id}?event=login&event=signup`,
            headers: {
                'content-type': 'application/json',
                authorization: 'Bearer top-secret-token',
                'x-github-event': 'push',
                'x-hub-signature-256': 'sha256=deadbeef',
                'x-forwarded-for': '203.0.113.9',
            },
            payload: { hello: 'world', nested: { value: 42 } },
        })
        expect(response.statusCode).toBe(StatusCodes.OK)

        const captures = await captureRepo().findBy({ flowId: mockFlow.id })
        expect(captures).toHaveLength(1)
        const capture = captures[0]

        // Sensitive values never reach the database.
        expect(JSON.stringify(capture.headers)).not.toContain('top-secret-token')
        expect(JSON.stringify(capture.headers)).not.toContain('deadbeef')
        expect(JSON.stringify(capture.headers)).not.toContain('203.0.113.9')
        expect(capture.headers['x-github-event']).toEqual(['push'])

        // But the masked header names + reasons are retained for debugging.
        const maskedNames = capture.maskedHeaders.map((header: { name: string }) => header.name)
        expect(maskedNames).toEqual(expect.arrayContaining(['authorization', 'x-hub-signature-256', 'x-forwarded-for']))
        const byName = Object.fromEntries(capture.maskedHeaders.map((header: { name: string, reason: string }) => [header.name, header.reason]))
        expect(byName.authorization).toBe('SENSITIVE')
        expect(byName['x-forwarded-for']).toBe('CONNECTION')

        // Repeated query keys are preserved as an array.
        expect(capture.queryParams.event).toEqual(['login', 'signup'])

        // Body is stored as a parsed, typed preview.
        expect(capture.body.kind).toBe(WebhookRequestBodyKind.JSON)
        expect(capture.body.preview).toMatchObject({ hello: 'world' })
        expect(capture.responseStatus).toBe(StatusCodes.OK)

        // Authenticated project member can list and fetch.
        const listResponse = await app.inject({
            method: 'GET',
            url: `/api/v1/webhook-requests?projectId=${ctx.project.id}&flowId=${mockFlow.id}`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })
        expect(listResponse.statusCode).toBe(StatusCodes.OK)
        expect(listResponse.json().data).toHaveLength(1)

        const detailResponse = await app.inject({
            method: 'GET',
            url: `/api/v1/webhook-requests/${capture.id}?projectId=${ctx.project.id}`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })
        expect(detailResponse.statusCode).toBe(StatusCodes.OK)
        expect(detailResponse.json().id).toBe(capture.id)
    })

    it('counts both multipart files and form fields in the total body size', async () => {
        const ctx = await createTestContext(app)
        const { mockFlow } = await createEnabledFlow(ctx)

        const form = new FormData()
        form.append('title', 'a'.repeat(100))
        form.append('upload', Buffer.from('B'.repeat(300)), {
            filename: 'doc.bin',
            contentType: 'application/octet-stream',
        })

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/webhooks/${mockFlow.id}`,
            headers: form.getHeaders(),
            payload: form.getBuffer(),
        })
        expect(response.statusCode).toBe(StatusCodes.OK)

        const capture = await captureRepo().findOneByOrFail({ flowId: mockFlow.id })
        expect(capture.body.kind).toBe(WebhookRequestBodyKind.MULTIPART)
        expect(capture.body.files).toHaveLength(1)
        expect(capture.body.files[0].size).toBe(300)
        // Form field payloads are included in the total, not just file bytes.
        expect(capture.body.size).toBeGreaterThanOrEqual(400)

        const files = await databaseConnection().getRepository('file').findBy({
            projectId: ctx.project.id,
            type: FileType.FLOW_STEP_FILE,
        })
        expect(files).toHaveLength(1)
        expect(files[0].size).toBe(300)
    })

    it('filters by the full 4xx/5xx status class ranges', async () => {
        const ctx = await createTestContext(app)
        const { mockFlow } = await createEnabledFlow(ctx)
        // A request to the disabled-path isn't easy to force, so seed captures directly.
        await captureRepo().save([
            buildCapture(ctx, mockFlow.id, { responseStatus: 401 }),
            buildCapture(ctx, mockFlow.id, { responseStatus: 429 }),
            buildCapture(ctx, mockFlow.id, { responseStatus: 502 }),
            buildCapture(ctx, mockFlow.id, { responseStatus: 200 }),
        ])

        const fourxx = await app.inject({
            method: 'GET',
            url: `/api/v1/webhook-requests?projectId=${ctx.project.id}&statusClass=4xx&limit=100`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })
        expect(fourxx.statusCode).toBe(StatusCodes.OK)
        const fourxxStatuses = fourxx.json().data.map((row: { responseStatus: number }) => row.responseStatus)
        expect(fourxxStatuses.sort()).toEqual([401, 429])

        const fivexx = await app.inject({
            method: 'GET',
            url: `/api/v1/webhook-requests?projectId=${ctx.project.id}&statusClass=5xx&limit=100`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })
        expect(fivexx.json().data.map((row: { responseStatus: number }) => row.responseStatus)).toEqual([502])
    })

    it('copies a request into draft sample input without triggering the production flow', async () => {
        const ctx = await createTestContext(app)
        const { mockFlow } = await createEnabledFlow(ctx)

        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/webhooks/${mockFlow.id}`,
            headers: { 'content-type': 'application/json' },
            payload: { hello: 'world' },
        })
        expect(response.statusCode).toBe(StatusCodes.OK)
        const capture = await captureRepo().findOneByOrFail({ flowId: mockFlow.id })

        const runsBefore = await flowRunRepo().countBy({ flowId: mockFlow.id })

        const copyResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/webhook-requests/${capture.id}/copy-as-test-input`,
            headers: {
                authorization: `Bearer ${ctx.token}`,
                'content-type': 'application/json',
            },
            payload: { projectId: ctx.project.id },
        })
        expect(copyResponse.statusCode).toBe(StatusCodes.OK)
        expect(copyResponse.json()).toEqual({ copied: true, flowId: mockFlow.id })

        // Only a redacted SAMPLE_DATA_INPUT file was written — no run was created.
        const runsAfter = await flowRunRepo().countBy({ flowId: mockFlow.id })
        expect(runsAfter).toBe(runsBefore)
        const sampleInputs = await databaseConnection().getRepository('file').findBy({
            projectId: ctx.project.id,
            type: FileType.SAMPLE_DATA_INPUT,
        })
        expect(sampleInputs).toHaveLength(1)
        const storedInput = sampleInputs[0].data.toString('utf8')
        expect(storedInput).toContain('hello')
        // Masked headers never come back into test input.
        expect(storedInput).not.toContain('authorization')
    })

    it('does not leak captures across projects even when the capture id is known', async () => {
        const ownerCtx = await createTestContext(app)
        const { mockFlow } = await createEnabledFlow(ownerCtx)

        await app.inject({
            method: 'POST',
            url: `/api/v1/webhooks/${mockFlow.id}`,
            headers: { 'content-type': 'application/json' },
            payload: { secret: 'project-a-data' },
        })
        const capture = await captureRepo().findOneByOrFail({ flowId: mockFlow.id })

        const otherCtx = await createTestContext(app)

        // TABLE authorization resolves the row's project and rejects membership.
        const detailResponse = await app.inject({
            method: 'GET',
            url: `/api/v1/webhook-requests/${capture.id}?projectId=${otherCtx.project.id}`,
            headers: { authorization: `Bearer ${otherCtx.token}` },
        })
        expect([StatusCodes.NOT_FOUND, StatusCodes.FORBIDDEN]).toContain(detailResponse.statusCode)

        // The scoped list must never return another project's row.
        const listResponse = await app.inject({
            method: 'GET',
            url: `/api/v1/webhook-requests?projectId=${otherCtx.project.id}&requestId=${capture.requestId}`,
            headers: { authorization: `Bearer ${otherCtx.token}` },
        })
        expect(listResponse.statusCode).toBe(StatusCodes.OK)
        expect(listResponse.json().data).toHaveLength(0)
    })
})

function buildCapture(
    ctx: TestContext,
    flowId: string,
    override: Partial<{ responseStatus: number }>,
) {
    return {
        id: `cap${Math.random().toString(36).slice(2, 12)}`,
        created: new Date(),
        updated: new Date(),
        projectId: ctx.project.id,
        platformId: ctx.platform.id,
        flowId,
        requestId: `req${Math.random().toString(36).slice(2, 12)}`,
        method: 'POST',
        path: `/v1/webhooks/${flowId}`,
        headers: {},
        maskedHeaders: [],
        queryParams: {},
        body: {
            kind: WebhookRequestBodyKind.JSON,
            contentType: 'application/json',
            preview: {},
            size: 2,
            truncated: false,
        },
        clientIpPrefix: null,
        responseStatus: override.responseStatus ?? 200,
        environment: 'PRODUCTION',
    }
}

async function createEnabledFlow(ctx: TestContext): Promise<{ mockFlow: Flow }> {
    const mockFlow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.ENABLED })
    await db.save('flow', [mockFlow])
    const mockFlowVersion = createMockFlowVersion({ flowId: mockFlow.id, state: FlowVersionState.DRAFT })
    await db.save('flow_version', [mockFlowVersion])
    await db.update('flow', mockFlow.id, { publishedVersionId: mockFlowVersion.id })
    return { mockFlow }
}
