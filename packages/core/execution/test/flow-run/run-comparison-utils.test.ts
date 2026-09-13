import { describe, expect, it } from 'vitest'
import { FlowActionType } from '../../src/lib/flows/actions/action'
import { FlowRunStatus } from '../../src/lib/flow-run/execution/flow-execution'
import { GenericStepOutput, StepOutputStatus, StepOutputType } from '../../src/lib/flow-run/execution/step-output'
import { RunErrorCategory } from '../../src/lib/flow-run/dto/compare-flow-runs-request'
import { runComparisonUtils } from '../../src/lib/flow-run/run-comparison-utils'

describe('categorizeRunError', () => {
    it('returns NONE for succeeded runs', () => {
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.SUCCEEDED })).toBe(RunErrorCategory.NONE)
    })

    it('maps infrastructure statuses to their categories', () => {
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.TIMEOUT })).toBe(RunErrorCategory.TIMEOUT)
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.QUOTA_EXCEEDED })).toBe(RunErrorCategory.QUOTA)
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.MEMORY_LIMIT_EXCEEDED })).toBe(RunErrorCategory.MEMORY)
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.LOG_SIZE_EXCEEDED })).toBe(RunErrorCategory.LOG_SIZE)
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.INTERNAL_ERROR })).toBe(RunErrorCategory.INTERNAL)
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.CANCELED })).toBe(RunErrorCategory.CANCELED)
    })

    it('treats non-terminal runs as having no error', () => {
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.QUEUED })).toBe(RunErrorCategory.NONE)
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.RUNNING })).toBe(RunErrorCategory.NONE)
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.PAUSED })).toBe(RunErrorCategory.NONE)
    })

    it('classifies a failed trigger step as TRIGGER', () => {
        expect(runComparisonUtils.categorizeRunError({
            status: FlowRunStatus.FAILED,
            triggerName: 'trigger',
            failedStep: { name: 'trigger', displayName: 'Webhook' },
            failedStepType: 'PIECE_TRIGGER',
        })).toBe(RunErrorCategory.TRIGGER)
    })

    it('classifies code step failures separately from piece failures', () => {
        expect(runComparisonUtils.categorizeRunError({
            status: FlowRunStatus.FAILED,
            triggerName: 'trigger',
            failedStep: { name: 'code_1', displayName: 'Transform' },
            failedStepType: FlowActionType.CODE,
        })).toBe(RunErrorCategory.CODE)
        expect(runComparisonUtils.categorizeRunError({
            status: FlowRunStatus.FAILED,
            triggerName: 'trigger',
            failedStep: { name: 'send_email', displayName: 'Send Email' },
            failedStepType: 'PIECE',
        })).toBe(RunErrorCategory.PIECE)
    })

    it('falls back to UNKNOWN when the failure has no step information', () => {
        expect(runComparisonUtils.categorizeRunError({ status: FlowRunStatus.FAILED })).toBe(RunErrorCategory.UNKNOWN)
    })
})

describe('summarizeOutput', () => {
    it('summarizes primitives and truncates long strings', () => {
        const summary = runComparisonUtils.summarizeOutput({ output: 'x'.repeat(500) })
        expect(summary.kind).toBe('primitive')
        expect(summary.truncated).toBe(true)
        expect(summary.preview.length).toBeLessThanOrEqual(301)
    })

    it('caps large arrays, reports their length and marks truncation', () => {
        const items = Array.from({ length: 500 }, (_, i) => i)
        const summary = runComparisonUtils.summarizeOutput({ output: items })
        expect(summary.kind).toBe('array')
        expect(summary.arrayLength).toBe(500)
        expect(summary.truncated).toBe(true)
        expect(summary.preview).toContain('…')
    })

    it('flags redacted sensitive values without exposing them', () => {
        const summary = runComparisonUtils.summarizeOutput({
            output: { token: '**REDACTED**', name: 'alice' },
        })
        expect(summary.hasRedactedValue).toBe(true)
        expect(summary.preview).toContain('**REDACTED**')
        expect(summary.preview).not.toContain('secret')

        const primitive = runComparisonUtils.summarizeOutput({ output: 'Bearer **REDACTED**' })
        expect(primitive.hasRedactedValue).toBe(true)
    })

    it('describes offloaded SLICE outputs with their size', () => {
        const summary = runComparisonUtils.summarizeOutput({
            output: { fileId: 'fil_123', size: 40960, url: 'https://example.test/x' },
            outputType: StepOutputType.SLICE,
        })
        expect(summary.preview).toContain('offloaded')
        expect(summary.preview).toContain('KB')
    })

    it('handles null output as empty', () => {
        expect(runComparisonUtils.summarizeOutput({ output: null })).toMatchObject({
            kind: 'empty',
            preview: '',
        })
    })
})

describe('summarizeStep', () => {
    it('marks missing steps as absent', () => {
        expect(runComparisonUtils.summarizeStep({ step: undefined })).toEqual({ present: false })
    })

    it('exposes status, duration and truncated error message', () => {
        const step = GenericStepOutput.create({
            type: FlowActionType.CODE,
            status: StepOutputStatus.FAILED,
            input: {},
        }).setDuration(1234).setErrorMessage('x'.repeat(2000))
        const summary = runComparisonUtils.summarizeStep({ step })
        expect(summary.present).toBe(true)
        expect(summary.status).toBe(StepOutputStatus.FAILED)
        expect(summary.durationMs).toBe(1234)
        expect(summary.errorMessage?.length).toBeLessThanOrEqual(701)
    })

    it('does not fabricate output summaries for steps without output', () => {
        const step = GenericStepOutput.create({
            type: FlowActionType.PIECE,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
        })
        const summary = runComparisonUtils.summarizeStep({ step })
        expect(summary.outputSummary).toBeUndefined()
    })
})
