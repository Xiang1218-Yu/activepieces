import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { formAnalyticsController } from './form-analytics-public.controller'
import { formAnalyticsProjectController } from './form-analytics-project.controller'

export const formAnalyticsModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(formAnalyticsController, { prefix: '/v1/form-analytics' })
    await app.register(formAnalyticsProjectController, { prefix: '/v1/form-analytics' })
}
