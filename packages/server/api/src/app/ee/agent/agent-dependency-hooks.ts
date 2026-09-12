import { AgentToolType } from '@activepieces/core-piece-types'
import { AgentTool } from '@activepieces/shared'
import { AgentDependencyInfo, DependencyGraphHooks } from '../../dependency-graph/dependency-graph.hooks'
import { agentRepo } from './agent-service'

export const agentDependencyHooks: DependencyGraphHooks = {
    async getAgentDependencies({ projectId }) {
        const agents = await agentRepo().findBy({ projectId })
        return agents.map((agent): AgentDependencyInfo => ({
            externalId: agent.externalId,
            refId: agent.id,
            displayName: agent.displayName,
            draftFlowExternalIds: flowExternalIdsOf(agent.draft.tools),
            publishedFlowExternalIds: flowExternalIdsOf(agent.published?.tools ?? []),
        }))
    },
}

function flowExternalIdsOf(tools: AgentTool[]): string[] {
    return tools
        .filter((tool) => tool.type === AgentToolType.FLOW)
        .map((tool) => tool.externalFlowId)
}
