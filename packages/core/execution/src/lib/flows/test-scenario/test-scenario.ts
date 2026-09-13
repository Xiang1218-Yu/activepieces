import { z } from 'zod'
import { ApId, BaseModelSchema, Nullable } from '@activepieces/core-utils'

export const FLOW_TEST_SCENARIO_NAME_MAX_LENGTH = 200
export const FLOW_TEST_SCENARIO_MAX_DYNAMIC_FIELDS = 500
export const FLOW_TEST_SCENARIO_MAX_INPUT_FILES = 20

/**
 * How a test scenario treats app connections (and the external side effects
 * that go through them) during execution:
 * - MOCK: connections listed in `connectionMocks` resolve to the provided
 *   mock value instead of the real stored credential.
 * - BLOCK: any attempt to resolve a connection fails the run explicitly, so
 *   no external side effect can happen through a connection.
 */
export enum FlowTestScenarioConnectionStrategy {
    MOCK = 'MOCK',
    BLOCK = 'BLOCK',
}

export enum FlowTestScenarioRunStatus {
    /** The isolated test run is queued or still executing. */
    PENDING = 'PENDING',
    /** The run finished and every expected key output matched. */
    PASSED = 'PASSED',
    /** The run finished but at least one expected key output did not match. */
    FAILED = 'FAILED',
    /** The underlying flow run itself did not finish successfully. */
    ERROR = 'ERROR',
    /** Execution was blocked by the connection strategy before running. */
    BLOCKED = 'BLOCKED',
    /** The scenario cannot be executed (e.g. missing input files). */
    NOT_EXECUTABLE = 'NOT_EXECUTABLE',
}

/**
 * Structural snapshot of the bound flow version, captured when the scenario
 * is (re)bound. The scenario always executes against the pinned
 * `flowVersionId`; this snapshot documents the structure that was bound so
 * publishing the flow later never silently re-points the scenario.
 */
export const FlowTestScenarioVersionSnapshot = z.object({
    displayName: z.string(),
    schemaVersion: Nullable(z.string()),
    state: z.string(),
    valid: z.boolean(),
})
export type FlowTestScenarioVersionSnapshot = z.infer<typeof FlowTestScenarioVersionSnapshot>

export const FlowTestScenario = z.object({
    ...BaseModelSchema,
    projectId: ApId,
    flowId: ApId,
    flowVersionId: ApId,
    name: z.string(),
    description: Nullable(z.string()),
    /** Fixed trigger payload used to start the isolated test run. */
    triggerInput: z.unknown(),
    /** Files (FileType.FLOW_TEST_SCENARIO_INPUT) referenced by the trigger input. */
    inputFileIds: z.array(z.string()),
    /** Expected key outputs per step name; matched as a deep subset. */
    expectedOutputs: z.record(z.string(), z.unknown()),
    /**
     * Dot-separated paths ("stepName" or "stepName.path.to.field", `*`
     * matches a single segment) excluded from comparison because their
     * values are dynamic (timestamps, generated ids, ...).
     */
    allowedDynamicFields: z.array(z.string()),
    connectionStrategy: z.nativeEnum(FlowTestScenarioConnectionStrategy),
    /** Mock connection values keyed by connection external id. */
    connectionMocks: z.record(z.string(), z.unknown()),
    versionSnapshot: FlowTestScenarioVersionSnapshot,
})
export type FlowTestScenario = z.infer<typeof FlowTestScenario>

export const FlowTestScenarioFieldDiffStatus = z.enum(['MATCH', 'MISMATCH', 'MISSING', 'DYNAMIC_SKIPPED'])
export type FlowTestScenarioFieldDiffStatus = z.infer<typeof FlowTestScenarioFieldDiffStatus>

export const FlowTestScenarioFieldDiff = z.object({
    path: z.string(),
    status: FlowTestScenarioFieldDiffStatus,
    expected: z.unknown().optional(),
    actual: z.unknown().optional(),
})
export type FlowTestScenarioFieldDiff = z.infer<typeof FlowTestScenarioFieldDiff>

export const FlowTestScenarioStepDiffStatus = z.enum(['MATCH', 'MISMATCH', 'MISSING_STEP', 'SKIPPED'])
export type FlowTestScenarioStepDiffStatus = z.infer<typeof FlowTestScenarioStepDiffStatus>

