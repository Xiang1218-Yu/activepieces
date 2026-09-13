import { ActivepiecesError, apId, ApprovalSlaPolicy, ApprovalSlaRule, ErrorCode, isNil, PlatformId, ProjectId, unique, UpsertApprovalSlaPolicyRequestBody, UserId } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../../core/db/repo-factory'
import { projectMemberService } from '../../projects/project-members/project-member.service'
import { ApprovalSlaPolicyEntity } from './approval-sla-policy.entity'
import { approvalSlaTime } from './approval-sla-time'

const repo = repoFactory(ApprovalSlaPolicyEntity)

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
        assertNoDuplicatePriorities(request)
        assertRulesAreOrdered(request)
        await assertEscalationTargetsAreMembers({ log, projectId, request })

        const rules = rulesArrayToMap(request)
        const existing = await repo().findOneBy({ projectId })
        if (isNil(existing)) {
            const policy: ApprovalSlaPolicy = {
                id: apId(),
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                projectId,
                platformId,
                timezone: request.timezone,
                rules,
            }
            await repo().insert(policy)
            return policy
        }
        const updated: ApprovalSlaPolicy = {
            ...existing,
            timezone: request.timezone,
            rules,
            updated: new Date().toISOString(),
        }
        await repo().save(updated)
        return updated
    },

    async delete({ projectId }: { projectId: ProjectId }): Promise<void> {
        await repo().delete({ projectId })
    },
})

function assertNoDuplicatePriorities(request: UpsertApprovalSlaPolicyRequestBody): void {
    const seen = new Set(request.rules.map((entry) => entry.priority))
    if (seen.size !== request.rules.length) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'Duplicate priority in SLA rules' },
        })
    }
}

function assertRulesAreOrdered(request: UpsertApprovalSlaPolicyRequestBody): void {
    for (const { rule } of request.rules) {
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
    const targetIds = unique(request.rules.flatMap((entry) => entry.rule.escalationTargetUserIds))
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

function rulesArrayToMap(request: UpsertApprovalSlaPolicyRequestBody): ApprovalSlaPolicy['rules'] {
    const map: ApprovalSlaPolicy['rules'] = {}
    for (const { priority, rule } of request.rules) {
        const normalized: ApprovalSlaRule = {
            timeoutMinutes: rule.timeoutMinutes,
            ...(rule.escalationMinutes === undefined
                ? {}
                : { escalationMinutes: rule.escalationMinutes }),
            escalationTargetUserIds: unique(rule.escalationTargetUserIds),
        }
        map[priority] = normalized
    }
    return map
}
