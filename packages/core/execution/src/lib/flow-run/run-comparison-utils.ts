import { isNil, truncateString } from '@activepieces/core-utils'
import { FlowRunStatus } from './execution/flow-execution'
import { StepOutput, StepOutputStatus, StepOutputType } from './execution/step-output'
import { RunErrorCategory, RunOutputSummary } from './dto/compare-flow-runs-request'
import { FailedStep } from './flow-run'

const MAX_ARRAY_ITEMS_IN_SUMMARY = 20
const MAX_OBJECT_KEYS_IN_SUMMARY = 20
const MAX_PREVIEW_LENGTH = 300
const REDACTED_TOKEN = '**REDACTED**'
const MAX_ERROR_MESSAGE_LENGTH = 700

type CategorizeErrorParams = {
    status: FlowRunStatus
    failedStep?: FailedStep
    triggerName?: string
    failedStepType?: string
}

function categorizeRunError({ status, failedStep, triggerName, failedStepType }: CategorizeErrorParams): RunErrorCategory {
    switch (status) {
        case FlowRunStatus.SUCCEEDED:
            return RunErrorCategory.NONE
        case FlowRunStatus.TIMEOUT:
            return RunErrorCategory.TIMEOUT
        case FlowRunStatus.QUOTA_EXCEEDED:
            return RunErrorCategory.QUOTA
        case FlowRunStatus.MEMORY_LIMIT_EXCEEDED:
            return RunErrorCategory.MEMORY
        case FlowRunStatus.LOG_SIZE_EXCEEDED:
            return RunErrorCategory.LOG_SIZE
        case FlowRunStatus.INTERNAL_ERROR:
            return RunErrorCategory.INTERNAL
        case FlowRunStatus.CANCELED:
            return RunErrorCategory.CANCELED
        case FlowRunStatus.QUEUED:
        case FlowRunStatus.RUNNING:
        case FlowRunStatus.PAUSED:
            return RunErrorCategory.NONE
        case FlowRunStatus.FAILED:
            return categorizeFailedStep({ failedStep, triggerName, failedStepType })
        default:
            return RunErrorCategory.UNKNOWN
    }
}

function categorizeFailedStep({ failedStep, triggerName, failedStepType }: Omit<CategorizeErrorParams, 'status'>): RunErrorCategory {
    if (isNil(failedStep)) {
        return RunErrorCategory.UNKNOWN
    }
    if (failedStep.name === triggerName) {
        return RunErrorCategory.TRIGGER
    }
    if (failedStepType === 'CODE') {
        return RunErrorCategory.CODE
    }
    if (isTriggerErrorMessage(failedStep.message)) {
        return RunErrorCategory.TRIGGER
    }
    if (failedStepType === 'ROUTER' || failedStepType === 'LOOP_ON_ITEMS') {
        return RunErrorCategory.UNKNOWN
    }
    return RunErrorCategory.PIECE
}

function isTriggerErrorMessage(message?: string): boolean {
    if (isNil(message)) {
        return false
    }
    return message.startsWith('Trigger') || message.startsWith('Webhook')
}

type SummarizeOutputParams = {
    output: unknown
    outputType?: string
}

function summarizeOutput({ output, outputType }: SummarizeOutputParams): RunOutputSummary {
    if (outputType === StepOutputType.SLICE) {
        const slice = asSliceRef(output)
        return {
            kind: 'primitive',
            preview: isNil(slice) ? 'offloaded' : `offloaded (${formatBytes(slice.size)})`,
            truncated: false,
            hasRedactedValue: false,
        }
    }
    if (isNil(output)) {
        return { kind: 'empty', preview: '', truncated: false, hasRedactedValue: false }
    }
    if (Array.isArray(output)) {
        return summarizeArray(output)
    }
    if (typeof output === 'object') {
        return summarizeObject(output as Record<string, unknown>)
    }
    const primitive = String(output)
    return {
        kind: 'primitive',
        preview: truncateString({ value: primitive, maxLength: MAX_PREVIEW_LENGTH }),
        truncated: primitive.length > MAX_PREVIEW_LENGTH,
        hasRedactedValue: primitive === REDACTED_TOKEN || primitive.includes(REDACTED_TOKEN),
    }
}

