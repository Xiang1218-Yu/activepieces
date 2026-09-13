import { ApId, OptionalArrayFromQuery } from '@activepieces/core-utils'
import { z } from 'zod'
import { FlowRunStatus } from '../execution/flow-execution'

export const CompareFlowRunsRequestQuery = z.object({
    projectId: ApId,
    flowRunIds: OptionalArrayFromQuery(ApId),
})
export type CompareFlowRunsRequestQuery = z.infer<typeof CompareFlowRunsRequestQuery>

export enum RunErrorCategory {
    NONE = 'NONE',
    TRIGGER = 'TRIGGER',
    PIECE = 'PIECE',
    CODE = 'CODE',
    TIMEOUT = 'TIMEOUT',
    QUOTA = 'QUOTA',
    MEMORY = 'MEMORY',
    LOG_SIZE = 'LOG_SIZE',
    INTERNAL = 'INTERNAL',
    CANCELED = 'CANCELED',
    UNKNOWN = 'UNKNOWN',
}

export const RunOutputSummary = z.object({
    kind: z.enum(['object', 'array', 'primitive', 'empty']),
    preview: z.string(),
    truncated: z.boolean(),
    hasRedactedValue: z.boolean(),
    arrayLength: z.number().optional(),
})
export type RunOutputSummary = z.infer<typeof RunOutputSummary>

export const CompareStepCell = z.object({
    present: z.boolean(),
    status: z.string().optional(),
    durationMs: z.number().nullable().optional(),
    outputSummary: RunOutputSummary.optional(),
    errorMessage: z.string().nullable().optional(),
    outputOffloaded: z.boolean().optional(),
})
export type CompareStepCell = z.infer<typeof CompareStepCell>

export const CompareTriggerCell = z.object({
    present: z.boolean(),
    status: z.string().optional(),
    durationMs: z.number().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
})
export type CompareTriggerCell = z.infer<typeof CompareTriggerCell>

export const CompareRunColumn = z.object({
    flowRunId: z.string(),
    flowId: z.string(),
    flowVersionId: z.string(),
    versionShort: z.string(),
    flowDisplayName: z.string().optional(),
    created: z.string(),
    status: z.nativeEnum(FlowRunStatus),
    errorCategory: z.nativeEnum(RunErrorCategory),
    trigger: CompareTriggerCell,
    durationMs: z.number().nullable(),
    queueMs: z.number().nullable().optional(),
    tags: z.array(z.string()),
    stepsAvailable: z.boolean(),
    steps: z.record(z.string(), CompareStepCell),
})
export type CompareRunColumn = z.infer<typeof CompareRunColumn>

export const CompareStepRow = z.object({
    rowKey: z.string(),
    stepName: z.string(),
    displayName: z.string().optional(),
    onlyInVersionIds: z.array(z.string()),
})
export type CompareStepRow = z.infer<typeof CompareStepRow>

export const CompareFlowRunsResponse = z.object({
    columns: z.array(CompareRunColumn),
    rows: z.array(CompareStepRow),
    versionIds: z.array(z.string()),
    notFoundRunIds: z.array(z.string()),
})
export type CompareFlowRunsResponse = z.infer<typeof CompareFlowRunsResponse>

export const FailureRateAggregationInterval = {
    HOUR: 'HOUR',
    DAY: 'DAY',
} as const
export type FailureRateAggregationInterval =
    typeof FailureRateAggregationInterval[keyof typeof FailureRateAggregationInterval]

export const FailureRateAggregationRequestQuery = z.object({
    projectId: ApId,
    flowId: OptionalArrayFromQuery(ApId),
    tags: OptionalArrayFromQuery(z.string()),
    createdAfter: z.string(),
    createdBefore: z.string(),
    interval: z.enum(['HOUR', 'DAY']).default('DAY'),
    limit: z.coerce.number().min(1).max(100).default(31),
    cursor: z.string().optional(),
})
export type FailureRateAggregationRequestQuery = z.infer<typeof FailureRateAggregationRequestQuery>

export const FailureRateBucket = z.object({
    bucketStart: z.string(),
    total: z.number(),
    failed: z.number(),
    succeeded: z.number(),
    other: z.number(),
    failureRate: z.number(),
})
export type FailureRateBucket = z.infer<typeof FailureRateBucket>

export const FailureRateAggregationResponse = z.object({
    interval: z.enum(['HOUR', 'DAY']),
    buckets: z.array(FailureRateBucket),
    next: z.string().nullable(),
})
export type FailureRateAggregationResponse = z.infer<typeof FailureRateAggregationResponse>

export const MAX_COMPARED_RUNS = 10
