import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { dependencyGraphController } from './dependency-graph.controller'

export const dependencyGraphModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(dependencyGraphController, { prefix: '/v1/dependency-graph' })
}