function summarizeArray(output: unknown[]): RunOutputSummary {
    const truncated = output.length > MAX_ARRAY_ITEMS_IN_SUMMARY
    const items = truncated ? output.slice(0, MAX_ARRAY_ITEMS_IN_SUMMARY) : output
    let hasRedactedValue = false
    const renderedItems = items.map((item) => {
        const rendered = renderValue(item)
        if (rendered.includes(REDACTED_TOKEN)) {
            hasRedactedValue = true
        }
        return rendered
    })
    const preview = `[${renderedItems.join(', ')}${truncated ? ', …' : ''}]`
    return {
        kind: 'array',
        preview: truncateString({ value: preview, maxLength: MAX_PREVIEW_LENGTH }),
        truncated: truncated || preview.length > MAX_PREVIEW_LENGTH,
        hasRedactedValue,
        arrayLength: output.length,
    }
}

function summarizeObject(output: Record<string, unknown>): RunOutputSummary {
    const keys = Object.keys(output)
    const truncated = keys.length > MAX_OBJECT_KEYS_IN_SUMMARY
    const visibleEntries = truncated ? keys.slice(0, MAX_OBJECT_KEYS_IN_SUMMARY) : keys
    let hasRedactedValue = false
    const parts = visibleEntries.map((key) => {
        const rendered = renderValue(output[key])
        if (rendered.includes(REDACTED_TOKEN)) {
            hasRedactedValue = true
        }
        return `${JSON.stringify(key)}: ${rendered}`
    })
    const preview = `{${parts.join(', ')}${truncated ? ', …' : ''}}`
    return {
        kind: 'object',
        preview: truncateString({ value: preview, maxLength: MAX_PREVIEW_LENGTH }),
        truncated: truncated || preview.length > MAX_PREVIEW_LENGTH,
        hasRedactedValue,
    }
}

function renderValue(value: unknown): string {
    if (typeof value === 'string') {
        if (value === REDACTED_TOKEN) {
            return REDACTED_TOKEN
        }
        if (value.includes(REDACTED_TOKEN)) {
            return JSON.stringify(value.replaceAll(REDACTED_TOKEN, '[redacted]'))
        }
        return JSON.stringify(truncateString({ value, maxLength: 80 }))
    }
    if (isNil(value) || typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }
    if (Array.isArray(value)) {
        return `Array(${value.length})`
    }
    return `Object(${Object.keys(value as Record<string, unknown>).length})`
}

function asSliceRef(output: unknown): { fileId: string, size: number, url: string } | undefined {
    if (isNil(output) || typeof output !== 'object') {
        return undefined
    }
    const ref = output as Record<string, unknown>
    if (typeof ref.fileId !== 'string' || typeof ref.size !== 'number') {
        return undefined
    }
    return { fileId: ref.fileId, size: ref.size, url: typeof ref.url === 'string' ? ref.url : '' }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type SummarizeStepParams = {
    step: StepOutput | undefined
}

function summarizeStep({ step }: SummarizeStepParams) {
    if (isNil(step)) {
        return { present: false }
    }
    const isOffloaded = step.status === StepOutputStatus.SUCCEEDED && step.outputType === StepOutputType.SLICE
    const hasOutput = isOffloaded || !isNil(step.output)
    return {
        present: true,
        status: step.status,
        durationMs: isNil(step.duration) ? null : Math.round(step.duration),
        outputSummary: hasOutput
            ? summarizeOutput({ output: step.output, outputType: step.outputType })
            : undefined,
        errorMessage: isNil(step.errorMessage)
            ? null
            : truncateString({ value: step.errorMessage, maxLength: MAX_ERROR_MESSAGE_LENGTH }),
        outputOffloaded: isOffloaded,
    }
}

export const runComparisonUtils = {
    categorizeRunError,
    summarizeOutput,
    summarizeStep,
    REDACTED_TOKEN,
    MAX_ARRAY_ITEMS_IN_SUMMARY,
}
