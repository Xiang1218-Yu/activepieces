import { ApId, BaseModelSchema, DateOrString, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import { formErrors } from '../../form-errors'
import { CHAT_BYOK_CREDIT_WEIGHT, CHAT_CREDITS_PER_TOOL_CALL } from './index'

const MAX_EVAL_SUITE_NAME_LENGTH = 200
const MAX_EVAL_CASE_NAME_LENGTH = 200
const MAX_EVAL_MESSAGE_LENGTH = 51_200
const MAX_EVAL_EXPECTED_OUTPUT_LENGTH = 10_000
const MAX_EVAL_VARIABLES_PER_SUITE = 50
const MAX_EVAL_VARIABLE_NAME_LENGTH = 100
const MAX_EVAL_VARIABLE_VALUE_LENGTH = 10_000
const MAX_EVAL_VARIABLES_BYTES = 128_000

export const MAX_EVAL_CASES_PER_SUITE = 200
export const MAX_EVAL_RUNS_LIST_LIMIT = 100
export const DEFAULT_EVAL_CONCURRENCY = 3
export const MAX_EVAL_CONCURRENCY = 10
export const DEFAULT_EVAL_CASE_TIMEOUT_MS = 3 * 60 * 1_000
export const MAX_EVAL_CASE_TIMEOUT_MS = 15 * 60 * 1_000

export enum AgentEvalAgentVersion {
    DRAFT = 'DRAFT',
    PUBLISHED = 'PUBLISHED',
}

// DRY: tools are stubbed, real connections and files are never touched. LIVE: tools execute
// against the project's real connections (opt-in per run, never the default).
export enum AgentEvalToolExecution {
    DRY = 'DRY',
    LIVE = 'LIVE',
}

export enum AgentEvalRunStatus {
    RUNNING = 'RUNNING',
    COMPLETED = 'COMPLETED',
    BUDGET_EXHAUSTED = 'BUDGET_EXHAUSTED',
    FAILED = 'FAILED',
}

export enum AgentEvalCaseStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    NEEDS_APPROVAL = 'NEEDS_APPROVAL',
    TIMEOUT = 'TIMEOUT',
    SKIPPED = 'SKIPPED',
}

const EvalVariableName = z.string().min(1).max(MAX_EVAL_VARIABLE_NAME_LENGTH).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, formErrors.invalidVariableName)

export const AgentEvalSuite = z.object({
    ...BaseModelSchema,
    projectId: ApId,
    agentId: ApId,
    name: z.string(),
    description: Nullable(z.string()),
    variableNames: z.array(z.string()),
})
export type AgentEvalSuite = z.infer<typeof AgentEvalSuite>

export const AgentEvalCase = z.object({
    ...BaseModelSchema,
    suiteId: ApId,
    name: z.string(),
    messageTemplate: z.string(),
    variables: z.record(z.string(), z.string()),
    expectedOutput: Nullable(z.string()),
    sortOrder: z.number(),
})
export type AgentEvalCase = z.infer<typeof AgentEvalCase>

export const AgentEvalRunTotals = z.object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    needsApproval: z.number().int().nonnegative(),
    timedOut: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    creditsUsed: z.number().nonnegative(),
})
export type AgentEvalRunTotals = z.infer<typeof AgentEvalRunTotals>

export const emptyAgentEvalRunTotals = (total: number): AgentEvalRunTotals => ({
    total,
    pending: total,
    running: 0,
    succeeded: 0,
    failed: 0,
    needsApproval: 0,
    timedOut: 0,
    skipped: 0,
    creditsUsed: 0,
})

export const AgentEvalRun = z.object({
    ...BaseModelSchema,
    projectId: ApId,
    suiteId: ApId,
    agentId: ApId,
    createdByUserId: ApId,
    agentVersion: z.enum(AgentEvalAgentVersion),
    modelName: Nullable(z.string()),
    toolExecution: z.enum(AgentEvalToolExecution),
    status: z.enum(AgentEvalRunStatus),
    maxConcurrency: z.number().int().positive(),
    maxCostCredits: Nullable(z.number()),
    caseTimeoutMs: z.number().int().positive(),
    totals: AgentEvalRunTotals,
    error: Nullable(z.string()),
    startedAt: Nullable(DateOrString),
    finishedAt: Nullable(DateOrString),
})
export type AgentEvalRun = z.infer<typeof AgentEvalRun>

export enum AgentEvalToolCallStatus {
    COMPLETED = 'completed',
    ERROR = 'error',
    DRY_RUN = 'dry-run',
    AWAITING_APPROVAL = 'awaiting-approval',
}

export const AgentEvalToolCallRecord = z.object({
    toolName: z.string(),
    title: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    output: z.unknown().optional(),
    status: z.enum(AgentEvalToolCallStatus),
    errorText: z.string().optional(),
})
export type AgentEvalToolCallRecord = z.infer<typeof AgentEvalToolCallRecord>

