import { ApId, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'

export enum DependencyNodeType {
    FLOW = 'FLOW',
    TABLE = 'TABLE',
    CONNECTION = 'CONNECTION',
    PIECE = 'PIECE',
    AGENT = 'AGENT',
}

export enum DependencyNodeStatus {
    ACTIVE = 'ACTIVE',
    DELETED = 'DELETED',
}

export enum DependencyEdgeType {
    SUBFLOW_CALL = 'SUBFLOW_CALL',
    AGENT_TOOL = 'AGENT_TOOL',
    AGENT_STEP = 'AGENT_STEP',
    TABLE_TRIGGER = 'TABLE_TRIGGER',
    TABLE_ACTION = 'TABLE_ACTION',
    CONNECTION_REFERENCE = 'CONNECTION_REFERENCE',
    PIECE_USAGE = 'PIECE_USAGE',
}

export enum DependencyEdgeStatus {
    PUBLISHED = 'PUBLISHED',
    DRAFT_ONLY = 'DRAFT_ONLY',
}

export const DependencyNode = z.object({
    id: z.string(),
    type: z.enum(DependencyNodeType),
    displayName: z.string(),
    status: z.enum(DependencyNodeStatus),
    refId: Nullable(z.string()),
    inCycle: z.boolean(),
})
export type DependencyNode = z.infer<typeof DependencyNode>

export const DependencyEdge = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: z.enum(DependencyEdgeType),
    status: z.enum(DependencyEdgeStatus),
    stepNames: z.array(z.string()),
})
export type DependencyEdge = z.infer<typeof DependencyEdge>

export const ProjectDependencyGraph = z.object({
    nodes: z.array(DependencyNode),
    edges: z.array(DependencyEdge),
})
export type ProjectDependencyGraph = z.infer<typeof ProjectDependencyGraph>

export const GetProjectDependencyGraphRequest = z.object({
    projectId: ApId,
})
export type GetProjectDependencyGraphRequest = z.infer<typeof GetProjectDependencyGraphRequest>
