import { FastifyBaseLogger } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ApplicationEvent, ApplicationEventName } from '@activepieces/shared'
import { entitiesMustBeOwnedByCurrentProject } from '../authentication/authorization'
import { applicationEvents } from '../helper/application-events'
import { rejectedPromiseHandler } from '../helper/promise-handler'
import { failureRoutingController } from './failure-routing.controller'
import { failureRoutingService } from './failure-routing.service'

const setupFailureRouting = (log: FastifyBaseLogger): void => {
    applicationEvents(log).registerListeners(log, {
        userEvent: () => async () => {
            // Failure routing only reacts to worker-emitted run lifecycle events.
        },
        workerEvent: (logger: FastifyBaseLogger) => (_projectId: string | undefined, event: ApplicationEvent) => {
            if (event.action !== ApplicationEventName.FLOW_RUN_FINISHED) {
                return
            }
            // Deliberately not awaited: notification routing must never block
            // the run-finish pipeline; the service itself swallows errors and
            // records outcomes in the failure_delivery table.
            rejectedPromiseHandler(failureRoutingService(logger).handleRunFinished(event), logger)
        },
    })
}

export const failureRoutingModule: FastifyPluginAsyncZod = async (app) => {
    setupFailureRouting(app.log)
    app.addHook('preSerialization', entitiesMustBeOwnedByCurrentProject)
    await app.register(failureRoutingController, { prefix: '/v1/failure-routing/rules' })
}
