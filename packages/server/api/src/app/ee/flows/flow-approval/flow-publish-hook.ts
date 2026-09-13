import { ApprovalSlaPauseReason, FlowStatus, Permission, tryCatch } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { CancelApprovalsForDeletedFlowParams, PublishHooks, RoutePublishParams, SubmitForApprovalParams, SyncApprovalSlaParams } from '../../../flows/flow/flow-publish-hooks'
import { platformService } from '../../../platform/platform.service'
import { projectService } from '../../../project/project-service'
import { getPrincipalRoleOrThrow } from '../../authentication/project-role/rbac-middleware'
import { flowApprovalRequestService } from './flow-approval-request.service'

export const eeFlowPublishHook = (log: FastifyBaseLogger): PublishHooks => ({
    async routePublish({ projectId, platformId, userId }: RoutePublishParams) {
        const platform = await platformService(log).getOneWithPlanOrThrow(platformId)
        if (!platform.plan.environmentsEnabled) {
            return 'PUBLISH_NOW'
        }
        const project = await projectService(log).getOneOrThrow(projectId)
        if (!project.sensitive) {
            return 'PUBLISH_NOW'
        }
        if (!userId) {
            return 'PUBLISH_NOW'
        }
        const hasOverride = await userHasPublishSensitivePermission({ userId, projectId, log })
        return hasOverride ? 'PUBLISH_NOW' : 'NEEDS_APPROVAL'
    },
    async submitForApproval({ flow, userId, projectId, platformId, requestedStatus, priority }: SubmitForApprovalParams) {
        await flowApprovalRequestService(log).submitForApproval({ flow, userId, projectId, platformId, requestedStatus, priority })
    },
    async syncApprovalSlaWithFlowStatus({ flowId, projectId, newStatus }: SyncApprovalSlaParams) {
        if (newStatus === FlowStatus.DISABLED) {
            await flowApprovalRequestService(log).pausePendingForFlow({
                flowId,
                projectId,
                reason: ApprovalSlaPauseReason.FLOW_DISABLED,
            })
            return
        }
        if (newStatus === FlowStatus.ENABLED) {
            await flowApprovalRequestService(log).resumePendingForFlow({
                flowId,
                projectId,
                reason: ApprovalSlaPauseReason.FLOW_DISABLED,
            })
        }
    },
    async cancelApprovalsForDeletedFlow({ flowId, projectId }: CancelApprovalsForDeletedFlowParams) {
        await flowApprovalRequestService(log).cancelPendingForDeletedFlow({ flowId, projectId })
    },
})

const userHasPublishSensitivePermission = async ({ userId, projectId, log }: { userId: string, projectId: string, log: FastifyBaseLogger }): Promise<boolean> => {
    const { data: role } = await tryCatch(() => getPrincipalRoleOrThrow(userId, projectId, log))
    return role?.permissions?.includes(Permission.PUBLISH_SENSITIVE_FLOW_ACCESS) ?? false
}
