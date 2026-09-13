import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { entitiesMustBeOwnedByCurrentProject } from '../../authentication/authorization'
import { flowTestScenarioController } from './flow-test-scenario.controller'

export const flowTestScenarioModule: FastifyPluginAsyncZod = async (app) => {
    app.addHook('preSerialization', entitiesMustBeOwnedByCurrentProject)
    await app.register(flowTestScenarioController, { prefix: '/v1/flow-test-scenarios' })
}
