import { Permission, PrincipalType, UpsertApprovalSlaPolicyRequestBody } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { ProjectResourceType } from '../../../core/security/authorization/common'
import { securityAccess } from '../../../core/security/authorization/fastify-security'
import { approvalSlaPolicyService } from './approval-sla-policy.service'

export const approvalSlaPolicyController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', GetPolicyRequest, async (req) => {
        return approvalSlaPolicyService(req.log).getForProject({ projectId: req.projectId })
    })

    app.post('/', UpsertPolicyRequest, async (req) => {
        return approvalSlaPolicyService(req.log).upsert({
            projectId: req.projectId,
            platformId: req.principal.platform.id,
            request: req.body,
        })
    })

    app.delete('/', DeletePolicyRequest, async (req, reply) => {
        await approvalSlaPolicyService(req.log).delete({ projectId: req.projectId })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const GetPolicyRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER], Permission.READ_PROJECT, {
            type: ProjectResourceType.QUERY,
        }),
    },
}

const UpsertPolicyRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER], Permission.WRITE_PROJECT, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        body: UpsertApprovalSlaPolicyRequestBody,
    },
}

const DeletePolicyRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER], Permission.WRITE_PROJECT, {
            type: ProjectResourceType.QUERY,
        }),
    },
}
