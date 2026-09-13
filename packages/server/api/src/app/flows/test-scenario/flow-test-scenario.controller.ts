import { Permission } from '@activepieces/core-utils'
import {
    CreateFlowTestScenarioRequest,
    ListFlowTestScenarioRunsRequest,
    ListFlowTestScenariosRequest,
    PrincipalType,
    UpdateFlowTestScenarioRequest,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../../core/security/authorization/common'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { FlowTestScenarioEntity } from './flow-test-scenario-entity'
import { flowTestScenarioService } from './flow-test-scenario.service'

const DEFAULT_PAGE_SIZE = 10

export const flowTestScenarioController: FastifyPluginAsyncZod = async (app) => {

    app.post('/', CreateFlowTestScenarioRequestOptions, async (request, reply) => {
        const scenario = await flowTestScenarioService(request.log).create({
            projectId: request.projectId,
            request: request.body,
        })
        return reply.status(StatusCodes.CREATED).send(scenario)
    })

    app.get('/', ListFlowTestScenariosRequestOptions, async (request) => {
        return flowTestScenarioService(request.log).list({
            projectId: request.projectId,
            flowId: request.query.flowId,
            cursor: request.query.cursor ?? null,
            limit: request.query.limit ?? DEFAULT_PAGE_SIZE,
        })
    })

    app.get('/:id', GetFlowTestScenarioRequestOptions, async (request) => {
        return flowTestScenarioService(request.log).getOneOrThrow({
            id: request.params.id,
            projectId: request.projectId,
        })
    })

    app.post('/:id', UpdateFlowTestScenarioRequestOptions, async (request) => {
        return flowTestScenarioService(request.log).update({
            id: request.params.id,
            projectId: request.projectId,
            request: request.body,
        })
    })

    app.delete('/:id', DeleteFlowTestScenarioRequestOptions, async (request, reply) => {
        await flowTestScenarioService(request.log).delete({
            id: request.params.id,
            projectId: request.projectId,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.post('/:id/execute', ExecuteFlowTestScenarioRequestOptions, async (request, reply) => {
        const run = await flowTestScenarioService(request.log).execute({
            scenarioId: request.params.id,
            projectId: request.projectId,
            triggeredBy: request.principal.id,
        })
        return reply.status(StatusCodes.OK).send(run)
    })

    app.get('/:id/runs', ListFlowTestScenarioRunsRequestOptions, async (request) => {
        return flowTestScenarioService(request.log).listRuns({
            scenarioId: request.params.id,
            projectId: request.projectId,
            cursor: request.query.cursor ?? null,
            limit: request.query.limit ?? DEFAULT_PAGE_SIZE,
        })
    })

    app.get('/:id/runs/:runId', GetFlowTestScenarioRunRequestOptions, async (request) => {
        return flowTestScenarioService(request.log).getRunOrThrow({
            scenarioId: request.params.id,
            runId: request.params.runId,
            projectId: request.projectId,
        })
    })
}

const scenarioTableResource = {
    type: ProjectResourceType.TABLE,
    tableName: FlowTestScenarioEntity,
} as const

const CreateFlowTestScenarioRequestOptions = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_FLOW, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        body: CreateFlowTestScenarioRequest,
    },
}

const ListFlowTestScenariosRequestOptions = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.READ_FLOW, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        querystring: ListFlowTestScenariosRequest,
    },
}

const GetFlowTestScenarioRequestOptions = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.READ_FLOW, scenarioTableResource),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
    },
}

const UpdateFlowTestScenarioRequestOptions = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_FLOW, scenarioTableResource),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
        body: UpdateFlowTestScenarioRequest,
    },
}

const DeleteFlowTestScenarioRequestOptions = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_FLOW, scenarioTableResource),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
    },
}

const ExecuteFlowTestScenarioRequestOptions = {
    config: {
        // Membership-only by design, mirroring the websocket test-run route:
        // a scenario run executes in the isolated TESTING environment.
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], undefined, scenarioTableResource),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
    },
}

const ListFlowTestScenarioRunsRequestOptions = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.READ_FLOW, scenarioTableResource),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
        querystring: ListFlowTestScenarioRunsRequest,
    },
}

const GetFlowTestScenarioRunRequestOptions = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.READ_FLOW, scenarioTableResource),
    },
    schema: {
        params: z.object({
            id: z.string(),
            runId: z.string(),
        }),
    },
}
