import { Permission, PrincipalType } from '@activepieces/core-utils'
import { FormAnalyticsResponse, ListFormAnalyticsRequestQuery, SERVICE_KEY_SECURITY_OPENAPI } from '@activepieces/shared'
import { StatusCodes } from 'http-status-codes'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ProjectResourceType } from '../../core/security/authorization/common'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { formAnalyticsService } from './form-analytics.service'

export const formAnalyticsProjectController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListAnalyticsRoute, async (request) => {
        return formAnalyticsService(request.log).getFunnel({
            projectId: request.query.projectId,
            flowId: request.query.flowId,
            flowVersionId: request.query.flowVersionId,
            createdAfter: request.query.createdAfter,
            createdBefore: request.query.createdBefore,
            attribution: request.query.attribution,
        })
    })
}

const ListAnalyticsRoute = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_RUN,
            { type: ProjectResourceType.QUERY },
        ),
    },
    schema: {
        tags: ['form-analytics'],
        description: 'List form submission analytics funnel',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: ListFormAnalyticsRequestQuery,
        response: {
            [StatusCodes.OK]: FormAnalyticsResponse,
        },
    },
}
