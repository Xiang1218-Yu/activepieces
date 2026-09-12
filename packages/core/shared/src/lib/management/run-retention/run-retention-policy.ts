import { FlowRunStatus, isFlowRunStateTerminal } from '@activepieces/core-execution'
import { ApId, BaseModelSchema, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import { formErrors } from '../../form-errors'

export const TERMINAL_RUN_STATUSES: FlowRunStatus[] = Object.values(FlowRunStatus).filter((status) =>
    isFlowRunStateTerminal({ status, ignoreInternalError: false }),
)

export enum RunRetentionPolicyScope {
    PLATFORM = 'PLATFORM',
    PROJECT = 'PROJECT',
}

export const RunRetentionPolicySpec = z.object({
    retentionDays: z.number().int().positive(),
    statuses: z.array(z.enum(FlowRunStatus)).min(1).refine(
        (statuses) => statuses.every((status) => TERMINAL_RUN_STATUSES.includes(status)),
        formErrors.runRetentionStatusesMustBeTerminal,
    ),
    includeArchived: z.boolean(),
})
export type RunRetentionPolicySpec = z.infer<typeof RunRetentionPolicySpec>

export const RunRetentionPolicy = z.object({
    ...BaseModelSchema,
    platformId: ApId,
    projectId: Nullable(ApId),
    ...RunRetentionPolicySpec.shape,
})
export type RunRetentionPolicy = z.infer<typeof RunRetentionPolicy>

export const UpsertRunRetentionPolicyRequest = RunRetentionPolicySpec
export type UpsertRunRetentionPolicyRequest = z.infer<typeof UpsertRunRetentionPolicyRequest>

export const UpsertRunRetentionPolicyOverrideRequest = RunRetentionPolicySpec.extend({
    projectId: ApId,
})
export type UpsertRunRetentionPolicyOverrideRequest = z.infer<typeof UpsertRunRetentionPolicyOverrideRequest>

export const RunRetentionPolicyQuery = z.object({
    projectId: ApId,
})
export type RunRetentionPolicyQuery = z.infer<typeof RunRetentionPolicyQuery>

export const ResolvedRunRetentionPolicy = z.object({
    source: z.enum(RunRetentionPolicyScope),
    ...RunRetentionPolicySpec.shape,
})
export type ResolvedRunRetentionPolicy = z.infer<typeof ResolvedRunRetentionPolicy>

export const PreviewRunRetentionCleanupRequest = z.object({
    projectId: ApId,
    policy: RunRetentionPolicySpec.optional(),
})
export type PreviewRunRetentionCleanupRequest = z.infer<typeof PreviewRunRetentionCleanupRequest>

export const RunRetentionCleanupPreview = z.object({
    estimatedCount: z.number(),
    earliestFinishTime: Nullable(z.string()),
})
export type RunRetentionCleanupPreview = z.infer<typeof RunRetentionCleanupPreview>
