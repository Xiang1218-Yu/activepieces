import { isNil } from '@activepieces/core-utils'
import { StepOutput } from '../../flow-run/execution/step-output'
import {
    FlowTestScenarioDiffReport,
    FlowTestScenarioFieldDiff,
    FlowTestScenarioStepDiff,
} from './test-scenario'

type ComputeDiffParams = {
    /** Expected key outputs per step name; matched as a deep subset of the actual output. */
    expectedOutputs: Record<string, unknown>
    /** Dot-separated paths ("stepName" or "stepName.path.to.field", `*` matches one segment). */
    allowedDynamicFields: string[]
    /** Actual step outputs of the finished run, keyed by step name. */
    steps: Record<string, StepOutput>
    flowRunStatus: string
    generatedAt: string
}

const WILDCARD = '*'

function parseDynamicPaths(allowedDynamicFields: string[]): Map<string, string[][]> {
    const byStep = new Map<string, string[][]>()
    for (const entry of allowedDynamicFields) {
        const segments = entry.split('.').filter((segment) => segment.length > 0)
        if (segments.length === 0) {
            continue
        }
        const [stepName] = segments
        const patterns = byStep.get(stepName) ?? []
        // Patterns keep the step name as their first segment so they can be
        // matched against full field paths ("stepName.path.to.field").
        patterns.push(segments)
        byStep.set(stepName, patterns)
    }
    return byStep
}

function matchesPattern(pattern: string[], path: string[]): boolean {
    if (pattern.length !== path.length) {
        return false
    }
    return pattern.every((segment, index) => segment === WILDCARD || segment === path[index])
}

function isDynamicPath(patterns: string[][], path: string[]): boolean {
    // An entry that is just the step name (single-segment pattern) excludes
    // the whole step when matched against the step's root path.
    return patterns.some((pattern) => matchesPattern(pattern, path))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepEqual(expected: unknown, actual: unknown): boolean {
    if (Object.is(expected, actual)) {
        return true
    }
    if (isPlainObject(expected) && isPlainObject(actual)) {
        const expectedKeys = Object.keys(expected)
        const actualKeys = Object.keys(actual)
        return expectedKeys.length === actualKeys.length
            && expectedKeys.every((key) => deepEqual(expected[key], actual[key]))
    }
    if (Array.isArray(expected) && Array.isArray(actual)) {
        return expected.length === actual.length
            && expected.every((item, index) => deepEqual(item, actual[index]))
    }
    return false
}

function compareValue({ path, expected, actual, patterns, fields }: CompareValueParams): void {
    if (isDynamicPath(patterns, path)) {
        fields.push({ path: path.join('.'), status: 'DYNAMIC_SKIPPED', expected, actual })
        return
    }
    if (isPlainObject(expected) && isPlainObject(actual)) {
        for (const key of Object.keys(expected)) {
            compareValue({
                path: [...path, key],
                expected: expected[key],
                actual: actual[key],
                patterns,
                fields,
            })
        }
        return
    }
    if (Array.isArray(expected) && Array.isArray(actual)) {
        for (let index = 0; index < expected.length; index++) {
            compareValue({
                path: [...path, String(index)],
                expected: expected[index],
                actual: actual[index],
                patterns,
                fields,
            })
        }
        return
    }
    if (isNil(actual) && !isNil(expected)) {
        fields.push({ path: path.join('.'), status: 'MISSING', expected, actual })
        return
    }
    fields.push({
        path: path.join('.'),
        status: deepEqual(expected, actual) ? 'MATCH' : 'MISMATCH',
        expected,
        actual,
    })
}

type CompareValueParams = {
    path: string[]
    expected: unknown
    actual: unknown
    patterns: string[][]
    fields: FlowTestScenarioFieldDiff[]
}

/**
 * Compares the actual step outputs of a finished test run against the
 * scenario's expected key outputs, excluding the allowed dynamic fields.
 * Expected objects/arrays are matched as subsets: only the keys and indices
 * present in the expectation are asserted.
 */
export function computeFlowTestScenarioDiff(params: ComputeDiffParams): FlowTestScenarioDiffReport {
    const dynamicPathsByStep = parseDynamicPaths(params.allowedDynamicFields)
    const stepDiffs: FlowTestScenarioStepDiff[] = []

    for (const [stepName, expectedOutput] of Object.entries(params.expectedOutputs)) {
        const patterns = dynamicPathsByStep.get(stepName) ?? []
        const fields: FlowTestScenarioFieldDiff[] = []
        const stepOutput = params.steps[stepName]

        if (isDynamicPath(patterns, [stepName])) {
            stepDiffs.push({ stepName, status: 'SKIPPED', fields: [{ path: stepName, status: 'DYNAMIC_SKIPPED', expected: expectedOutput, actual: stepOutput?.output }] })
            continue
        }
        if (isNil(stepOutput)) {
            stepDiffs.push({ stepName, status: 'MISSING_STEP', fields: [{ path: stepName, status: 'MISSING', expected: expectedOutput }] })
            continue
        }

        compareValue({
            path: [stepName],
            expected: expectedOutput,
            actual: stepOutput.output,
            patterns,
            fields,
        })

        const hasMismatch = fields.some((field) => field.status === 'MISMATCH' || field.status === 'MISSING')
        stepDiffs.push({ stepName, status: hasMismatch ? 'MISMATCH' : 'MATCH', fields })
    }

    const allFields = stepDiffs.flatMap((step) => step.fields)
    return {
        generatedAt: params.generatedAt,
        flowRunStatus: params.flowRunStatus,
        summary: {
            matched: allFields.filter((field) => field.status === 'MATCH').length,
            mismatched: allFields.filter((field) => field.status === 'MISMATCH').length,
            missing: allFields.filter((field) => field.status === 'MISSING').length,
            dynamicSkipped: allFields.filter((field) => field.status === 'DYNAMIC_SKIPPED').length,
        },
        steps: stepDiffs,
    }
}

export function isPassingDiffReport(report: FlowTestScenarioDiffReport): boolean {
    return report.summary.mismatched === 0 && report.summary.missing === 0
}
