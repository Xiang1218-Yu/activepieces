import {
    FailureCategory,
    FailureRoutingRuleFilter,
    FlowRunStatus,
} from '@activepieces/shared'

// Terminal statuses that represent an execution worth routing.
// CANCELED runs are operator-initiated and never routed.
const FAILURE_STATUS_TO_CATEGORY: Partial<Record<FlowRunStatus, FailureCategory>> = {
    [FlowRunStatus.FAILED]: FailureCategory.FAILED,
    [FlowRunStatus.TIMEOUT]: FailureCategory.TIMEOUT,
    [FlowRunStatus.INTERNAL_ERROR]: FailureCategory.INTERNAL_ERROR,
    [FlowRunStatus.MEMORY_LIMIT_EXCEEDED]: FailureCategory.MEMORY_LIMIT_EXCEEDED,
    [FlowRunStatus.LOG_SIZE_EXCEEDED]: FailureCategory.LOG_SIZE_EXCEEDED,
    [FlowRunStatus.QUOTA_EXCEEDED]: FailureCategory.QUOTA_EXCEEDED,
}

export const categorizeRunStatus = (status: FlowRunStatus): FailureCategory | null =>
    FAILURE_STATUS_TO_CATEGORY[status] ?? null

export type FailureRuleCandidate = {
    flowId: string
    category: FailureCategory
    retryCount: number
}

// Empty / missing filter dimensions match anything. Matching only sees the
// category and retry count derived from the run — never step error details
// or connections.
export const matchesFailureRule = (
    filter: FailureRoutingRuleFilter,
    candidate: FailureRuleCandidate,
): boolean => {
    if (filter.flowIds && filter.flowIds.length > 0 && !filter.flowIds.includes(candidate.flowId)) {
        return false
    }
    if (filter.categories && filter.categories.length > 0 && !filter.categories.includes(candidate.category)) {
        return false
    }
    if (filter.minRetryCount !== undefined && candidate.retryCount < filter.minRetryCount) {
        return false
    }
    if (filter.maxRetryCount !== undefined && candidate.retryCount > filter.maxRetryCount) {
        return false
    }
    return true
}
