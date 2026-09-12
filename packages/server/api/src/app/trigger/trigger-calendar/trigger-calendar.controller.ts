import { GetTriggerCalendarRequest, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI, TriggerCalendarResponse } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { ProjectResourceType } from '../../core/security/authorization/common'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { triggerCalendarService } from './trigger-calendar-service'

export const triggerCalendarController: FastifyPluginAsyncZod = async (app) => {
    app.get('/calendar', GetTriggerCalendarOptions, async (request) => {
        return triggerCalendarService(request.log).getCalendar({
            projectId: request.projectId,
            principal: request.principal,
            request: request.query,
        })
    })
}

// Project membership is required, but READ_FLOW is intentionally enforced inside the
// service: members without READ_FLOW still receive the restrictedCount summary.
const GetTriggerCalendarOptions = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            undefined, {
                type: ProjectResourceType.QUERY,
            }),
    },
    schema: {
        tags: ['flows'],
        description: 'Get the project trigger calendar with upcoming schedule trigger occurrences',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: GetTriggerCalendarRequest,
        response: {
            [StatusCodes.OK]: TriggerCalendarResponse,
        },
    },
}
