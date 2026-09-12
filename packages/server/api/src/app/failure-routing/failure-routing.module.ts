import { FastifyBaseLogger } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { entitiesMustBeOwnedByCurrentProject } from '../authentication/authorization'
import { applicationEvents } from '../helper/application-events'
import { rejectedPromiseHandler } from '../helper/promise-handler'
import { failureRoutingController } from './failure-routing.controller'
import { failureRoutingService } from './failure-routing.service'

export const setupFailureRouting = (log: FastifyBaseLogger): void => {
    applicationEvents(log).registerListeners(log, {
        userEvent: () => async () => {
            // Failure routing only reacts to worker-emitted run lifecycle events.
        },
        workerEvent: (logger: FastifyBaseLogger) => (_projectId: string | undefined, event) => {
            rejectedPromiseHandler(failureRoutingService(logger).handleRunFinished(event), logger)
        },
    })
}

export const failureRoutingModule: FastifyPluginAsyncZod = async (app) => {
    setupFailureRouting(app.log)
    app.addHook('preSerialization', entitiesMustBeOwnedByCurrentProject)
    await app.register(failureRoutingController, { prefix: '/v1/failure-routing/rules' })
}
