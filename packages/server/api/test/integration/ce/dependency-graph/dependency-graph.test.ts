import {
    FlowActionType,
    FlowTriggerType,
    FlowVersionState,
} from '@activepieces/shared'
import dayjs from 'dayjs'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import {
    createMockConnection,
    createMockFlow,
    createMockFlowVersion,
    createMockTable,
} from '../../../helpers/mocks'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

const SUBFLOWS_PIECE = '@activepieces/piece-subflows'
const TABLES_PIECE = '@activepieces/piece-tables'
const HTTP_PIECE = '@activepieces/piece-http'

function pieceStep({ name, pieceName, input }: { name: string, pieceName: string, input: Record<string, unknown> }) {
    return {
        type: FlowActionType.PIECE,
        name,
        displayName: name,
        valid: true,
        lastUpdatedDate: dayjs().toISOString(),
        settings: {
            pieceName,
            pieceVersion: '0.0.1',
            actionName: 'callFlow',
            input,
            propertySettings: {},
        },
    }
}

function tablesTrigger({ tableExternalId }: { tableExternalId: string }) {
    return {
        type: FlowTriggerType.PIECE,
        name: 'trigger',
        displayName: 'New Record',
        valid: true,
        lastUpdatedDate: dayjs().toISOString(),
        settings: {
            pieceName: TABLES_PIECE,
            pieceVersion: '0.0.1',
            triggerName: 'newRecord',
            input: { table_id: tableExternalId },
            propertySettings: {},
        },
    }
}

