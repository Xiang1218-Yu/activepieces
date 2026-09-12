import { Permission } from '@activepieces/core-utils'
import { GetProjectDependencyGraphRequest, PrincipalType, ProjectDependencyGraph, SERVICE_KEY_SECURITY_OPENAPI } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { dependencyGraphService } from './dependency-graph.service'

export const dependencyGraphController: FastifyPluginAsyncZod = async (fastify) => {
    fastify.get('/', GetProjectDependencyGraphRequestOptions, async (request) => {
        return dependencyGraphService(request.log).getProjectGraph({
            projectId: request.projectId,
        })
    })
}

const GetProjectDependencyGraphRequestOptions = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_FLOW,
            {
                type: ProjectResourceType.QUERY,
            },
        ),
    },
    schema: {
        tags: ['dependency-graph'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Build the dependency graph of a project from flow versions, piece configurations, subflow references, table triggers, connection references and agent tools. Only objects visible to the requested project are included.',
        querystring: GetProjectDependencyGraphRequest,
        response: {
            [StatusCodes.OK]: ProjectDependencyGraph,
        },
    },
}
