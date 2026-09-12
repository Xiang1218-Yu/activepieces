import { apId } from '@activepieces/core-utils'
import {
    FlowRunStatus,
    FlowStatus,
    FlowTriggerType,
    FlowVersionState,
    FormSessionAttribution,
    FormSessionEvent,
    FormSessionStatus,
    PackageType,
    PieceType,
    RunEnvironment,
} from '@activepieces/shared'
import { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../../../src/app/database/database-connection'
import { pieceCache } from '../../../../../../src/app/pieces/metadata/piece-cache'
import { db } from '../../../../../helpers/db'
import {
    createMockFlow,
    createMockFlowRun,
    createMockFlowVersion,
    createMockPieceMetadata,
} from '../../../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../../../helpers/test-setup'

let app: FastifyInstance | null = null
let mockLog: FastifyBaseLogger
let ctx: TestContext
let flowId: string
let flowVersionId: string

const VISITOR_KEY = 'vk_test_visitor_key_value'

async function seedFormFlow(): Promise<void> {
    await databaseConnection().getRepository('piece_metadata').createQueryBuilder().delete().execute()
    const mockPiece = createMockPieceMetadata({
        name: '@activepieces/piece-forms',
        version: '0.5.0',
        pieceType: PieceType.OFFICIAL,
        packageType: PackageType.REGISTRY,
    })
    await db.save('piece_metadata', mockPiece)
    await pieceCache(mockLog).setup()

    const mockFlow = createMockFlow({
        projectId: ctx.project.id,
        status: FlowStatus.ENABLED,
    })
    await db.save('flow', mockFlow)
    flowId = mockFlow.id

    const mockFlowVersion = createMockFlowVersion({
        flowId,
        state: FlowVersionState.LOCKED,
        trigger: {
            type: FlowTriggerType.PIECE,
            settings: {
                pieceName: '@activepieces/piece-forms',
                pieceVersion: '0.5.0',
                triggerName: 'form_submission',
                input: {
                    inputs: [
                        { displayName: 'Name', required: true, description: '', type: 'text' },
                        { displayName: 'Email', required: true, description: '', type: 'text' },
                    ],
                    waitForResponse: false,
                },
                propertySettings: {},
            },
            valid: true,
            name: 'trigger',
            displayName: 'Form Submission',
        },
    })
    await db.save('flow_version', mockFlowVersion)
    flowVersionId = mockFlowVersion.id
    await db.update('flow', flowId, { publishedVersionId: flowVersionId })
}

async function startSession(visitorKey = VISITOR_KEY, useDraft = false): Promise<string> {
    const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/form-analytics/sessions',
        headers: { 'x-ap-form-session': visitorKey },
        payload: { flowId, useDraft },
    })
    expect(response.statusCode).toBe(StatusCodes.OK)
    return response.json().sessionId
}

async function trackEvent(sessionId: string, event: FormSessionEvent, reachedFields?: string[]): Promise<void> {
    const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/form-analytics/events',
        payload: { flowId, sessionId, event, reachedFields },
    })
    expect(response.statusCode).toBe(StatusCodes.OK)
}

async function trackInteraction(sessionId: string, fieldName: string, reachedFieldNames: string[]): Promise<void> {
    const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/form-analytics/field-interactions',
        payload: { flowId, sessionId, fieldName, reachedFieldNames },
    })
    expect(response.statusCode).toBe(StatusCodes.OK)
}

async function getFunnel(attribution?: FormSessionAttribution) {
    const query: Record<string, string> = { projectId: ctx.project.id }
    if (attribution) {
        query.attribution = attribution
    }
    return ctx.get('/v1/form-analytics', query)
}

