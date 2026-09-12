import { isNil } from '@activepieces/core-utils'
import {
    AI_PIECE_NAME,
    DependencyEdge,
    DependencyEdgeStatus,
    DependencyEdgeType,
    DependencyNode,
    DependencyNodeStatus,
    DependencyNodeType,
    FlowActionType,
    flowStructureUtil,
    FlowTriggerType,
    FlowVersion,
    FlowVersionState,
    ProjectDependencyGraph,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { ArrayContains, In } from 'typeorm'
import { appConnectionsRepo } from '../app-connection/app-connection-service/app-connection-service'
import { flowRepo } from '../flows/flow/flow.repo'
import { flowVersionRepo } from '../flows/flow-version/flow-version.service'
import { tableRepo } from '../tables/table/table.service'
import { dependencyGraphHooks } from './dependency-graph.hooks'

const SUBFLOWS_PIECE_NAME = '@activepieces/piece-subflows'
const TABLES_PIECE_NAME = '@activepieces/piece-tables'
const SUBFLOW_ACTION_INPUT_KEYS = ['flowId', 'subflow']
const MAX_STEP_NAMES_PER_EDGE = 20

export const dependencyGraphService = (log: FastifyBaseLogger): DependencyGraphService => ({
    async getProjectGraph({ projectId }: GetProjectGraphParams): Promise<ProjectDependencyGraph> {
        const [flows, tables, connections, agentDependencies] = await Promise.all([
            flowRepo().findBy({ projectId }),
            tableRepo().findBy({ projectId }),
            appConnectionsRepo().findBy({ projectIds: ArrayContains([projectId]) }),
            dependencyGraphHooks.get(log).getAgentDependencies({ projectId }),
        ])

        const publishedVersionIds = flows.map((flow) => flow.publishedVersionId).filter((id): id is string => !isNil(id))
        const versionFilters = [
            { flowId: In(flows.map((flow) => flow.id)), state: FlowVersionState.DRAFT },
            ...(publishedVersionIds.length > 0 ? [{ id: In(publishedVersionIds) }] : []),
        ]
        const versions = flows.length === 0 ? [] : await flowVersionRepo().find({ where: versionFilters })
        const versionsByFlow = new Map<string, { draft?: FlowVersion, published?: FlowVersion }>()
        for (const version of versions) {
            const entry = versionsByFlow.get(version.flowId) ?? {}
            if (version.state === FlowVersionState.DRAFT) {
                entry.draft = version
            }
            else {
                entry.published = version
            }
            versionsByFlow.set(version.flowId, entry)
        }

        const nodes = new Map<string, DependencyNode>()
        const edges = new Map<string, DependencyEdge>()

        const upsertNode = (node: DependencyNode): void => {
            const existing = nodes.get(node.id)
            if (isNil(existing) || existing.status === DependencyNodeStatus.DELETED) {
                nodes.set(node.id, node)
            }
        }
        const addEdge = ({ source, target, type, status, stepName }: EdgeOccurrence): void => {
            const id = `${source}|${type}|${target}`
            const existing = edges.get(id)
            if (isNil(existing)) {
                edges.set(id, {
                    id,
                    source,
                    target,
                    type,
                    status,
                    stepNames: isNil(stepName) ? [] : [stepName],
                })
                return
            }
            if (status === DependencyEdgeStatus.PUBLISHED) {
                existing.status = DependencyEdgeStatus.PUBLISHED
            }
            if (!isNil(stepName) && !existing.stepNames.includes(stepName) && existing.stepNames.length < MAX_STEP_NAMES_PER_EDGE) {
                existing.stepNames.push(stepName)
            }
        }

        const flowDisplayNameByExternalId = new Map<string, string>()
        for (const flow of flows) {
            const flowVersions = versionsByFlow.get(flow.id)
            const displayName = flowVersions?.published?.displayName ?? flowVersions?.draft?.displayName ?? flow.externalId
            flowDisplayNameByExternalId.set(flow.externalId, displayName)
            upsertNode(activeNode({
                id: flowNodeId(flow.externalId),
                type: DependencyNodeType.FLOW,
                displayName,
                refId: flow.id,
            }))
            for (const [version, status] of versionWithStatus(flowVersions)) {
                for (const occurrence of extractVersionEdgeOccurrences({ version, sourceNodeId: flowNodeId(flow.externalId), status })) {
                    addEdge(occurrence)
                }
            }
        }

        for (const agent of agentDependencies) {
            upsertNode(activeNode({
                id: agentNodeId(agent.externalId),
                type: DependencyNodeType.AGENT,
                displayName: agent.displayName,
                refId: agent.refId,
            }))
            for (const flowExternalId of agent.publishedFlowExternalIds) {
                addEdge({ source: agentNodeId(agent.externalId), target: flowNodeId(flowExternalId), type: DependencyEdgeType.AGENT_TOOL, status: DependencyEdgeStatus.PUBLISHED, stepName: null })
            }
            for (const flowExternalId of agent.draftFlowExternalIds) {
                addEdge({ source: agentNodeId(agent.externalId), target: flowNodeId(flowExternalId), type: DependencyEdgeType.AGENT_TOOL, status: DependencyEdgeStatus.DRAFT_ONLY, stepName: null })
            }
        }

        const tableByExternalId = new Map(tables.map((table) => [table.externalId, { id: table.id, name: table.name }]))
        const connectionByExternalId = new Map(connections.map((connection) => [connection.externalId, { id: connection.id, displayName: connection.displayName }]))
        const agentByExternalId = new Map(agentDependencies.map((agent) => [agent.externalId, { id: agent.refId, displayName: agent.displayName }]))

        const edgeList = [...edges.values()]
        for (const edge of edgeList) {
            for (const endpointId of [edge.source, edge.target]) {
                if (nodes.has(endpointId)) {
                    continue
                }
                upsertNode(buildEndpointNode({
                    id: endpointId,
                    flowByExternalId: new Map(flows.map((flow) => [flow.externalId, { id: flow.id, displayName: flowDisplayNameByExternalId.get(flow.externalId) ?? flow.externalId }])),
                    tableByExternalId,
                    connectionByExternalId,
                    agentByExternalId,
                }))
            }
        }

        const nodeList = [...nodes.values()]
        const cyclicNodeIds = findCyclicNodeIds({ nodeIds: nodeList.map((node) => node.id), edges: edgeList })

        return {
            nodes: nodeList.map((node) => ({ ...node, inCycle: cyclicNodeIds.has(node.id) })),
            edges: edgeList,
        }
    },
})

function versionWithStatus(flowVersions: { draft?: FlowVersion, published?: FlowVersion } | undefined): [FlowVersion, DependencyEdgeStatus][] {
    const result: [FlowVersion, DependencyEdgeStatus][] = []
    if (!isNil(flowVersions?.published)) {
        result.push([flowVersions.published, DependencyEdgeStatus.PUBLISHED])
    }
    if (!isNil(flowVersions?.draft)) {
        result.push([flowVersions.draft, DependencyEdgeStatus.DRAFT_ONLY])
    }
    return result
}

function extractVersionEdgeOccurrences({ version, sourceNodeId, status }: ExtractEdgeOccurrencesParams): EdgeOccurrence[] {
    const occurrences: EdgeOccurrence[] = []
    const steps = flowStructureUtil.getAllSteps(version.trigger)
    for (const step of steps) {
        const settings = step.settings
        if (isNil(settings) || !('input' in settings)) {
            continue
        }
        const input: Record<string, unknown> = settings.input ?? {}
        if (typeof input['auth'] === 'string') {
            for (const connectionName of extractConnectionNamesFromAuth(input['auth'])) {
                occurrences.push({
                    source: sourceNodeId,
                    target: connectionNodeId(connectionName),
                    type: DependencyEdgeType.CONNECTION_REFERENCE,
                    status,
                    stepName: step.displayName,
                })
            }
        }
        const isPieceStep = step.type === FlowActionType.PIECE || step.type === FlowTriggerType.PIECE
        if (!isPieceStep || !('pieceName' in settings)) {
            continue
        }
        occurrences.push({
            source: sourceNodeId,
            target: pieceNodeId(settings.pieceName),
            type: DependencyEdgeType.PIECE_USAGE,
            status,
            stepName: step.displayName,
        })
        if (settings.pieceName === SUBFLOWS_PIECE_NAME) {
            const targetExternalId = SUBFLOW_ACTION_INPUT_KEYS.map((key) => input[key]).find((value): value is string => typeof value === 'string' && value.length > 0)
            if (!isNil(targetExternalId)) {
                occurrences.push({
                    source: sourceNodeId,
                    target: flowNodeId(targetExternalId),
                    type: DependencyEdgeType.SUBFLOW_CALL,
                    status,
                    stepName: step.displayName,
                })
            }
        }
        if (settings.pieceName === TABLES_PIECE_NAME && typeof input['table_id'] === 'string' && input['table_id'].length > 0) {
            occurrences.push({
                source: sourceNodeId,
                target: tableNodeId(input['table_id']),
                type: step.type === FlowTriggerType.PIECE ? DependencyEdgeType.TABLE_TRIGGER : DependencyEdgeType.TABLE_ACTION,
                status,
                stepName: step.displayName,
            })
        }
        if (settings.pieceName === AI_PIECE_NAME && typeof input['agentId'] === 'string' && input['agentId'].length > 0) {
            occurrences.push({
                source: sourceNodeId,
                target: agentNodeId(input['agentId']),
                type: DependencyEdgeType.AGENT_STEP,
                status,
                stepName: step.displayName,
            })
        }
    }
    return occurrences
}

function buildEndpointNode({ id, flowByExternalId, tableByExternalId, connectionByExternalId, agentByExternalId }: BuildEndpointNodeParams): DependencyNode {
    const [type, externalId] = nodeIdParts(id)
    switch (type) {
        case DependencyNodeType.FLOW: {
            const flow = flowByExternalId.get(externalId)
            return isNil(flow)
                ? deletedNode(type, externalId)
                : activeNode({ id, type, displayName: flow.displayName, refId: flow.id })
        }
        case DependencyNodeType.TABLE: {
            const table = tableByExternalId.get(externalId)
            return isNil(table)
                ? deletedNode(type, externalId)
                : activeNode({ id, type, displayName: table.name, refId: table.id })
        }
        case DependencyNodeType.CONNECTION: {
            const connection = connectionByExternalId.get(externalId)
            return isNil(connection)
                ? deletedNode(type, externalId)
                : activeNode({ id, type, displayName: connection.displayName, refId: connection.id })
        }
        case DependencyNodeType.AGENT: {
            const agent = agentByExternalId.get(externalId)
            return isNil(agent)
                ? deletedNode(type, externalId)
                : activeNode({ id, type, displayName: agent.displayName, refId: agent.id })
        }
        case DependencyNodeType.PIECE:
            return activeNode({ id, type, displayName: externalId, refId: null })
    }
}

function findCyclicNodeIds({ nodeIds, edges }: { nodeIds: string[], edges: DependencyEdge[] }): Set<string> {
    const adjacency = new Map<string, string[]>()
    for (const edge of edges) {
        const targets = adjacency.get(edge.source) ?? []
        targets.push(edge.target)
        adjacency.set(edge.source, targets)
    }
    const indexByNode = new Map<string, number>()
    const lowLinkByNode = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    const cyclicNodeIds = new Set<string>()
    let nextIndex = 0

    const strongConnect = (nodeId: string): void => {
        indexByNode.set(nodeId, nextIndex)
        lowLinkByNode.set(nodeId, nextIndex)
        nextIndex += 1
        stack.push(nodeId)
        onStack.add(nodeId)
        for (const target of adjacency.get(nodeId) ?? []) {
            if (target === nodeId) {
                cyclicNodeIds.add(nodeId)
                continue
            }
            if (!indexByNode.has(target)) {
                strongConnect(target)
                const nodeLowLink = lowLinkByNode.get(nodeId) ?? 0
                lowLinkByNode.set(nodeId, Math.min(nodeLowLink, lowLinkByNode.get(target) ?? nodeLowLink))
            }
            else if (onStack.has(target)) {
                const nodeLowLink = lowLinkByNode.get(nodeId) ?? 0
                lowLinkByNode.set(nodeId, Math.min(nodeLowLink, indexByNode.get(target) ?? nodeLowLink))
            }
        }
        if (lowLinkByNode.get(nodeId) === indexByNode.get(nodeId)) {
            const component: string[] = []
            let current = stack.pop()
            while (!isNil(current) && current !== nodeId) {
                onStack.delete(current)
                component.push(current)
                current = stack.pop()
            }
            onStack.delete(nodeId)
            if (component.length > 0) {
                for (const id of [nodeId, ...component]) {
                    cyclicNodeIds.add(id)
                }
            }
        }
    }

    for (const nodeId of nodeIds) {
        if (!indexByNode.has(nodeId)) {
            strongConnect(nodeId)
        }
    }
    return cyclicNodeIds
}

function extractConnectionNamesFromAuth(auth: string): string[] {
    const match = auth.match(/{{connections\['([^']*(?:'\s*,\s*'[^']*)*)'\]}}/)
    if (isNil(match) || isNil(match[1])) {
        return []
    }
    return match[1].split(/'\s*,\s*'/).map((id) => id.trim())
}

function activeNode({ id, type, displayName, refId }: { id: string, type: DependencyNodeType, displayName: string, refId: string | null }): DependencyNode {
    return {
        id,
        type,
        displayName,
        status: DependencyNodeStatus.ACTIVE,
        refId,
        inCycle: false,
    }
}

function deletedNode(type: DependencyNodeType, externalId: string): DependencyNode {
    return {
        id: nodeId(type, externalId),
        type,
        displayName: externalId,
        status: DependencyNodeStatus.DELETED,
        refId: null,
        inCycle: false,
    }
}

function nodeIdParts(id: string): [DependencyNodeType, string] {
    const separatorIndex = id.indexOf(':')
    const rawType = id.slice(0, separatorIndex)
    const externalId = id.slice(separatorIndex + 1)
    const parsed = Object.values(DependencyNodeType).find((type) => type === rawType)
    if (isNil(parsed)) {
        return [DependencyNodeType.PIECE, id]
    }
    return [parsed, externalId]
}

function nodeId(type: DependencyNodeType, externalId: string): string {
    return `${type}:${externalId}`
}

const flowNodeId = (externalId: string): string => nodeId(DependencyNodeType.FLOW, externalId)
const tableNodeId = (externalId: string): string => nodeId(DependencyNodeType.TABLE, externalId)
const connectionNodeId = (externalId: string): string => nodeId(DependencyNodeType.CONNECTION, externalId)
const agentNodeId = (externalId: string): string => nodeId(DependencyNodeType.AGENT, externalId)
const pieceNodeId = (pieceName: string): string => nodeId(DependencyNodeType.PIECE, pieceName)

type EdgeOccurrence = {
    source: string
    target: string
    type: DependencyEdgeType
    status: DependencyEdgeStatus
    stepName: string | null
}

type GetProjectGraphParams = {
    projectId: string
}

type ExtractEdgeOccurrencesParams = {
    version: FlowVersion
    sourceNodeId: string
    status: DependencyEdgeStatus
}

type BuildEndpointNodeParams = {
    id: string
    flowByExternalId: Map<string, { id: string, displayName: string }>
    tableByExternalId: Map<string, { id: string, name: string }>
    connectionByExternalId: Map<string, { id: string, displayName: string }>
    agentByExternalId: Map<string, { id: string, displayName: string }>
}

type DependencyGraphService = {
    getProjectGraph(params: GetProjectGraphParams): Promise<ProjectDependencyGraph>
}