export const AgentEvalCaseResult = z.object({
    ...BaseModelSchema,
    runId: ApId,
    caseId: ApId,
    caseName: z.string(),
    status: z.enum(AgentEvalCaseStatus),
    renderedMessage: z.string(),
    toolCalls: z.array(AgentEvalToolCallRecord),
    creditsUsed: z.number().nonnegative(),
    output: Nullable(z.string()),
    error: Nullable(z.string()),
    durationMs: Nullable(z.number()),
    conversationId: Nullable(z.string()),
    startedAt: Nullable(DateOrString),
    finishedAt: Nullable(DateOrString),
})
export type AgentEvalCaseResult = z.infer<typeof AgentEvalCaseResult>

export const CreateAgentEvalSuiteRequest = z.object({
    agentId: ApId,
    name: z.string().min(1, formErrors.required).max(MAX_EVAL_SUITE_NAME_LENGTH),
    description: z.string().max(2_000).optional(),
    variableNames: z.array(EvalVariableName).max(MAX_EVAL_VARIABLES_PER_SUITE).optional(),
})
export type CreateAgentEvalSuiteRequest = z.infer<typeof CreateAgentEvalSuiteRequest>

export const UpdateAgentEvalSuiteRequest = z.object({
    name: z.string().min(1).max(MAX_EVAL_SUITE_NAME_LENGTH).optional(),
    description: Nullable(z.string().max(2_000)),
    variableNames: z.array(EvalVariableName).max(MAX_EVAL_VARIABLES_PER_SUITE).optional(),
})
export type UpdateAgentEvalSuiteRequest = z.infer<typeof UpdateAgentEvalSuiteRequest>

export const UpsertAgentEvalCaseRequest = z.object({
    name: z.string().min(1, formErrors.required).max(MAX_EVAL_CASE_NAME_LENGTH),
    messageTemplate: z.string().min(1, formErrors.required).max(MAX_EVAL_MESSAGE_LENGTH),
    variables: z.record(z.string(), z.string().max(MAX_EVAL_VARIABLE_VALUE_LENGTH)).default({}),
    expectedOutput: Nullable(z.string().max(MAX_EVAL_EXPECTED_OUTPUT_LENGTH)),
    sortOrder: z.number().int().nonnegative().optional(),
}).superRefine((request, ctx) => {
    if (JSON.stringify(request.variables).length > MAX_EVAL_VARIABLES_BYTES) {
        ctx.addIssue({ code: 'custom', message: formErrors.evalVariablesTooLarge })
    }
})
export type UpsertAgentEvalCaseRequest = z.infer<typeof UpsertAgentEvalCaseRequest>

export const CreateAgentEvalRunRequest = z.object({
    suiteId: ApId,
    agentVersion: z.enum(AgentEvalAgentVersion),
    modelName: z.string().max(200).nullish(),
    toolExecution: z.enum(AgentEvalToolExecution).default(AgentEvalToolExecution.DRY),
    maxConcurrency: z.number().int().positive().max(MAX_EVAL_CONCURRENCY).default(DEFAULT_EVAL_CONCURRENCY),
    maxCostCredits: z.number().positive().nullish(),
    caseTimeoutMs: z.number().int().positive().max(MAX_EVAL_CASE_TIMEOUT_MS).default(DEFAULT_EVAL_CASE_TIMEOUT_MS),
})
export type CreateAgentEvalRunRequest = z.infer<typeof CreateAgentEvalRunRequest>

export enum AgentEvalResultSortBy {
    STATUS = 'status',
    COST = 'cost',
    DURATION = 'duration',
    NAME = 'name',
}

export const ListAgentEvalCaseResultsRequest = z.object({
    sortBy: z.enum(AgentEvalResultSortBy).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    status: z.enum(AgentEvalCaseStatus).optional(),
})
export type ListAgentEvalCaseResultsRequest = z.infer<typeof ListAgentEvalCaseResultsRequest>

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

export const agentEvalUtils = {
    extractVariables(template: string): string[] {
        const names = new Set<string>()
        for (const match of template.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
            names.add(match[1])
        }
        return [...names]
    },
    render(template: string, variables: Record<string, string>): string {
        return template.replace(TEMPLATE_VARIABLE_PATTERN, (_raw, name: string) => variables[name] ?? '')
    },
    // Estimated credits for one case: the model turn always costs the base weight, each
    // completed tool call adds its weight. Dry-run tool calls are stubbed and stay free.
    estimateCredits(completedToolCalls: number): number {
        return CHAT_BYOK_CREDIT_WEIGHT + completedToolCalls * CHAT_CREDITS_PER_TOOL_CALL
    },
    isTerminalCaseStatus(status: AgentEvalCaseStatus): boolean {
        return ![AgentEvalCaseStatus.PENDING, AgentEvalCaseStatus.RUNNING].includes(status)
    },
}
