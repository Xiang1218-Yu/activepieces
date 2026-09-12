import { FastifyPluginAsync } from 'fastify'
import { webhookRequestInspectorController } from './webhook-request-inspector.controller'

export const webhookRequestInspectorModule: FastifyPluginAsync = async (app) => {
    await app.register(webhookRequestInspectorController, { prefix: '/v1/webhook-requests' })
}
