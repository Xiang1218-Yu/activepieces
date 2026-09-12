import { Flow, FlowStatus } from '@activepieces/shared'
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
        expect(capture.headers['x-github-event']).toEqual(['push'])

        // Repeated query keys are preserved as an array.
        expect(capture.queryParams.event).toEqual(['login', 'signup'])

        // Body is stored as a parsed, typed preview.
        expect(capture.body.kind).toBe('JSON')
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

async function createEnabledFlow(ctx: TestContext): Promise<{ mockFlow: Flow }> {
    const mockFlow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.ENABLED })
    await db.save('flow', [mockFlow])
    const mockFlowVersion = createMockFlowVersion({ flowId: mockFlow.id })
    await db.save('flow_version', [mockFlowVersion])
    await db.update('flow', mockFlow.id, { publishedVersionId: mockFlowVersion.id })
    return { mockFlow }
}