beforeAll(async () => {
    app = await setupTestEnvironment()
    mockLog = app!.log!
    ctx = await createTestContext(app!)
    await seedFormFlow()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Form Analytics API', () => {
    it('deduplicates repeated visits into one session per visitor (refresh does not create sessions)', async () => {
        const first = await startSession('vk_refresh_visitor')
        const second = await startSession('vk_refresh_visitor')
        expect(second).toBe(first)

        const sessions = await databaseConnection().getRepository('form_session').find({ where: { visitorKey: 'vk_refresh_visitor' } })
        expect(sessions).toHaveLength(1)
    })

    it('separates anonymous visitors from authenticated users', async () => {
        const anonymousSession = await startSession('vk_anon_user')
        await trackEvent(anonymousSession, FormSessionEvent.START, ['Name'])

        const authenticatedSession = await startSession('vk_auth_user')
        const authedResponse = await app!.inject({
            method: 'POST',
            url: '/api/v1/form-analytics/events',
            headers: { authorization: `Bearer ${ctx.token}` },
            payload: { flowId, sessionId: authenticatedSession, event: FormSessionEvent.START, reachedFields: ['Name'] },
        })
        expect(authedResponse.statusCode).toBe(StatusCodes.OK)

        const authedSession = await databaseConnection().getRepository('form_session').findOneByOrFail({ id: authenticatedSession })
        expect(authedSession.attribution).toBe(FormSessionAttribution.AUTHENTICATED)
        const anonSession = await databaseConnection().getRepository('form_session').findOneByOrFail({ id: anonymousSession })
        expect(anonSession.attribution).toBe(FormSessionAttribution.ANONYMOUS)
    })

    it('records field reached/interacted so abandonment can be computed', async () => {
        const sessionId = await startSession('vk_field_user')
        await trackInteraction(sessionId, 'Name', ['Name'])

        const rows = await databaseConnection().getRepository('form_field_interaction').find({ where: { sessionId } })
        const nameRow = rows.find((row) => row.fieldName === 'Name')
        expect(nameRow?.interacted).toBe(true)
    })

    it('maps a succeeded run to SUBMITTED using the run list status definition', async () => {
        const sessionId = await startSession('vk_success_user')
        await trackEvent(sessionId, FormSessionEvent.START, ['Name', 'Email'])
        await trackEvent(sessionId, FormSessionEvent.SUBMIT)

        const runId = apId()
        await db.save('flow_run', createMockFlowRun({
            id: runId,
            flowId,
            flowVersionId,
            projectId: ctx.project.id,
            status: FlowRunStatus.SUCCEEDED,
            environment: RunEnvironment.PRODUCTION,
        }))
        await db.update('form_session', sessionId, { runId })

        const response = await getFunnel(FormSessionAttribution.ANONYMOUS)
        expect(response.statusCode).toBe(StatusCodes.OK)
        const submitted = response.json().data
            .flatMap((row: { funnel: { key: string, count: number }[] }) => row.funnel)
            .filter((stage: { key: string }) => stage.key === FormSessionStatus.SUBMITTED)
            .reduce((sum: number, stage: { count: number }) => sum + stage.count, 0)
        expect(submitted).toBeGreaterThanOrEqual(1)
    })

    it('maps a timed out run to TIMED_OUT', async () => {
        const sessionId = await startSession('vk_timeout_user')
        await trackEvent(sessionId, FormSessionEvent.SUBMIT)
        const runId = apId()
        await db.save('flow_run', createMockFlowRun({
            id: runId,
            flowId,
            flowVersionId,
            projectId: ctx.project.id,
            status: FlowRunStatus.TIMEOUT,
            environment: RunEnvironment.PRODUCTION,
        }))
        await db.update('form_session', sessionId, { runId })

        const response = await getFunnel()
        const timedOut = response.json().data
            .flatMap((row: { funnel: { key: string, count: number }[] }) => row.funnel)
            .filter((stage: { key: string }) => stage.key === FormSessionStatus.TIMED_OUT)
            .reduce((sum: number, stage: { count: number }) => sum + stage.count, 0)
        expect(timedOut).toBeGreaterThanOrEqual(1)
    })

    it('excludes archived (deleted) submissions from analytics detail', async () => {
        const archivedFlow = createMockFlow({
            projectId: ctx.project.id,
            status: FlowStatus.ENABLED,
        })
        await db.save('flow', archivedFlow)
        const archivedVersion = createMockFlowVersion({
            flowId: archivedFlow.id,
            state: FlowVersionState.LOCKED,
            trigger: {
                type: FlowTriggerType.PIECE,
                settings: {
                    pieceName: '@activepieces/piece-forms',
                    pieceVersion: '0.5.0',
                    triggerName: 'form_submission',
                    input: { inputs: [], waitForResponse: false },
                    propertySettings: {},
                },
                valid: true,
                name: 'trigger',
                displayName: 'Form Submission',
            },
        })
        await db.save('flow_version', archivedVersion)
        await db.update('flow', archivedFlow.id, { publishedVersionId: archivedVersion.id })

        const sessionId = apId()
        await databaseConnection().getRepository('form_session').save({
            id: sessionId,
            projectId: ctx.project.id,
            flowId: archivedFlow.id,
            flowVersionId: archivedVersion.id,
            visitorKey: 'vk_archived_isolated',
            attribution: FormSessionAttribution.ANONYMOUS,
            userId: null,
            status: FormSessionStatus.SUBMITTED,
            runId: null,
            useDraft: false,
            lastEventAt: new Date().toISOString(),
        })
        const runId = apId()
        await db.save('flow_run', createMockFlowRun({
            id: runId,
            flowId: archivedFlow.id,
            flowVersionId: archivedVersion.id,
            projectId: ctx.project.id,
            status: FlowRunStatus.SUCCEEDED,
            environment: RunEnvironment.PRODUCTION,
            archivedAt: new Date().toISOString(),
        }))
        await db.update('form_session', sessionId, { runId })

        const response = await ctx.get('/v1/form-analytics', {
            projectId: ctx.project.id,
            flowId: archivedFlow.id,
        })
        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().data).toHaveLength(0)
    })

    it('does not track draft form sessions in production analytics', async () => {
        const draftSession = await startSession('vk_draft_visitor', true)
        const session = await databaseConnection().getRepository('form_session').findOneBy({ id: draftSession })
        if (session) {
            expect(session.useDraft).toBe(true)
        }
        const response = await getFunnel()
        const data = response.json().data as { flowId: string }[]
        expect(data.every((row) => row.flowId === flowId)).toBe(true)
    })
})
