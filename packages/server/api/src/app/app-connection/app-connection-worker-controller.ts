import { ActivepiecesError, assertNotNullOrUndefined, ErrorCode, isNil } from '@activepieces/core-utils'
import { AppConnection, EnginePrincipal, GetAppConnectionForWorkerRequestQuery } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { secretManagersService } from '../ee/secret-managers/secret-managers.service'
import { flowTestScenarioConnectionInterceptor } from '../flows/test-scenario/flow-test-scenario-connection-interceptor'
import { appConnectionService } from './app-connection-service/app-connection-service'

export const appConnectionWorkerController: FastifyPluginAsyncZod = async (app) => {

    app.get('/:externalId', GetAppConnectionRequest, async (request): Promise<AppConnection> => {
        const enginePrincipal = (request.principal as EnginePrincipal)
        assertNotNullOrUndefined(enginePrincipal.projectId, 'projectId')

        // Flow test scenario runs (engine principal id == flow run id) resolve
        // connections through their connection strategy first: mocked values
        // are returned instead of real credentials, and the BLOCK strategy
        // throws so no external side effect can happen through a connection.
        const scenarioOverride = await flowTestScenarioConnectionInterceptor.resolveConnectionOverride({
            flowRunId: enginePrincipal.id,
            externalId: request.params.externalId,
            projectId: enginePrincipal.projectId,
            platformId: enginePrincipal.platform.id,
            log: request.log,
        })
        if (!isNil(scenarioOverride)) {
            return scenarioOverride
        }

        const appConnection = await appConnectionService(request.log).getOne({
            projectId: enginePrincipal.projectId,
            platformId: enginePrincipal.platform.id,
            externalId: request.params.externalId,
        })

        if (isNil(appConnection)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: `externalId=${request.params.externalId}`,
                    entityType: 'AppConnection',
                },
            })
        }

        return {
            ...appConnection,
            value: await secretManagersService(request.log).resolveObject({ value: appConnection.value, projectIds: [enginePrincipal.projectId], platformId: enginePrincipal.platform.id, throwOnFailure: false }),
        }
    },
    )

}

const GetAppConnectionRequest = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        params: GetAppConnectionForWorkerRequestQuery,
    },
}
