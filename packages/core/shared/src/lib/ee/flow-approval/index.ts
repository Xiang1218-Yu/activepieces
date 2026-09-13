import { ApprovalPriority, Flow, FlowStatus, FlowVersion } from '@activepieces/core-execution'
import { ApId, BaseModelSchema, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'

export enum FlowApprovalRequestState {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
}

export const FlowApprovalPriority = ApprovalPriority
export type FlowApprovalPriority = ApprovalPriority

export enum ApprovalSlaBreachReason {
    PENDING_LIMIT = 'PENDING_LIMIT',
    ESCALATION_LIMIT = 'ESCALATION_LIMIT',
}

export const APPROVAL_SLA_TIMEZONE_DEFAULT = 'Etc/UTC'

export const ApprovalSlaRule = z.object({
    timeoutMinutes: z.number({ message: 'required' }).int({ message: 'timeoutMustBeWholeMinutes' }).min(1, { message: 'timeoutMustBeAtLeastOneMinute' }).max(366 * 24 * 60, { message: 'timeoutIsTooLarge' }),
    escalationMinutes: z.number({ message: 'escalationMustBeWholeMinutes' }).int({ message: 'escalationMustBeWholeMinutes' }).min(0, { message: 'escalationMustBeZeroOrMore' }).max(366 * 24 * 60, { message: 'timeoutIsTooLarge' }).optional(),
    escalationTargetUserIds: z.array(ApId).max(50, { message: 'tooManyEscalationTargets' }).default([]),
})
export type ApprovalSlaRule = z.infer<typeof ApprovalSlaRule>

export const ApprovalSlaPolicy = z.object({
    ...BaseModelSchema,
    projectId: ApId,
    platformId: ApId,
    timezone: z.string().min(1, { message: 'required' }).max(64),
    rules: z.record(z.enum(FlowApprovalPriority), ApprovalSlaRule),
})
export type ApprovalSlaPolicy = z.infer<typeof ApprovalSlaPolicy>

export const UpsertApprovalSlaPolicyRequestBody = z.object({
    timezone: z.string().min(1, { message: 'required' }).max(64),
    rules: z
        .record(z.enum(FlowApprovalPriority), ApprovalSlaRule.omit({ escalationTargetUserIds: true }).extend({
            escalationTargetUserIds: z.array(ApId).max(50, { message: 'tooManyEscalationTargets' }),
        }))
        .refine((rules) => Object.keys(rules).length > 0, { message: 'atLeastOnePriorityRule' }),
})
export type UpsertApprovalSlaPolicyRequestBody = z.infer<typeof UpsertApprovalSlaPolicyRequestBody>

export const ApprovalSlaStatus = z.object({
    configured: z.boolean(),
    priority: z.enum(FlowApprovalPriority),
    timezone: z.string(),
    deadlineAt: Nullable(z.string()),
    remainingMs: z.number(),
    overdue: z.boolean(),
    paused: z.boolean(),
    escalationTargetUserIds: z.array(ApId),
    escalatedAt: Nullable(z.string()),
    breachReason: z.nullable(z.enum(ApprovalSlaBreachReason)),
})
export type ApprovalSlaStatus = z.infer<typeof ApprovalSlaStatus>

export const FlowApprovalRequest = z.object({
    ...BaseModelSchema,
    flowId: ApId,
    flowVersionId: ApId,
    projectId: ApId,
    platformId: ApId,
    submitterId: Nullable(ApId),
    submittedAt: z.string(),
    approverId: Nullable(ApId),
    decidedAt: Nullable(z.string()),
    state: z.enum(FlowApprovalRequestState),
    requestedStatus: z.enum(FlowStatus),
    rejectionReason: Nullable(z.string()),
    priority: z.enum(FlowApprovalPriority),
    slaDeadlineAt: Nullable(z.string()),
    pausedAt: Nullable(z.string()),
    escalatedAt: Nullable(z.string()),
    slaBreachReason: Nullable(z.enum(ApprovalSlaBreachReason)),
})
export type FlowApprovalRequest = z.infer<typeof FlowApprovalRequest>

export const PopulatedFlowApprovalRequest = FlowApprovalRequest.extend({
    flow: Flow.optional(),
    flowVersion: FlowVersion.pick({ id: true, displayName: true, flowId: true, state: true, created: true, updated: true }).optional(),
    sla: ApprovalSlaStatus.optional(),
})
export type PopulatedFlowApprovalRequest = z.infer<typeof PopulatedFlowApprovalRequest>

export const RejectFlowApprovalRequestBody = z.object({
    reason: z.string().max(1000).optional(),
})
export type RejectFlowApprovalRequestBody = z.infer<typeof RejectFlowApprovalRequestBody>

export const ListFlowApprovalRequestsQuery = z.object({
    state: z.enum(FlowApprovalRequestState).optional(),
    projectId: z.optional(ApId),
    flowVersionId: z.optional(ApId),
    mine: z.coerce.boolean().optional(),
    overdue: z.coerce.boolean().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
})
export type ListFlowApprovalRequestsQuery = z.infer<typeof ListFlowApprovalRequestsQuery>
