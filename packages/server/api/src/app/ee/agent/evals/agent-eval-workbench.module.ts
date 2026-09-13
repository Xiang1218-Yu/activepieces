import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { platformMustHaveFeatureEnabled } from '../../authentication/ee-authorization'
import { agentEvalWorkbenchController } from './agent-eval-workbench-controller'

export const agentEvalWorkbenchModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(async (evalSurface) => {
        evalSurface.addHook('preHandler', platformMustHaveFeatureEnabled((platform) => platform.plan.agentsEnabled))
        await evalSurface.register(agentEvalWorkbenchController, { prefix: '/v1/projects/:projectId/agent-eval' })
    })
}
