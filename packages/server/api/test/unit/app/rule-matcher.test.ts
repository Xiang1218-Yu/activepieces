import { describe, expect, it } from 'vitest'
import {
    FailureCategory,
    FlowRunStatus,
} from '@activepieces/shared'
import { categorizeRunStatus, matchesFailureRule } from '../../../src/app/failure-routing/rule-matcher'

describe('categorizeRunStatus', () => {
    it.each([
        [FlowRunStatus.FAILED, FailureCategory.FAILED],
        [FlowRunStatus.TIMEOUT, FailureCategory.TIMEOUT],
        [FlowRunStatus.INTERNAL_ERROR, FailureCategory.INTERNAL_ERROR],
        [FlowRunStatus.MEMORY_LIMIT_EXCEEDED, FailureCategory.MEMORY_LIMIT_EXCEEDED],
        [FlowRunStatus.LOG_SIZE_EXCEEDED, FailureCategory.LOG_SIZE_EXCEEDED],
        [FlowRunStatus.QUOTA_EXCEEDED, FailureCategory.QUOTA_EXCEEDED],
    ])('maps %s to %s', (status, expected) => {
        expect(categorizeRunStatus(status)).toBe(expected)
    })

    it('does not route successful, running or canceled runs', () => {
        expect(categorizeRunStatus(FlowRunStatus.SUCCEEDED)).toBeNull()
        expect(categorizeRunStatus(FlowRunStatus.RUNNING)).toBeNull()
        expect(categorizeRunStatus(FlowRunStatus.CANCELED)).toBeNull()
        expect(categorizeRunStatus(FlowRunStatus.PAUSED)).toBeNull()
    })
})

describe('matchesFailureRule', () => {
    const candidate = {
        flowId: 'flow-1',
        category: FailureCategory.FAILED,
        retryCount: 2,
    }

    it('matches anything when the filter is empty', () => {
        expect(matchesFailureRule({}, candidate)).toBe(true)
    })

    it('filters by flow ids', () => {
        expect(matchesFailureRule({ flowIds: ['other'] }, candidate)).toBe(false)
        expect(matchesFailureRule({ flowIds: ['flow-1'] }, candidate)).toBe(true)
        expect(matchesFailureRule({ flowIds: [] }, candidate)).toBe(true)
    })

    it('filters by category', () => {
        expect(matchesFailureRule({ categories: [FailureCategory.TIMEOUT] }, candidate)).toBe(false)
        expect(matchesFailureRule({ categories: [FailureCategory.FAILED] }, candidate)).toBe(true)
    })

    it('filters by retry count range', () => {
        expect(matchesFailureRule({ minRetryCount: 3 }, candidate)).toBe(false)
        expect(matchesFailureRule({ minRetryCount: 2 }, candidate)).toBe(true)
        expect(matchesFailureRule({ maxRetryCount: 1 }, candidate)).toBe(false)
        expect(matchesFailureRule({ minRetryCount: 1, maxRetryCount: 3 }, candidate)).toBe(true)
    })

    it('combines all dimensions', () => {
        expect(matchesFailureRule({
            flowIds: ['flow-1'],
            categories: [FailureCategory.FAILED],
            minRetryCount: 1,
            maxRetryCount: 5,
        }, candidate)).toBe(true)
    })
})
