import { apId } from '@activepieces/core-utils'
import { ActivepiecesError, AppConnectionScope, AppConnectionStatus, AppConnectionType, ConnectionHealthSuggestedAction, ErrorCode, FlowStatus, FlowVersionState, PackageType, PieceType, PLACEHOLDER_CONNECTION_TYPE } from '@activepieces/shared'
import { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { appConnectionHandler } from '../../../../src/app/app-connection/app-connection-service/app-connection.handler'
import { encryptUtils } from '../../../../src/app/helper/encryption'
import { pieceMetadataService } from '../../../../src/app/pieces/metadata/piece-metadata-service'
import { db } from '../../../helpers/db'
import { describeWithAuth } from '../../../helpers/describe-with-auth'
import {
    createMockConnection,
    createMockFlow,
    createMockFlowVersion,
    createMockPieceMetadata,
} from '../../../helpers/mocks'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null
let mockLog: FastifyBaseLogger

beforeAll(async () => {
    app = await setupTestEnvironment()
    mockLog = app!.log!
})

afterAll(async () => {
    await teardownTestEnvironment()
})

const saveMockPiece = async ({ platformId, name, version }: { platformId: string, name: string, version: string }) => {
    const mockPiece = createMockPieceMetadata({
        name,
        version,
        platformId,
        packageType: PackageType.REGISTRY,
        pieceType: PieceType.CUSTOM,
    })
    await db.save('piece_metadata', mockPiece)
    pieceMetadataService(mockLog).getOrThrow = vi.fn().mockResolvedValue(mockPiece)
    return mockPiece
}

const createSecretConnection = async (ctx: Awaited<ReturnType<typeof createTestContext>>, params: { externalId: string, pieceName: string, pieceVersion: string, displayName?: string }) => {
    const response = await ctx.post('/v1/app-connections', {
        externalId: params.externalId,
        displayName: params.displayName ?? params.externalId,
        pieceName: params.pieceName,
        projectId: ctx.project.id,
        type: AppConnectionType.SECRET_TEXT,
        value: {
            type: AppConnectionType.SECRET_TEXT,
            secret_text: 'my-secret',
        },
        pieceVersion: params.pieceVersion,
    })
    expect(response?.statusCode).toBe(StatusCodes.CREATED)
    return response?.json()
}

describe('Connection Health API', () => {
    describeWithAuth('GET /v1/app-connections/health', () => app!, (setup) => {
        it('should aggregate project and global connections with health data and hide secrets', async () => {
            const ctx = await setup()
            const mockPiece = await saveMockPiece({ platformId: ctx.platform.id, name: `piece-${apId()}`, version: '1.0.0' })

            const projectConnection = await createSecretConnection(ctx, {
                externalId: 'health-project-connection',
                pieceName: mockPiece.name,
                pieceVersion: mockPiece.version,
            })

            const globalConnection = createMockConnection({
                platformId: ctx.platform.id,
                projectIds: [ctx.project.id],
                pieceName: mockPiece.name,
                pieceVersion: mockPiece.version,
                externalId: 'health-global-connection',
            }, ctx.user.id)
            await db.save('app_connection', {
                ...globalConnection,
                scope: AppConnectionScope.PLATFORM,
                value: await encryptUtils.encryptObject(globalConnection.value),
            })

            const response = await ctx.get('/v1/app-connections/health', {
                projectId: ctx.project.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.data).toHaveLength(2)

            const byExternalId = new Map(body.data.map((item: Record<string, unknown>) => [item.externalId, item]))
            const projectItem = byExternalId.get('health-project-connection') as Record<string, unknown>
            const globalItem = byExternalId.get('health-global-connection') as Record<string, unknown>

            expect(projectItem.id).toBe(projectConnection.id)
            expect(projectItem.scope).toBe(AppConnectionScope.PROJECT)
            expect(globalItem.scope).toBe(AppConnectionScope.PLATFORM)

            for (const item of body.data) {
                expect(item.value).toBeUndefined()
                expect(item.flowCount).toBe(0)
                expect(item.suggestedAction).toBe(ConnectionHealthSuggestedAction.NONE)
            }
            expect(projectItem.lastValidatedAt).not.toBeNull()
        })

        it('should return null lastValidatedAt for placeholder connections', async () => {
            const ctx = await setup()
            const mockPiece = await saveMockPiece({ platformId: ctx.platform.id, name: `piece-${apId()}`, version: '1.0.0' })

            const placeholder = await ctx.post('/v1/app-connections', {
                externalId: 'health-placeholder',
                displayName: 'Pending Setup',
                pieceName: mockPiece.name,
                projectId: ctx.project.id,
                type: PLACEHOLDER_CONNECTION_TYPE,
                pieceVersion: mockPiece.version,
            })
            expect(placeholder?.statusCode).toBe(StatusCodes.CREATED)
            expect(placeholder?.json().lastValidatedAt).toBeNull()

            const response = await ctx.get('/v1/app-connections/health', {
                projectId: ctx.project.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const item = response?.json().data.find((connection: Record<string, unknown>) => connection.externalId === 'health-placeholder')
            expect(item.lastValidatedAt).toBeNull()
            expect(item.status).toBe(AppConnectionStatus.MISSING)
            expect(item.suggestedAction).toBe(ConnectionHealthSuggestedAction.COMPLETE_SETUP)
        })

        it('should count flows referencing the connection', async () => {
            const ctx = await setup()
            const mockPiece = await saveMockPiece({ platformId: ctx.platform.id, name: `piece-${apId()}`, version: '1.0.0' })

            const connection = await createSecretConnection(ctx, {
                externalId: 'health-flow-count',
                pieceName: mockPiece.name,
                pieceVersion: mockPiece.version,
            })

            const flow = createMockFlow({
                projectId: ctx.project.id,
                status: FlowStatus.ENABLED,
            })
            await db.save('flow', flow)
            const flowVersion = createMockFlowVersion({
                flowId: flow.id,
                state: FlowVersionState.DRAFT,
                connectionIds: ['health-flow-count'],
            })
            await db.save('flow_version', flowVersion)

            const response = await ctx.get('/v1/app-connections/health', {
                projectId: ctx.project.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const item = response?.json().data.find((candidate: Record<string, unknown>) => candidate.id === connection.id)
            expect(item.flowCount).toBe(1)
        })

        it('should suggest RECONNECT for connections in error state', async () => {
            const ctx = await setup()
            const mockPiece = await saveMockPiece({ platformId: ctx.platform.id, name: `piece-${apId()}`, version: '1.0.0' })

            const connection = await createSecretConnection(ctx, {
                externalId: 'health-error-connection',
                pieceName: mockPiece.name,
                pieceVersion: mockPiece.version,
            })
            await db.update('app_connection', connection.id, {
                status: AppConnectionStatus.ERROR,
            })

            const response = await ctx.get('/v1/app-connections/health', {
                projectId: ctx.project.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const item = response?.json().data.find((candidate: Record<string, unknown>) => candidate.id === connection.id)
            expect(item.status).toBe(AppConnectionStatus.ERROR)
            expect(item.suggestedAction).toBe(ConnectionHealthSuggestedAction.RECONNECT)
        })

        it('should suggest UPDATE_PIECE_VERSION when the piece has a newer version', async () => {
            const ctx = await setup()
            const pieceName = `piece-${apId()}`
            await saveMockPiece({ platformId: ctx.platform.id, name: pieceName, version: '1.0.0' })
            const latestPiece = await saveMockPiece({ platformId: ctx.platform.id, name: pieceName, version: '1.1.0' })

            const outdated = await createSecretConnection(ctx, {
                externalId: 'health-outdated-piece',
                pieceName,
                pieceVersion: '1.0.0',
            })
            const upToDate = await createSecretConnection(ctx, {
                externalId: 'health-up-to-date-piece',
                pieceName,
                pieceVersion: latestPiece.version,
            })

            const response = await ctx.get('/v1/app-connections/health', {
                projectId: ctx.project.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const data = response?.json().data
            const outdatedItem = data.find((candidate: Record<string, unknown>) => candidate.id === outdated.id)
            const upToDateItem = data.find((candidate: Record<string, unknown>) => candidate.id === upToDate.id)
            expect(outdatedItem.suggestedAction).toBe(ConnectionHealthSuggestedAction.UPDATE_PIECE_VERSION)
            expect(upToDateItem.suggestedAction).toBe(ConnectionHealthSuggestedAction.NONE)
        })

        it('should filter by piece, status and project', async () => {
            const ctx = await setup()
            const pieceA = await saveMockPiece({ platformId: ctx.platform.id, name: `piece-a-${apId()}`, version: '1.0.0' })
            const pieceB = await saveMockPiece({ platformId: ctx.platform.id, name: `piece-b-${apId()}`, version: '1.0.0' })

            await createSecretConnection(ctx, {
                externalId: 'health-filter-a',
                pieceName: pieceA.name,
                pieceVersion: pieceA.version,
            })
            const errorConnection = await createSecretConnection(ctx, {
                externalId: 'health-filter-b',
                pieceName: pieceB.name,
                pieceVersion: pieceB.version,
            })
            await db.update('app_connection', errorConnection.id, {
                status: AppConnectionStatus.ERROR,
            })

            const otherProjectId = apId()
            const sharedGlobal = createMockConnection({
                platformId: ctx.platform.id,
                projectIds: [ctx.project.id, otherProjectId],
                pieceName: pieceB.name,
                pieceVersion: pieceB.version,
                externalId: 'health-filter-shared',
            }, ctx.user.id)
            await db.save('app_connection', {
                ...sharedGlobal,
                scope: AppConnectionScope.PLATFORM,
                value: await encryptUtils.encryptObject(sharedGlobal.value),
            })

            const byPiece = await ctx.get('/v1/app-connections/health', {
                projectId: ctx.project.id,
                pieceName: pieceA.name,
            })
            expect(byPiece?.statusCode).toBe(StatusCodes.OK)
            expect(byPiece?.json().data.map((item: Record<string, unknown>) => item.externalId)).toEqual(['health-filter-a'])

            const byStatus = await ctx.get('/v1/app-connections/health', {
                projectId: ctx.project.id,
                status: [AppConnectionStatus.ERROR],
            })
            expect(byStatus?.statusCode).toBe(StatusCodes.OK)
            expect(byStatus?.json().data.map((item: Record<string, unknown>) => item.externalId)).toEqual(['health-filter-b'])

            const byProject = await ctx.get('/v1/app-connections/health', {
                projectId: ctx.project.id,
                projectIds: [otherProjectId],
            })
            expect(byProject?.statusCode).toBe(StatusCodes.OK)
            expect(byProject?.json().data.map((item: Record<string, unknown>) => item.externalId)).toEqual(['health-filter-shared'])
        })

        it('should not list connections of another project', async () => {
            const ctx1 = await createTestContext(app!)
            const ctx2 = await createTestContext(app!)
            const mockPiece = await saveMockPiece({ platformId: ctx1.platform.id, name: `piece-${apId()}`, version: '1.0.0' })

            await createSecretConnection(ctx1, {
                externalId: 'health-isolation',
                pieceName: mockPiece.name,
                pieceVersion: mockPiece.version,
            })

            const response = await ctx2.get('/v1/app-connections/health', {
                projectId: ctx2.project.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const externalIds = response?.json().data.map((item: Record<string, unknown>) => item.externalId)
            expect(externalIds).not.toContain('health-isolation')
        })

        it('should forbid users without access to the project', async () => {
            const ctx1 = await createTestContext(app!)
            const ctx2 = await createTestContext(app!)

            const response = await ctx2.get('/v1/app-connections/health', {
                projectId: ctx1.project.id,
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })
    })

    describe('revalidateConnection recovery guarantees', () => {
        it('should mark the connection ERROR and keep the stored value when validation fails', async () => {
            const ctx = await createTestContext(app!)
            const mockPiece = await saveMockPiece({ platformId: ctx.platform.id, name: `piece-${apId()}`, version: '1.0.0' })

            const connection = await createSecretConnection(ctx, {
                externalId: 'health-revalidate-failure',
                pieceName: mockPiece.name,
                pieceVersion: mockPiece.version,
            })

            const result = await appConnectionHandler(mockLog).revalidateConnection({
                id: connection.id,
                platformId: ctx.platform.id,
                projectId: ctx.project.id,
                externalId: connection.externalId,
                validate: async () => {
                    throw new ActivepiecesError({
                        code: ErrorCode.INVALID_APP_CONNECTION,
                        params: { error: 'bad credentials' },
                    })
                },
                log: mockLog,
            })

            expect(result?.status).toBe(AppConnectionStatus.ERROR)
            expect(result?.lastValidatedAt).not.toBeNull()

            const stored = await db.findOneByOrFail<Record<string, unknown>>('app_connection', { id: connection.id })
            expect(stored.status).toBe(AppConnectionStatus.ERROR)
            expect(stored.lastValidatedAt).not.toBeNull()
            const storedValue = await encryptUtils.decryptObject<{ secret_text: string }>(stored.value as { iv: string, data: string })
            expect(storedValue.secret_text).toBe('my-secret')
        })

        it('should mark the connection ACTIVE and stamp lastValidatedAt when validation passes', async () => {
            const ctx = await createTestContext(app!)
            const mockPiece = await saveMockPiece({ platformId: ctx.platform.id, name: `piece-${apId()}`, version: '1.0.0' })

            const connection = await createSecretConnection(ctx, {
                externalId: 'health-revalidate-success',
                pieceName: mockPiece.name,
                pieceVersion: mockPiece.version,
            })
            await db.update('app_connection', connection.id, {
                status: AppConnectionStatus.ERROR,
                lastValidatedAt: null,
            })

            const result = await appConnectionHandler(mockLog).revalidateConnection({
                id: connection.id,
                platformId: ctx.platform.id,
                projectId: ctx.project.id,
                externalId: connection.externalId,
                validate: async () => undefined,
                log: mockLog,
            })

            expect(result?.status).toBe(AppConnectionStatus.ACTIVE)
            expect(result?.lastValidatedAt).not.toBeNull()

            const stored = await db.findOneByOrFail<Record<string, unknown>>('app_connection', { id: connection.id })
            expect(stored.status).toBe(AppConnectionStatus.ACTIVE)
            expect(stored.lastValidatedAt).not.toBeNull()
        })
    })
})
