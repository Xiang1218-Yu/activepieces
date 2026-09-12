import { DefaultProjectRole, FlowAction, FlowActionType, FlowCompatibilityStatus, FlowStatus, FlowTrigger, FlowTriggerType, FlowVersionState, PackageType, PieceCompatibilityIssueCode, PieceCompatibilityReport, PieceStepCompatibilityVerdict, PieceType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { db } from '../../../helpers/db'
import { createMockFlow, createMockFlowVersion, createMockPieceMetadata, mockAndSaveBasicSetup } from '../../../helpers/mocks'
import { createMemberContext, createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance
let ctx: TestContext

const PIECE_NAME = 'compat-test-piece'

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    await databaseConnection().getRepository('piece_metadata').createQueryBuilder().delete().execute()
    ctx = await createTestContext(app)
})

describe('POST /v1/piece-compatibility/check', () => {
    it('checks the flows of a project against two piece versions and locates steps without leaking secrets', async () => {
        await seedPieceVersions()

        const flow = createMockFlow({ projectId: ctx.project.id, status: FlowStatus.ENABLED })
        await db.save('flow', flow)
        const version = createMockFlowVersion({
            flowId: flow.id,
            state: FlowVersionState.LOCKED,
            displayName: 'Compat Flow',
            trigger: emptyTriggerWithAction(pieceAction({
                name: 'step_1',
                actionName: 'send',
                input: {
                    message: 'hello',
                    mode: 'b',
                    count: 'not-a-number',
                    auth: '{{connections[\'super-secret-connection-ref\']}}',
                },
            })),
        })
        await db.save('flow_version', version)
        flow.publishedVersionId = version.id
        await db.save('flow', flow)

        const response = await ctx.post('/v1/piece-compatibility/check', {
            pieceName: PIECE_NAME,
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            source: { type: 'PROJECT', projectId: ctx.project.id },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const report = response.json() as PieceCompatibilityReport
        expect(report.pieceName).toBe(PIECE_NAME)
        expect(report.fromVersion).toBe('1.0.0')
        expect(report.toVersion).toBe('2.0.0')
        expect(report.flows).toHaveLength(1)

        const flowResult = report.flows[0]
        expect(flowResult.status).toBe(FlowCompatibilityStatus.CHECKED)
        expect(flowResult.flowId).toBe(flow.id)
        expect(flowResult.flowVersionId).toBe(version.id)
        expect(flowResult.projectId).toBe(ctx.project.id)
        expect(flowResult.projectName).toBe(ctx.project.displayName)

        expect(flowResult.steps).toHaveLength(1)
        const step = flowResult.steps[0]
        expect(step.stepName).toBe('step_1')
        expect(step.actionOrTriggerName).toBe('send')
        expect(step.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
        expect(step.connectionConfigured).toBe(true)
        const codes = step.issues.map((issue) => issue.code)
        expect(codes).toContain(PieceCompatibilityIssueCode.SAVED_VALUE_NOT_IN_OPTIONS)
        expect(codes).toContain(PieceCompatibilityIssueCode.SAVED_VALUE_INVALID_TYPE)

        expect(report.summary.stepsChecked).toBe(1)
        expect(report.summary.incompatibleSteps).toBe(1)

        // connection references and saved values must never leak into the report
        expect(response.body).not.toContain('super-secret-connection-ref')
        expect(response.body).not.toContain('not-a-number')
    })

    it('checks pasted flow versions and isolates per-entry errors', async () => {
        await seedPieceVersions()

        const response = await ctx.post('/v1/piece-compatibility/check', {
            pieceName: PIECE_NAME,
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            source: {
                type: 'PASTED',
                flowVersions: [
                    {
                        id: 'fv-pasted',
                        flowId: 'flow-pasted',
                        displayName: 'Pasted Flow',
                        trigger: emptyTriggerWithAction(pieceAction({
                            name: 'step_1',
                            actionName: 'send',
                            input: { message: 'hi', mode: 'a', count: 5 },
                        })),
                    },
                    { id: 'fv-invalid', flowId: 'flow-invalid', unexpected: true },
                    {
                        id: 'fv-other',
                        flowId: 'flow-other',
                        trigger: {
                            type: FlowTriggerType.EMPTY,
                            name: 'trigger',
                            displayName: 'Trigger',
                            valid: true,
                            settings: {},
                        },
                    },
                ],
            },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const report = response.json() as PieceCompatibilityReport
        expect(report.flows).toHaveLength(3)

        const [checked, invalid, notUsing] = report.flows
        expect(checked.status).toBe(FlowCompatibilityStatus.CHECKED)
        expect(checked.flowVersionId).toBe('fv-pasted')
        // saved value 'a' is still valid, but the option set changed in v2
        expect(checked.steps[0].verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)

        expect(invalid.status).toBe(FlowCompatibilityStatus.ERROR)
        expect(invalid.flowVersionId).toBe('fv-invalid')
        expect(invalid.error).toBeTruthy()

        expect(notUsing.status).toBe(FlowCompatibilityStatus.NOT_USING_PIECE)

        expect(report.summary.flowsErrored).toBe(1)
        expect(report.summary.flowsChecked).toBe(2)
    })

    it('flags re-authorization when the new version changes the authentication type', async () => {
        await db.save('piece_metadata', [
            createMockPieceMetadata({
                name: PIECE_NAME,
                version: '1.0.0',
                pieceType: PieceType.OFFICIAL,
                packageType: PackageType.REGISTRY,
                auth: { type: 'SECRET_TEXT', displayName: 'API Key', required: true },
                actions: { send: sendAction({ requireAuth: true }) },
                triggers: {},
            }),
            createMockPieceMetadata({
                name: PIECE_NAME,
                version: '2.0.0',
                pieceType: PieceType.OFFICIAL,
                packageType: PackageType.REGISTRY,
                auth: {
                    type: 'OAUTH2',
                    displayName: 'Connection',
                    required: true,
                    authUrl: 'https://auth.example.com',
                    tokenUrl: 'https://auth.example.com/token',
                    scope: ['read'],
                },
                actions: { send: sendAction({ requireAuth: true }) },
                triggers: {},
            }),
        ])

        const response = await ctx.post('/v1/piece-compatibility/check', {
            pieceName: PIECE_NAME,
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            source: {
                type: 'PASTED',
                flowVersions: [{
                    id: 'fv-auth',
                    flowId: 'flow-auth',
                    trigger: emptyTriggerWithAction(pieceAction({
                        name: 'step_1',
                        actionName: 'send',
                        input: { message: 'hi', mode: 'a', count: 1, auth: '{{connections[\'conn-1\']}}' },
                    })),
                }],
            },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const report = response.json() as PieceCompatibilityReport
        const step = report.flows[0].steps[0]
        expect(step.verdict).toBe(PieceStepCompatibilityVerdict.REAUTH_REQUIRED)
        expect(step.issues.map((issue) => issue.code)).toContain(PieceCompatibilityIssueCode.AUTH_TYPE_CHANGED)
        expect(response.body).not.toContain('conn-1')
    })

    it('forbids non-admin platform members', async () => {
        const memberCtx = await createMemberContext(app, ctx, {
            projectRole: DefaultProjectRole.VIEWER,
        })

        const response = await memberCtx.post('/v1/piece-compatibility/check', {
            pieceName: PIECE_NAME,
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            source: { type: 'PASTED', flowVersions: [{ id: 'fv-1', trigger: {} }] },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('returns not found when the project belongs to another platform', async () => {
        await seedPieceVersions()
        const other = await mockAndSaveBasicSetup()

        const response = await ctx.post('/v1/piece-compatibility/check', {
            pieceName: PIECE_NAME,
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            source: { type: 'PROJECT', projectId: other.mockProject.id },
        })

        expect(response.statusCode).toBe(StatusCodes.NOT_FOUND)
    })
})

async function seedPieceVersions(): Promise<void> {
    await db.save('piece_metadata', [
        createMockPieceMetadata({
            name: PIECE_NAME,
            version: '1.0.0',
            pieceType: PieceType.OFFICIAL,
            packageType: PackageType.REGISTRY,
            actions: { send: sendAction({ modeOptions: ['a', 'b'] }) },
            triggers: {},
        }),
        createMockPieceMetadata({
            name: PIECE_NAME,
            version: '2.0.0',
            pieceType: PieceType.OFFICIAL,
            packageType: PackageType.REGISTRY,
            actions: { send: sendAction({ modeOptions: ['a'] }) },
            triggers: {},
        }),
    ])
}

type SendActionParams = {
    modeOptions?: string[]
    requireAuth?: boolean
}

function sendAction(params?: SendActionParams): Record<string, unknown> {
    return {
        name: 'send',
        displayName: 'Send',
        description: 'sends things',
        requireAuth: params?.requireAuth ?? false,
        props: {
            message: { type: 'SHORT_TEXT', displayName: 'Message', required: true },
            mode: {
                type: 'STATIC_DROPDOWN',
                displayName: 'Mode',
                required: true,
                options: { options: (params?.modeOptions ?? ['a', 'b']).map((value) => ({ label: value, value })) },
            },
            count: { type: 'NUMBER', displayName: 'Count', required: false },
        },
    }
}

type PieceActionParams = {
    name: string
    actionName: string
    input: Record<string, unknown>
}

function pieceAction({ name, actionName, input }: PieceActionParams): FlowAction {
    return {
        type: FlowActionType.PIECE,
        name,
        displayName: name,
        valid: true,
        lastUpdatedDate: new Date().toISOString(),
        settings: {
            pieceName: PIECE_NAME,
            pieceVersion: '1.0.0',
            actionName,
            input,
            propertySettings: {},
        },
    }
}

function emptyTriggerWithAction(action: FlowAction): FlowTrigger {
    return {
        type: FlowTriggerType.EMPTY,
        name: 'trigger',
        displayName: 'Trigger',
        valid: true,
        lastUpdatedDate: new Date().toISOString(),
        settings: {},
        nextAction: action,
    } as FlowTrigger
}
