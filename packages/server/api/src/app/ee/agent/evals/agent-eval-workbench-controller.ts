import { ApId, Permission } from '@activepieces/core-utils'
import {
    AgentEvalCase,
    AgentEvalCaseResult,
    AgentEvalRun,
    AgentEvalSuite,
    CreateAgentEvalRunRequest,
    CreateAgentEvalSuiteRequest,
    ListAgentEvalCaseResultsRequest,
    PrincipalType,
    UpdateAgentEvalSuiteRequest,
    UpsertAgentEvalCaseRequest,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../../../core/security/authorization/common'
import { securityAccess } from '../../../core/security/authorization/fastify-security'
import { securityHelper } from '../../../helper/security-helper'
import { agentEvalRunService } from './agent-eval-run-service'
import { agentEvalSuiteService } from './agent-eval-suite-service'

export const agentEvalWorkbenchController: FastifyPluginAsyncZod = async (app) => {
    app.post('/suites', CreateSuiteRoute, async (request, reply) => {
        const suite = await agentEvalSuiteService(request.log).create({
            projectId: request.params.projectId,
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            request: request.body,
        })
        return reply.status(StatusCodes.CREATED).send(suite)
    })

    app.get('/suites', ListSuitesRoute, async (request): Promise<AgentEvalSuite[]> => {
        return agentEvalSuiteService(request.log).list({
            projectId: request.params.projectId,
            agentId: request.query.agentId,
        })
    })

    app.get('/suites/:suiteId', GetSuiteRoute, async (request): Promise<AgentEvalSuite> => {
        return agentEvalSuiteService(request.log).getOneOrThrow({
            id: request.params.suiteId,
            projectId: request.params.projectId,
        })
    })

    app.post('/suites/:suiteId', UpdateSuiteRoute, async (request): Promise<AgentEvalSuite> => {
        return agentEvalSuiteService(request.log).update({
            id: request.params.suiteId,
            projectId: request.params.projectId,
            request: request.body,
        })
    })

    app.delete('/suites/:suiteId', DeleteSuiteRoute, async (request, reply) => {
        await agentEvalSuiteService(request.log).delete({
            id: request.params.suiteId,
            projectId: request.params.projectId,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.get('/suites/:suiteId/cases', ListCasesRoute, async (request): Promise<AgentEvalCase[]> => {
        return agentEvalSuiteService(request.log).listCases({
            suiteId: request.params.suiteId,
            projectId: request.params.projectId,
        })
    })

    app.post('/suites/:suiteId/cases', AddCaseRoute, async (request, reply) => {
        const evalCase = await agentEvalSuiteService(request.log).addCase({
            suiteId: request.params.suiteId,
            projectId: request.params.projectId,
            request: request.body,
        })
        return reply.status(StatusCodes.CREATED).send(evalCase)
    })

    app.post('/suites/:suiteId/cases/:caseId', UpdateCaseRoute, async (request): Promise<AgentEvalCase> => {
        return agentEvalSuiteService(request.log).updateCase({
            suiteId: request.params.suiteId,
            projectId: request.params.projectId,
            caseId: request.params.caseId,
            request: request.body,
        })
    })

    app.delete('/suites/:suiteId/cases/:caseId', DeleteCaseRoute, async (request, reply) => {
        await agentEvalSuiteService(request.log).deleteCase({
            suiteId: request.params.suiteId,
            projectId: request.params.projectId,
            caseId: request.params.caseId,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.post('/runs', CreateRunRoute, async (request, reply) => {
        const userId = await securityHelper.getUserIdFromRequest(request)
        const run = await agentEvalRunService(request.log).start({
            projectId: request.params.projectId,
            platformId: request.principal.platform.id,
            userId: userId ?? request.principal.id,
            request: request.body,
        })
        return reply.status(StatusCodes.CREATED).send(run)
    })

    app.get('/runs', ListRunsRoute, async (request): Promise<AgentEvalRun[]> => {
        return agentEvalRunService(request.log).list({
            projectId: request.params.projectId,
            suiteId: request.query.suiteId,
        })
    })

    app.get('/runs/:runId', GetRunRoute, async (request): Promise<AgentEvalRun> => {
        return agentEvalRunService(request.log).getOneOrThrow({
            id: request.params.runId,
            projectId: request.params.projectId,
        })
    })

    app.get('/runs/:runId/results', ListResultsRoute, async (request): Promise<AgentEvalCaseResult[]> => {
        return agentEvalRunService(request.log).listResults({
            runId: request.params.runId,
            projectId: request.params.projectId,
            request: request.query,
        })
    })
}

const ProjectParams = z.object({
    projectId: ApId,
})

const SuiteParams = z.object({
    projectId: ApId,
    suiteId: ApId,
})

const CaseParamsSchema = z.object({
    projectId: ApId,
    suiteId: ApId,
    caseId: ApId,
})

const RunParams = z.object({
    projectId: ApId,
    runId: ApId,
})

const readSecurity = securityAccess.project(
    [PrincipalType.USER, PrincipalType.SERVICE],
    Permission.READ_AGENT,
    { type: ProjectResourceType.PARAM },
)

const writeSecurity = securityAccess.project(
    [PrincipalType.USER, PrincipalType.SERVICE],
    Permission.WRITE_AGENT,
    { type: ProjectResourceType.PARAM },
)

const CreateSuiteRoute = {
    config: { security: writeSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Create an eval suite: a named set of test cases bound to one agent',
        params: ProjectParams,
        body: CreateAgentEvalSuiteRequest,
        response: { [StatusCodes.CREATED]: AgentEvalSuite },
    },
}

const ListSuitesRoute = {
    config: { security: readSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'List eval suites in a project, optionally narrowed to one agent',
        params: ProjectParams,
        querystring: z.object({ agentId: z.optional(ApId) }),
        response: { [StatusCodes.OK]: z.array(AgentEvalSuite) },
    },
}

const GetSuiteRoute = {
    config: { security: readSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Get an eval suite',
        params: SuiteParams,
        response: { [StatusCodes.OK]: AgentEvalSuite },
    },
}

const UpdateSuiteRoute = {
    config: { security: writeSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Update an eval suite (name, description, declared variables)',
        params: SuiteParams,
        body: UpdateAgentEvalSuiteRequest,
        response: { [StatusCodes.OK]: AgentEvalSuite },
    },
}

const DeleteSuiteRoute = {
    config: { security: writeSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Delete an eval suite together with its cases and run history',
        params: SuiteParams,
    },
}

const ListCasesRoute = {
    config: { security: readSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'List the test cases of a suite',
        params: SuiteParams,
        response: { [StatusCodes.OK]: z.array(AgentEvalCase) },
    },
}

const AddCaseRoute = {
    config: { security: writeSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Add a test case. The message may reference suite variables as {{name}}.',
        params: SuiteParams,
        body: UpsertAgentEvalCaseRequest,
        response: { [StatusCodes.CREATED]: AgentEvalCase },
    },
}

const UpdateCaseRoute = {
    config: { security: writeSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Replace a test case',
        params: CaseParamsSchema,
        body: UpsertAgentEvalCaseRequest,
        response: { [StatusCodes.OK]: AgentEvalCase },
    },
}

const DeleteCaseRoute = {
    config: { security: writeSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Delete a test case',
        params: CaseParamsSchema,
    },
}

const CreateRunRoute = {
    config: { security: writeSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Start a batch run of a suite against one agent version and model. Runs in the background with the requested concurrency and credit budget; poll the run for progress.',
        params: ProjectParams,
        body: CreateAgentEvalRunRequest,
        response: { [StatusCodes.CREATED]: AgentEvalRun },
    },
}

const ListRunsRoute = {
    config: { security: readSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'List eval runs in a project, optionally narrowed to one suite',
        params: ProjectParams,
        querystring: z.object({ suiteId: z.optional(ApId) }),
        response: { [StatusCodes.OK]: z.array(AgentEvalRun) },
    },
}

const GetRunRoute = {
    config: { security: readSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'Get an eval run with its live totals',
        params: RunParams,
        response: { [StatusCodes.OK]: AgentEvalRun },
    },
}

const ListResultsRoute = {
    config: { security: readSecurity },
    schema: {
        tags: ['agent-evals'],
        description: 'List per-case results of a run, sortable by status (success/failure/needs approval), cost, duration or name',
        params: RunParams,
        querystring: ListAgentEvalCaseResultsRequest,
        response: { [StatusCodes.OK]: z.array(AgentEvalCaseResult) },
    },
}
