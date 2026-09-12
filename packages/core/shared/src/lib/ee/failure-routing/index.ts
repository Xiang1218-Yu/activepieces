import { BaseModelSchema } from '@activepieces/core-utils'
import { z } from 'zod'

// Failure categories are derived from the terminal FlowRunStatus only.
// They never expose step-level error details to the matching layer.
export enum FailureCategory {
    FAILED = 'FAILED',
    TIMEOUT = 'TIMEOUT',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
    LOG_SIZE_EXCEEDED = 'LOG_SIZE_EXCEEDED',
    QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
}

export enum FailureRoutingTargetType {
    // Delivers through the existing event-destination webhook pipeline (worker HTTP job)
    EVENT_DESTINATION = 'EVENT_DESTINATION',
    // Delivers through the existing SMTP/log email pipeline
    EMAIL = 'EMAIL',
}

export enum FailureDeliveryStatus {
    PENDING = 'PENDING',
    SUCCEEDED = 'SUCCEEDED',
    FAILED = 'FAILED',
    // The run failed but no rule matched it
    SKIPPED = 'SKIPPED',
    // The same run was reported again after a delivery was created
    DEDUPLICATED = 'DEDUPLICATED',
}

// Empty / missing arrays mean "match anything" for that dimension.
export const FailureRoutingRuleFilter = z.object({
    flowIds: z.array(z.string()).optional(),
    categories: z.array(z.nativeEnum(FailureCategory)).optional(),
    minRetryCount: z.number().int().min(0).optional(),
    maxRetryCount: z.number().int().min(0).optional(),
})
export type FailureRoutingRuleFilter = z.infer<typeof FailureRoutingRuleFilter>

const FailureRoutingRuleTargetEventDestination = z.object({
    type: z.literal(FailureRoutingTargetType.EVENT_DESTINATION),
    // Existing event destination URL; the delivery goes through the same
    // internal-flow / worker HTTP path as regular event destinations.
    url: z.string().url(),
})

const FailureRoutingRuleTargetEmail = z.object({
    type: z.literal(FailureRoutingTargetType.EMAIL),
    emails: z.array(z.string().email()).min(1),
})

export const FailureRoutingRuleTarget = z.discriminatedUnion('type', [
    FailureRoutingRuleTargetEventDestination,
    FailureRoutingRuleTargetEmail,
])
export type FailureRoutingRuleTarget = z.infer<typeof FailureRoutingRuleTarget>

export const FailureRoutingRule = z.object({
    ...BaseModelSchema,
    platformId: z.string(),
    projectId: z.string(),
    displayName: z.string(),
    enabled: z.boolean(),
    // Lower number wins; ties are broken by creation order (ASC).
    priority: z.number().int(),
    // When true, rules with a lower priority are not evaluated after a match.
    stopOnMatch: z.boolean(),
    filter: FailureRoutingRuleFilter,
    target: FailureRoutingRuleTarget,
    // Denormalized snapshot of the most recent delivery, surfaced on list pages.
    lastDelivery: z.object({
        status: z.nativeEnum(FailureDeliveryStatus),
        flowRunId: z.string(),
        errorMessage: z.string().nullable(),
        updated: z.string(),
    }).nullable(),
})
export type FailureRoutingRule = z.infer<typeof FailureRoutingRule>

export const FailureDelivery = z.object({
    ...BaseModelSchema,
    platformId: z.string(),
    projectId: z.string(),
    ruleId: z.string(),
    flowRunId: z.string(),
    flowId: z.string(),
    retryCount: z.number().int(),
    category: z.nativeEnum(FailureCategory),
    targetType: z.nativeEnum(FailureRoutingTargetType),
    status: z.nativeEnum(FailureDeliveryStatus),
    // Transport-level error only (HTTP status, connection error, SMTP error).
    // Never stores flow step error messages.
    errorMessage: z.string().nullable(),
    attempts: z.number().int(),
    deliveredAt: z.string().nullable(),
})
export type FailureDelivery = z.infer<typeof FailureDelivery>

// --- API request bodies / queries ---

export const CreateFailureRoutingRuleRequestBody = z.object({
    projectId: z.string(),
    displayName: z.string().min(1).max(200),
    enabled: z.boolean().default(true),
    priority: z.number().int(),
    stopOnMatch: z.boolean().default(false),
    filter: FailureRoutingRuleFilter.default({}),
    target: FailureRoutingRuleTarget,
})
export type CreateFailureRoutingRuleRequestBody = z.infer<typeof CreateFailureRoutingRuleRequestBody>

export const UpdateFailureRoutingRuleRequestBody = z.object({
    displayName: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().optional(),
    stopOnMatch: z.boolean().optional(),
    filter: FailureRoutingRuleFilter.optional(),
    target: FailureRoutingRuleTarget.optional(),
})
export type UpdateFailureRoutingRuleRequestBody = z.infer<typeof UpdateFailureRoutingRuleRequestBody>

export const ListFailureRoutingRulesRequest = z.object({
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.coerce.number().optional(),
})
export type ListFailureRoutingRulesRequest = z.infer<typeof ListFailureRoutingRulesRequest>

export const ListFailureDeliveriesRequest = z.object({
    projectId: z.string(),
    ruleId: z.string().optional(),
    flowRunId: z.string().optional(),
    status: z.nativeEnum(FailureDeliveryStatus).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().optional(),
})
export type ListFailureDeliveriesRequest = z.infer<typeof ListFailureDeliveriesRequest>
