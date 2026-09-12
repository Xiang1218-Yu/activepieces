import { ActivepiecesError, ApId, ErrorCode, isNil, Permission, SeekPage } from '@activepieces/core-utils'
import {
    CreateFailureRoutingRuleRequestBody,
    FailureDelivery,
    FailureRoutingRule,
    ListFailureDeliveriesRequest,
    ListFailureRoutingRulesRequest,
    PrincipalType,
    UpdateFailureRoutingRuleRequestBody,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { failureRoutingService } from './failure-routing.service'

export const failureRoutingController: FastifyPluginAsyncZod = async (app) => {
    app.post('/', CreateFailureRoutingRuleRequest, async (req) => {
        return failureRoutingService(req.log).createRule({
            projectId: req.body.projectId,
            platformId: req.principal.platform.id,
            request: req.body,
        })
    })

    app.patch('/:id', UpdateFailureRoutingRuleRequest, async (req) => {
        const rule = await failureRoutingService(req.log).updateRule({
            id: req.params.id,
            projectId: req.projectId!,
            request: req.body,
        })
        if (isNil(rule)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    message: `Failure routing rule ${req.params.id} not found`,
                },
            })
        }
        return rule
    })

    app.get('/', ListFailureRoutingRulesRoute, async (req) => {
        return failureRoutingService(req.log).listRules({
            projectId: req.query.projectId,
            cursorRequest: req.query.cursor ?? null,
            limit: req.query.limit ?? 20,
        })
    })

    app.delete('/:id', DeleteFailureRoutingRuleRequest, async (req) => {
        await failureRoutingService(req.log).deleteRule({
            id: req.params.id,
            projectId: req.projectId!,
        })
        return {}
    })

    app.get('/deliveries', ListFailureDeliveriesRoute, async (req) => {
        return failureRoutingService(req.log).listDeliveries({
            ...req.query,
            limit: req.query.limit ?? 20,
        })
    })
}

const ProjectIdQuery = z.object({ projectId: z.string() })

const CreateFailureRoutingRuleRequest = {
    schema: {
        body: CreateFailureRoutingRuleRequestBody,
        response: {
            [StatusCodes.OK]: FailureRoutingRule,
        },
    },
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.WRITE_ALERT,
            { type: ProjectResourceType.BODY },
        ),
    },
}

const UpdateFailureRoutingRuleRequest = {
    schema: {
        body: UpdateFailureRoutingRuleRequestBody,
        params: z.object({ id: ApId }),
        querystring: ProjectIdQuery,
        response: {
            [StatusCodes.OK]: FailureRoutingRule,
        },
    },
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.WRITE_ALERT,
            { type: ProjectResourceType.QUERY },
        ),
    },
}

const ListFailureRoutingRulesRoute = {
    schema: {
        querystring: ListFailureRoutingRulesRequest,
        response: {
            [StatusCodes.OK]: SeekPage(FailureRoutingRule),
        },
        tags: ['failure-routing'],
        description: 'List failure routing rules ordered by priority',
    },
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_ALERT,
            { type: ProjectResourceType.QUERY },
        ),
    },
}

const DeleteFailureRoutingRuleRequest = {
    schema: {
        params: z.object({ id: ApId }),
        querystring: ProjectIdQuery,
    },
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.WRITE_ALERT,
            { type: ProjectResourceType.QUERY },
        ),
    },
}

const ListFailureDeliveriesRoute = {
    schema: {
        querystring: ListFailureDeliveriesRequest,
        response: {
            [StatusCodes.OK]: SeekPage(FailureDelivery),
        },
        tags: ['failure-routing'],
        description: 'Query failure notification delivery statuses',
    },
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_ALERT,
            { type: ProjectResourceType.QUERY },
        ),
    },
}