describe('Dependency Graph API', () => {
    it('Builds a project-scoped graph with subflow, table, connection, deleted and draft-only states', async () => {
        const ctx = await createTestContext(app!)
        const projectId = ctx.project.id

        const table = createMockTable({ projectId })
        await db.save('table', table)

        const connection = createMockConnection({ projectIds: [projectId], externalId: 'my_connection' }, ctx.user.id)
        await db.save('app_connection', connection)

        const flowB = createMockFlow({ projectId, externalId: 'flow-b-ext' })
        await db.save('flow', flowB)
        const flowBVersion = createMockFlowVersion({
            flowId: flowB.id,
            state: FlowVersionState.DRAFT,
            trigger: {
                type: FlowTriggerType.EMPTY,
                name: 'trigger',
                settings: {},
                valid: false,
                displayName: 'Select Trigger',
                lastUpdatedDate: dayjs().toISOString(),
                nextAction: pieceStep({
                    name: 'call_parent',
                    pieceName: SUBFLOWS_PIECE,
                    input: { flowId: 'flow-a-ext' },
                }),
            },
        })
        await db.save('flow_version', flowBVersion)

        const flowA = createMockFlow({ projectId, externalId: 'flow-a-ext' })
        const flowAPublishedVersion = createMockFlowVersion({
            flowId: flowA.id,
            state: FlowVersionState.LOCKED,
            trigger: tablesTrigger({ tableExternalId: table.externalId }),
        })
        await db.save('flow', flowA)
        await db.save('flow_version', flowAPublishedVersion)
        await db.update('flow', flowA.id, { publishedVersionId: flowAPublishedVersion.id })
        const flowADraftVersion = createMockFlowVersion({
            flowId: flowA.id,
            state: FlowVersionState.DRAFT,
            trigger: {
                ...tablesTrigger({ tableExternalId: table.externalId }),
                nextAction: {
                    ...pieceStep({
                        name: 'call_child',
                        pieceName: SUBFLOWS_PIECE,
                        input: { flowId: 'flow-b-ext' },
                    }),
                    nextAction: {
                        ...pieceStep({
                            name: 'call_deleted',
                            pieceName: SUBFLOWS_PIECE,
                            input: { flowId: 'deleted-flow-ext' },
                        }),
                        nextAction: pieceStep({
                            name: 'http_step',
                            pieceName: HTTP_PIECE,
                            input: { auth: '{{connections[\'my_connection\']}}' },
                        }),
                    },
                },
            },
        })
        await db.save('flow_version', flowADraftVersion)

        const otherCtx = await createTestContext(app!)
        const otherFlow = createMockFlow({ projectId: otherCtx.project.id, externalId: 'other-project-flow' })
        await db.save('flow', otherFlow)
        await db.save('flow_version', createMockFlowVersion({ flowId: otherFlow.id, state: FlowVersionState.DRAFT }))

        const response = await ctx.get('/v1/dependency-graph', { projectId })
        expect(response?.statusCode).toBe(StatusCodes.OK)
        const graph = response?.json()

        const nodeById = new Map(graph.nodes.map((node: { id: string }) => [node.id, node]))

        const flowANode = nodeById.get('FLOW:flow-a-ext')
        expect(flowANode).toBeDefined()
        expect(flowANode.status).toBe('ACTIVE')
        expect(flowANode.refId).toBe(flowA.id)

        const flowBNode = nodeById.get('FLOW:flow-b-ext')
        expect(flowBNode).toBeDefined()
        expect(flowBNode.refId).toBe(flowB.id)

        expect(flowANode.inCycle).toBe(true)
        expect(flowBNode.inCycle).toBe(true)

        const tableNode = nodeById.get(`TABLE:${table.externalId}`)
        expect(tableNode).toBeDefined()
        expect(tableNode.refId).toBe(table.id)

        const connectionNode = nodeById.get('CONNECTION:my_connection')
        expect(connectionNode).toBeDefined()
        expect(connectionNode.refId).toBe(connection.id)

        const deletedNode = nodeById.get('FLOW:deleted-flow-ext')
        expect(deletedNode).toBeDefined()
        expect(deletedNode.status).toBe('DELETED')
        expect(deletedNode.refId).toBeNull()

        expect(nodeById.get(`PIECE:${HTTP_PIECE}`)).toBeDefined()
        expect(nodeById.get('FLOW:other-project-flow')).toBeUndefined()
        expect(nodeById.get(`TABLE:${table.externalId}`).status).toBe('ACTIVE')

        const edgeKey = (edge: { source: string, type: string, target: string }) => `${edge.source}|${edge.type}|${edge.target}`
        const edges = new Map(graph.edges.map((edge: { source: string, type: string, target: string }) => [edgeKey(edge), edge]))

        const subflowEdge = edges.get('FLOW:flow-a-ext|SUBFLOW_CALL|FLOW:flow-b-ext')
        expect(subflowEdge).toBeDefined()
        expect(subflowEdge.status).toBe('DRAFT_ONLY')

        const reverseSubflowEdge = edges.get('FLOW:flow-b-ext|SUBFLOW_CALL|FLOW:flow-a-ext')
        expect(reverseSubflowEdge).toBeDefined()
        expect(reverseSubflowEdge.status).toBe('DRAFT_ONLY')

        const tableTriggerEdge = edges.get(`FLOW:flow-a-ext|TABLE_TRIGGER|TABLE:${table.externalId}`)
        expect(tableTriggerEdge).toBeDefined()
        expect(tableTriggerEdge.status).toBe('PUBLISHED')

        const connectionEdge = edges.get('FLOW:flow-a-ext|CONNECTION_REFERENCE|CONNECTION:my_connection')
        expect(connectionEdge).toBeDefined()
        expect(connectionEdge.status).toBe('DRAFT_ONLY')

        const deletedEdge = edges.get('FLOW:flow-a-ext|SUBFLOW_CALL|FLOW:deleted-flow-ext')
        expect(deletedEdge).toBeDefined()

        expect(edges.get('FLOW:flow-a-ext|PIECE_USAGE|PIECE:@activepieces/piece-http')).toBeDefined()
    })

    it('Rejects requests without a projectId', async () => {
        const ctx = await createTestContext(app!)
        const response = await ctx.get('/v1/dependency-graph')
        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('Rejects principals without a token', async () => {
        const response = await app!.inject({
            method: 'GET',
            url: '/api/v1/dependency-graph?projectId=abcdefghijklmnopqrstu',
        })
        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
