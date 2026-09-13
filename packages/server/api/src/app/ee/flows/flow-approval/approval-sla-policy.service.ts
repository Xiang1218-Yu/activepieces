import { ActivepiecesError, apId, ApprovalSlaPolicy, ErrorCode, FlowApprovalPriority, isNil, PlatformId, ProjectId, unique, UpsertApprovalSlaPolicyRequestBody, UserId } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../../core/db/repo-factory'
import { projectMemberService } from '../../projects/project-members/project-member.service'
import { ApprovalSlaPolicyEntity } from './approval-sla-policy.entity'
import { approvalSlaTime } from './approval-sla-time'

const repo = repoFactory(ApprovalSlaPolicyEntity)

const PRIORITIES: FlowApprovalPriority[] = [
    FlowApprovalPriority.LOW,
    FlowApprovalPriority.NORMAL,
    FlowApprovalPriority.HIGH,
    FlowApprovalPriority.URGENT,
]

export const approvalSlaPolicyService = (log: FastifyBaseLogger) => ({
    async getForProject({ projectId }: { projectId: ProjectId }): Promise<ApprovalSlaPolicy | null> {
        return repo().findOneBy({ projectId })
    },

    async upsert({
        projectId,
        platformId,
        request,
    }: {
        projectId: ProjectId
        platformId: PlatformId
        request: UpsertApprovalSlaPolicyRequestBody
    }): Promise<ApprovalSlaPolicy> {
        approvalSlaTime.validateTimeZoneOrThrow(request.timezone)
        await assertRulesAreOrdered(request)
        await assertEscalationTargetsAreMembers({ log, projectId, request })

        const existing = await repo().findOneBy({ projectId })
        if (isNil(existing)) {
            const policy: ApprovalSlaPolicy = {
                id: apId(),
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                projectId,
                platformId,
                timezone: request.timezone,
                rules: normalizeRules(request),
            }
            await repo().insert(policy)
            return policy
        }
        const updated: ApprovalSlaPolicy = {
            ...existing,
            timezone: request.timezone,
            rules: normalizeRules(request),
            updated: new Date().toISOString(),
        }
        await repo().save(updated)
        return updated
    },

    async delete({ projectId }: { projectId: ProjectId }): Promise<void> {
        await repo().delete({ projectId })
    },
})

async function assertRulesAreOrdered(request: UpsertApprovalSlaPolicyRequestBody): Promise<void> {
    for (const priority of PRIORITIES) {
        const rule = request.rules[priority]
        if (isNil(rule)) {
            continue
        }
        if (rule.escalationMinutes !== undefined && rule.escalationMinutes > 0 && rule.escalationMinutes <= rule.timeoutMinutes) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'Escalation must be scheduled after the SLA timeout' },
            })
        }
    }
}

async function assertEscalationTargetsAreMembers({
    log,
    projectId,
    request,
}: {
    log: FastifyBaseLogger
    projectId: ProjectId
    request: UpsertApprovalSlaPolicyRequestBody
}): Promise<void> {
    const targetIds = unique(
        Object.values(request.rules).flatMap((rule) => rule.escalationTargetUserIds),
    )
    if (targetIds.length === 0) {
        return
    }
    const memberIds = await projectMemberService(log).listProjectMemberUserIds({ projectId })
    const memberSet = new Set<UserId>(memberIds)
    const unknown = targetIds.filter((id) => !memberSet.has(id))
    if (unknown.length > 0) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'Escalation targets must be members of the project' },
        })
    }
}

function normalizeRules(request: UpsertApprovalSlaPolicyRequestBody): ApprovalSlaPolicy['rules'] {
    const entries = PRIORITIES
        .filter((priority) => !isNil(request.rules[priority]))
        .map((priority) => [
            priority,
            {
                timeoutMinutes: request.rules[priority].timeoutMinutes,
                ...(request.rules[priority].escalationMinutes === undefined
                    ? {}
                    : { escalationMinutes: request.rules[priority].escalationMinutes }),
                escalationTargetUserIds: unique(request.rules[priority].escalationTargetUserIds),
            },
        ])
    return Object.fromEntries(entries) as ApprovalSlaPolicy['rules']
}
