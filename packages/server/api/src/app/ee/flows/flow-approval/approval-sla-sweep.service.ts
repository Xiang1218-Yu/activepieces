import { ApplicationEventName, ApprovalSlaBreachReason, ApprovalSlaPolicy, ApprovalSlaRule, FlowApprovalRequest, isNil, tryCatch, UserStatus } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { userIdentityService } from '../../../authentication/user-identity/user-identity-service'
import { flowVersionService } from '../../../flows/flow-version/flow-version.service'
import { applicationEvents } from '../../../helper/application-events'
import { domainHelper } from '../../../helper/domain-helper'
import { rejectedPromiseHandler } from '../../../helper/promise-handler'
import { projectService } from '../../../project/project-service'
import { userService } from '../../../user/user-service'
import { emailService } from '../../helper/email/email-service'
import { approvalSlaPolicyService } from './approval-sla-policy.service'
import { approvalSlaTime } from './approval-sla-time'
import { flowApprovalRequestService } from './flow-approval-request.service'

const SWEEP_BATCH_SIZE = 200

export const approvalSlaSweepService = (log: FastifyBaseLogger) => ({
    async run(): Promise<{ escalated: number, breached: number }> {
        const nowIso = new Date().toISOString()
        const due = await flowApprovalRequestService(log).listDueForSlaCheck({ nowIso, batchSize: SWEEP_BATCH_SIZE })
        let escalated = 0
        let breached = 0
        for (const approval of due) {
            const policy = await approvalSlaPolicyService(log).getForProject({ projectId: approval.projectId })
            if (isNil(policy)) {
                continue
            }
            const rule = approvalSlaTime.resolveRule(policy, approval.priority)
            if (isNil(rule)) {
                continue
            }

            const escalateOutcome = await escalateIfDue({ approval, policy, rule, nowIso, log })
            if (escalateOutcome === 'MARKED') {
                escalated += 1
            }

            const breachOutcome = await markBreachIfDue({ approval, policy, rule, nowIso, log })
            if (breachOutcome === 'MARKED') {
                breached += 1
            }
        }
        return { escalated, breached }
    },
})

async function escalateIfDue({
    approval,
    policy,
    rule,
    nowIso,
    log,
}: {
    approval: FlowApprovalRequest
    policy: ApprovalSlaPolicy
    rule: ApprovalSlaRule
    nowIso: string
    log: FastifyBaseLogger
}): Promise<'SKIPPED' | 'MARKED'> {
    if (approval.escalatedAt !== null) {
        return 'SKIPPED'
    }
    const escalationInstant = approvalSlaTime.computeEscalationInstant({
        submittedAtIso: approval.submittedAt,
        rule,
        timezoneName: policy.timezone,
    })
    if (escalationInstant === null || nowIso < escalationInstant) {
        return 'SKIPPED'
    }
    const marked = await flowApprovalRequestService(log).markEscalated({
        requestId: approval.id,
        projectId: approval.projectId,
        escalatedAt: nowIso,
    })
    if (!marked) {
        return 'SKIPPED'
    }
    rejectedPromiseHandler(sendEscalationNotification({ approval, policy, rule, nowIso, log }), log)
    return 'MARKED'
}

async function markBreachIfDue({
    approval,
    policy,
    rule,
    nowIso,
    log,
}: {
    approval: FlowApprovalRequest
    policy: ApprovalSlaPolicy
    rule: ApprovalSlaRule
    nowIso: string
    log: FastifyBaseLogger
}): Promise<'SKIPPED' | 'MARKED'> {
    if (approval.slaBreachReason !== null || isNil(approval.slaDeadlineAt) || nowIso <= approval.slaDeadlineAt) {
        return 'SKIPPED'
    }
    const escalationInstant = approvalSlaTime.computeEscalationInstant({
        submittedAtIso: approval.submittedAt,
        rule,
        timezoneName: policy.timezone,
    })
    const reason = approval.escalatedAt !== null || (escalationInstant !== null && nowIso >= escalationInstant)
        ? ApprovalSlaBreachReason.ESCALATION_LIMIT
        : ApprovalSlaBreachReason.PENDING_LIMIT
    const marked = await flowApprovalRequestService(log).markBreached({
        requestId: approval.id,
        projectId: approval.projectId,
        reason,
    })
    return marked ? 'MARKED' : 'SKIPPED'
}

async function sendEscalationNotification({
    approval,
    policy,
    rule,
    nowIso,
    log,
}: {
    approval: FlowApprovalRequest
    policy: ApprovalSlaPolicy
    rule: ApprovalSlaRule
    nowIso: string
    log: FastifyBaseLogger
}): Promise<void> {
    const flowVersion = await flowVersionService(log).getOneOrThrow(approval.flowVersionId)
    const project = await projectService(log).getOneOrThrow(approval.projectId)
    const emails = await resolveEscalationEmails({ targetUserIds: rule.escalationTargetUserIds, log })
    const reviewUrl = await domainHelper.getInternalUrl({
        path: `projects/${approval.projectId}/flows/${approval.flowId}?versionId=${approval.flowVersionId}`,
    })
    const deadlineLabel = approvalSlaTime.formatInTimeZone({ iso: approval.slaDeadlineAt ?? nowIso, timezoneName: policy.timezone })
    const isOverdue = !isNil(approval.slaDeadlineAt) && nowIso > approval.slaDeadlineAt
    const reason = isOverdue
        ? 'The approval is past its SLA deadline without a decision and has been escalated.'
        : 'The approval passed its escalation threshold without a decision.'

    await emailService(log).sendApprovalSlaEscalation({
        platformId: approval.platformId,
        to: emails,
        projectName: project.displayName,
        flowName: flowVersion.displayName,
        priority: approval.priority,
        deadlineAt: deadlineLabel,
        overdue: isOverdue ? 'overdue' : 'due soon',
        reason,
        reviewUrl,
    })

    applicationEvents(log).sendUserEvent({
        platformId: approval.platformId,
        projectId: approval.projectId,
        userId: null,
    }, {
        action: ApplicationEventName.FLOW_APPROVAL_SLA_ESCALATED,
        data: {
            approvalRequestId: approval.id,
            flowId: approval.flowId,
            flowVersionId: approval.flowVersionId,
            flowDisplayName: flowVersion.displayName,
            breachReason: null,
            escalationTargetUserIds: rule.escalationTargetUserIds,
        },
    })
}

async function resolveEscalationEmails({ targetUserIds, log }: { targetUserIds: string[], log: FastifyBaseLogger }): Promise<string[]> {
    const emails: string[] = []
    for (const targetUserId of targetUserIds) {
        const user = await userService(log).get({ id: targetUserId })
        if (isNil(user) || user.status !== UserStatus.ACTIVE) {
            continue
        }
        const { data: identity, error } = await tryCatch(() => userIdentityService(log).getOneOrFail({ id: user.identityId }))
        if (error || isNil(identity)) {
            continue
        }
        emails.push(identity.email)
    }
    return [...new Set(emails.map((email) => email.toLowerCase()))]
}
