import { hooksFactory } from '../helper/hooks-factory'

export const dependencyGraphHooks = hooksFactory.create<DependencyGraphHooks>(() => ({
    getAgentDependencies: async (): Promise<AgentDependencyInfo[]> => [],
}))

export type AgentDependencyInfo = {
    externalId: string
    refId: string
    displayName: string
    draftFlowExternalIds: string[]
    publishedFlowExternalIds: string[]
}

export type DependencyGraphHooks = {
    getAgentDependencies(params: { projectId: string }): Promise<AgentDependencyInfo[]>
}
