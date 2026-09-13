import { ApId, ListFlowApprovalRequestsQuery, Permission, PopulatedFlowApprovalRequest, PrincipalType, RejectFlowApprovalRequestBody, SeekPage } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../../../core/security/authorization/common'
import { securityAccess } from '../../../core/security/authorization/fastify-security'
import { FlowApprovalRequestEntity } from './flow-approval-request.entity'
import { flowApprovalRequestService } from './flow-approval-request.service'

export const flowApprovalRequestController: FastifyPluginAsyncZod = async (app) => {

    app.get('/', ListRequest, async (req) => {
        const viewerId = req.principal.type === PrincipalType.USER ? req.principal.id : undefined
        return flowApprovalRequestService(req.log).list({
            projectId: req.projectId,
            state: req.query.state,
            flowVersionId: req.query.flowVersionId,
            cursor: req.query.cursor,
            limit: req.query.limit,
            viewerId,
            mine: req.query.mine,
            overdue: req.query.overdue,
        })
    })

    app.get('/:id', GetRequest, async (req) => {
        const viewerId = req.principal.type === PrincipalType.USER ? req.principal.id : undefined
        return flowApprovalRequestService(req.log).getPopulatedOrThrow({
            requestId: req.params.id,
            projectId: req.projectId,
            viewerId,
        })
    })

    app.post('/:id/approve', ApproveRequest, async (req, reply) => {
        const updated = await flowApprovalRequestService(req.log).approve({
            requestId: req.params.id,
            projectId: req.projectId,
            approverPrincipal: req.principal,
            request: req,
        })
        return reply.status(StatusCodes.OK).send(updated)
    })

    app.post('/:id/reject', RejectRequest, async (req, reply) => {
        const updated = await flowApprovalRequestService(req.log).reject({
            requestId: req.params.id,
            projectId: req.projectId,
            approverPrincipal: req.principal,
            reason: req.body.reason,
            request: req,
        })
        return reply.status(StatusCodes.OK).send(updated)
    })

    app.post('/:id/pause', PauseRequest, async (req, reply) => {
        const updated = await flowApprovalRequestService(req.log).pause({
            requestId: req.params.id,
            projectId: req.projectId,
        })
        return reply.status(StatusCodes.OK).send(updated)
    })

    app.post('/:id/resume', ResumeRequest, async (req, reply) => {
        const updated = await flowApprovalRequestService(req.log).resume({
            requestId: req.params.id,
            projectId: req.projectId,
        })
        return reply.status(StatusCodes.OK).send(updated)
    })

    app.post('/:id/withdraw', WithdrawRequest, async (req, reply) => {
        await flowApprovalRequestService(req.log).withdraw({
            requestId: req.params.id,
            projectId: req.projectId,
            request: req,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const ListRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER], Permission.READ_FLOW, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        querystring: ListFlowApprovalRequestsQuery,
        response: {
            [StatusCodes.OK]: SeekPage(PopulatedFlowApprovalRequest),
        },
    },
}

const GetRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.READ_FLOW, {
            type: ProjectResourceType.TABLE,
            tableName: FlowApprovalRequestEntity,
        }),
    },
    schema: {
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.OK]: PopulatedFlowApprovalRequest,
        },
    },
}

const ApproveRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.PUBLISH_SENSITIVE_FLOW_ACCESS, {
            type: ProjectResourceType.TABLE,
            tableName: FlowApprovalRequestEntity,
        }),
    },
    schema: {
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.OK]: PopulatedFlowApprovalRequest,
        },
    },
}

const RejectRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.PUBLISH_SENSITIVE_FLOW_ACCESS, {
            type: ProjectResourceType.TABLE,
            tableName: FlowApprovalRequestEntity,
        }),
    },
    schema: {
        params: z.object({ id: ApId }),
        body: RejectFlowApprovalRequestBody,
        response: {
            [StatusCodes.OK]: PopulatedFlowApprovalRequest,
        },
    },
}

const PauseRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER], Permission.PUBLISH_SENSITIVE_FLOW_ACCESS, {
            type: ProjectResourceType.TABLE,
            tableName: FlowApprovalRequestEntity,
        }),
    },
    schema: {
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.OK]: PopulatedFlowApprovalRequest,
        },
    },
}

const ResumeRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER], Permission.PUBLISH_SENSITIVE_FLOW_ACCESS, {
            type: ProjectResourceType.TABLE,
            tableName: FlowApprovalRequestEntity,
        }),
    },
    schema: {
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.OK]: PopulatedFlowApprovalRequest,
        },
    },
}

const WithdrawRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_FLOW, {
            type: ProjectResourceType.TABLE,
            tableName: FlowApprovalRequestEntity,
        }),
    },
    schema: {
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}
