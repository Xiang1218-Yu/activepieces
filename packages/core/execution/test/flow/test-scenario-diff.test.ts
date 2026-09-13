import { FlowRunStatus } from '../../src/lib/flow-run/execution/flow-execution'
import { GenericStepOutput, StepOutput, StepOutputStatus } from '../../src/lib/flow-run/execution/step-output'
import { FlowActionType } from '../../src/lib/flows/actions/action'
import { computeFlowTestScenarioDiff, isPassingDiffReport } from '../../src/lib/flows/test-scenario/test-scenario-diff'

const GENERATED_AT = '2026-09-12T00:00:00.000Z'

function stepOutput(output: unknown): StepOutput {
    return GenericStepOutput.create({
        type: FlowActionType.CODE,
        status: StepOutputStatus.SUCCEEDED,
        input: {},
        output,
    })
}

function compute(params: {
    expectedOutputs: Record<string, unknown>
    allowedDynamicFields?: string[]
    steps: Record<string, StepOutput>
}) {
    return computeFlowTestScenarioDiff({
        expectedOutputs: params.expectedOutputs,
        allowedDynamicFields: params.allowedDynamicFields ?? [],
        steps: params.steps,
        flowRunStatus: FlowRunStatus.SUCCEEDED,
        generatedAt: GENERATED_AT,
    })
}

describe('computeFlowTestScenarioDiff', () => {
    it('matches expected key outputs as a subset of the actual output', () => {
        const report = compute({
            expectedOutputs: {
                step1: { id: 5, user: { name: 'alice' } },
            },
            steps: {
                step1: stepOutput({ id: 5, user: { name: 'alice', email: 'a@b.c' }, extra: true }),
            },
        })

        expect(report.steps).toHaveLength(1)
        expect(report.steps[0].status).toBe('MATCH')
        expect(report.summary).toEqual({ matched: 2, mismatched: 0, missing: 0, dynamicSkipped: 0 })
        expect(isPassingDiffReport(report)).toBe(true)
    })

    it('reports mismatches with expected and actual values', () => {
        const report = compute({
            expectedOutputs: { step1: { total: 100 } },
            steps: { step1: stepOutput({ total: 42 }) },
        })

        expect(report.steps[0].status).toBe('MISMATCH')
        expect(report.steps[0].fields).toEqual([
            { path: 'step1.total', status: 'MISMATCH', expected: 100, actual: 42 },
        ])
        expect(report.summary.mismatched).toBe(1)
        expect(isPassingDiffReport(report)).toBe(false)
    })

    it('marks fields missing when the actual value is absent', () => {
        const report = compute({
            expectedOutputs: { step1: { id: 5 } },
            steps: { step1: stepOutput({}) },
        })

        expect(report.steps[0].fields).toEqual([
            { path: 'step1.id', status: 'MISSING', expected: 5, actual: undefined },
        ])
        expect(report.summary.missing).toBe(1)
        expect(isPassingDiffReport(report)).toBe(false)
    })

    it('marks the whole step missing when the step did not produce output', () => {
        const report = compute({
            expectedOutputs: { step1: { id: 5 } },
            steps: {},
        })

        expect(report.steps[0].status).toBe('MISSING_STEP')
        expect(report.summary.missing).toBe(1)
        expect(isPassingDiffReport(report)).toBe(false)
    })

    it('skips allowed dynamic fields without comparing them', () => {
        const report = compute({
            expectedOutputs: {
                step1: { id: 'dynamic-id', createdAt: '2026-01-01', total: 100 },
            },
            allowedDynamicFields: ['step1.id', 'step1.createdAt'],
            steps: {
                step1: stepOutput({ id: 'other-id', createdAt: '2026-09-12', total: 100 }),
            },
        })

        expect(report.steps[0].status).toBe('MATCH')
        expect(report.summary).toEqual({ matched: 1, mismatched: 0, missing: 0, dynamicSkipped: 2 })
        expect(isPassingDiffReport(report)).toBe(true)
    })

    it('supports wildcard segments in dynamic field paths', () => {
        const report = compute({
            expectedOutputs: {
                step1: { items: [{ id: 1, sku: 'A' }, { id: 2, sku: 'B' }] },
            },
            allowedDynamicFields: ['step1.items.*.id'],
            steps: {
                step1: stepOutput({ items: [{ id: 99, sku: 'A' }, { id: 98, sku: 'B' }] }),
            },
        })

        expect(report.steps[0].status).toBe('MATCH')
        expect(report.summary.dynamicSkipped).toBe(2)
        expect(report.summary.matched).toBe(2)
        expect(isPassingDiffReport(report)).toBe(true)
    })

    it('skips the whole step when the step name itself is a dynamic field', () => {
        const report = compute({
            expectedOutputs: { step1: { anything: 'goes' } },
            allowedDynamicFields: ['step1'],
            steps: { step1: stepOutput({ completely: 'different' }) },
        })

        expect(report.steps[0].status).toBe('SKIPPED')
        expect(report.summary.dynamicSkipped).toBe(1)
        expect(isPassingDiffReport(report)).toBe(true)
    })

    it('compares expected array elements by index and ignores extra actual elements', () => {
        const report = compute({
            expectedOutputs: { step1: { ids: [1, 2] } },
            steps: { step1: stepOutput({ ids: [1, 2, 3] }) },
        })

        expect(report.steps[0].status).toBe('MATCH')
        expect(report.summary.matched).toBe(2)
    })

    it('treats null expected values as explicit expectations', () => {
        const report = compute({
            expectedOutputs: { step1: { archivedAt: null } },
            steps: { step1: stepOutput({ archivedAt: null }) },
        })

        expect(report.steps[0].status).toBe('MATCH')
        expect(report.summary.matched).toBe(1)
    })

    it('produces an empty report when no outputs are expected', () => {
        const report = compute({ expectedOutputs: {}, steps: {} })

        expect(report.steps).toHaveLength(0)
        expect(report.summary).toEqual({ matched: 0, mismatched: 0, missing: 0, dynamicSkipped: 0 })
        expect(isPassingDiffReport(report)).toBe(true)
    })
})