export const FlowTestScenarioStepDiff = z.object({
    stepName: z.string(),
    status: FlowTestScenarioStepDiffStatus,
    fields: z.array(FlowTestScenarioFieldDiff),
})
export type FlowTestScenarioStepDiff = z.infer<typeof FlowTestScenarioStepDiff>

export const FlowTestScenarioDiffReport = z.object({
    generatedAt: z.string(),
    flowRunStatus: z.string(),
    summary: z.object({
        matched: z.number(),
        mismatched: z.number(),
        missing: z.number(),
        dynamicSkipped: z.number(),
    }),
    steps: z.array(FlowTestScenarioStepDiff),
})
export type FlowTestScenarioDiffReport = z.infer<typeof FlowTestScenarioDiffReport>

export const FlowTestScenarioRun = z.object({
    ...BaseModelSchema,
    projectId: ApId,
    scenarioId: ApId,
    flowId: ApId,
    flowVersionId: ApId,
    /** The isolated flow run (RunEnvironment.TESTING), null when nothing was enqueued. */
    flowRunId: Nullable(ApId),
    status: z.nativeEnum(FlowTestScenarioRunStatus),
    failureReason: Nullable(z.string()),
    diffReport: Nullable(FlowTestScenarioDiffReport),
    triggeredBy: Nullable(z.string()),
})
export type FlowTestScenarioRun = z.infer<typeof FlowTestScenarioRun>

export const CreateFlowTestScenarioRequest = z.object({
    projectId: ApId,
    flowId: ApId,
    flowVersionId: ApId,
    name: z.string().min(1).max(FLOW_TEST_SCENARIO_NAME_MAX_LENGTH),
    description: z.string().max(2000).optional(),
    triggerInput: z.unknown().optional(),
    inputFileIds: z.array(z.string()).max(FLOW_TEST_SCENARIO_MAX_INPUT_FILES).optional(),
    expectedOutputs: z.record(z.string(), z.unknown()).optional(),
    allowedDynamicFields: z.array(z.string().min(1)).max(FLOW_TEST_SCENARIO_MAX_DYNAMIC_FIELDS).optional(),
    connectionStrategy: z.nativeEnum(FlowTestScenarioConnectionStrategy).optional(),
    connectionMocks: z.record(z.string(), z.unknown()).optional(),
})
export type CreateFlowTestScenarioRequest = z.infer<typeof CreateFlowTestScenarioRequest>

export const UpdateFlowTestScenarioRequest = z.object({
    name: z.string().min(1).max(FLOW_TEST_SCENARIO_NAME_MAX_LENGTH).optional(),
    description: Nullable(z.string().max(2000)),
    /** Explicit rebind to another version of the same flow; re-snapshots the structure. */
    flowVersionId: z.optional(ApId),
    triggerInput: z.unknown().optional(),
    inputFileIds: z.array(z.string()).max(FLOW_TEST_SCENARIO_MAX_INPUT_FILES).optional(),
    expectedOutputs: z.record(z.string(), z.unknown()).optional(),
    allowedDynamicFields: z.array(z.string().min(1)).max(FLOW_TEST_SCENARIO_MAX_DYNAMIC_FIELDS).optional(),
    connectionStrategy: z.nativeEnum(FlowTestScenarioConnectionStrategy).optional(),
    connectionMocks: z.record(z.string(), z.unknown()).optional(),
})
export type UpdateFlowTestScenarioRequest = z.infer<typeof UpdateFlowTestScenarioRequest>

export const ListFlowTestScenariosRequest = z.object({
    projectId: ApId,
    flowId: ApId,
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
})
export type ListFlowTestScenariosRequest = z.infer<typeof ListFlowTestScenariosRequest>

export const ListFlowTestScenarioRunsRequest = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
})
export type ListFlowTestScenarioRunsRequest = z.infer<typeof ListFlowTestScenarioRunsRequest>

/** Read model: scenario plus its computed executability. */
export const FlowTestScenarioWithExecutability = FlowTestScenario.extend({
    executable: z.boolean(),
    missingInputFileIds: z.array(z.string()),
})
export type FlowTestScenarioWithExecutability = z.infer<typeof FlowTestScenarioWithExecutability>
