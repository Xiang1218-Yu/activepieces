import { ActivepiecesError, apId, ErrorCode, isNil } from '@activepieces/core-utils'
import {
    Agent,
    AgentConfig,
    AgentConversationStatus,
    AgentEvalAgentVersion,
    AgentEvalCase,
    AgentEvalCaseResult,
    AgentEvalCaseStatus,
    AgentEvalResultSortBy,
    AgentEvalRun,
    AgentEvalRunStatus,
    AgentEvalRunTotals,
    AgentEvalToolCallRecord,
    AgentEvalToolCallStatus,
    AgentEvalToolExecution,
    agentEvalUtils,
    AgentRunSource,
    agentToolClassification,
    CreateAgentEvalRunRequest,
    emptyAgentEvalRunTotals,
    LATEST_JOB_DATA_SCHEMA_VERSION,
    ListAgentEvalCaseResultsRequest,
    MAX_EVAL_RUNS_LIST_LIMIT,
    PersistedAgentMessage,
    PersistedAgentPartType,
    PersistedAgentRole,
    PersistedToolCallStatus,
    WorkerJobType,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { QueryDeepPartialEntity } from 'typeorm'
import { repoFactory } from '../../../core/db/repo-factory'
import { jobQueue, JobType } from '../../../workers/job-queue/job-queue'
import { agentApprovalGate } from '../agent-approval-gate'
import { agentConversationService } from '../agent-conversation-service'
import { agentHelpers, EVAL_CONVERSATION_ID_PREFIX } from '../agent-helpers'
import { agentRepo, agentService } from '../agent-service'
import { AgentEvalCaseEntity, AgentEvalCaseResultEntity, AgentEvalCaseResultWithRelations, AgentEvalRunEntity } from './agent-eval-entities'
import { agentEvalSuiteService } from './agent-eval-suite-service'

const POLL_INTERVAL_MS = 1_500
// Poll a little past the case deadline before declaring a timeout: a turn that finished just
// after the last check still gets observed instead of being cut off mid-write.
const CANCEL_GRACE_MS = 10_000

const runRepo = repoFactory(AgentEvalRunEntity)
const resultRepo = repoFactory(AgentEvalCaseResultEntity)
const caseRepo = repoFactory(AgentEvalCaseEntity)

export const agentEvalRunService = (log: FastifyBaseLogger) => ({
    async start({ projectId, platformId, userId, request }: StartParams): Promise<AgentEvalRun> {
        const suiteService = agentEvalSuiteService(log)
        const suite = await suiteService.getOneOrThrow({ id: request.suiteId, projectId })
        const agent = await agentService(log).getOneOrThrow({ id: suite.agentId, projectId, userId })
        const config = configForVersion({ agent, version: request.agentVersion })
        if (isNil(config)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: request.agentVersion === AgentEvalAgentVersion.PUBLISHED
                    ? 'This agent has no published version yet — publish it or run the draft'
                    : 'This agent has no draft to run' },
            })
        }
        if (isNil(config.provider) || isNil(config.modelName)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'Pick a model for this agent before running evals' },
            })
        }
        const cases = await suiteService.listCases({ suiteId: suite.id, projectId })
        if (cases.length === 0) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'Add at least one test case to this suite before running it' },
            })
        }

        const run = await runRepo().save({
            id: apId(),
            projectId,
            suiteId: suite.id,
            agentId: suite.agentId,
            createdByUserId: userId,
            agentVersion: request.agentVersion,
            modelName: request.modelName ?? null,
            toolExecution: request.toolExecution,
            status: AgentEvalRunStatus.RUNNING,
            maxConcurrency: request.maxConcurrency,
            maxCostCredits: request.maxCostCredits ?? null,
            caseTimeoutMs: request.caseTimeoutMs,
            totals: emptyAgentEvalRunTotals(cases.length),
            error: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
        })
        for (const evalCase of cases) {
            await resultRepo().save({
                id: apId(),
                runId: run.id,
                caseId: evalCase.id,
                caseName: evalCase.name,
                status: AgentEvalCaseStatus.PENDING,
                renderedMessage: agentEvalUtils.render(evalCase.messageTemplate, evalCase.variables),
                toolCalls: [],
                creditsUsed: 0,
                output: null,
                error: null,
                durationMs: null,
                conversationId: null,
                startedAt: null,
                finishedAt: null,
            })
        }

        // Fire-and-forget: the batch runs in the background; the run row is the progress handle.
        void executeRun({ runId: run.id, platformId, log }).catch(async (error) => {
            log.error({ error, run: { id: run.id } }, '[agentEvalRun] Batch crashed')
            await runRepo().update({ id: run.id }, {
                status: AgentEvalRunStatus.FAILED,
                error: error instanceof Error ? error.message : String(error),
                finishedAt: new Date().toISOString(),
            })
            await refreshRunTotals({ runId: run.id, log })
        })
        return run
    },

    async getOneOrThrow({ id, projectId }: GetRunParams): Promise<AgentEvalRun> {
        const run = await runRepo().findOneBy({ id, projectId })
        if (isNil(run)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityId: id, entityType: 'AgentEvalRun' },
            })
        }
        return run
    },

    async list({ projectId, suiteId }: ListRunsParams): Promise<AgentEvalRun[]> {
        return runRepo().find({
            where: {
                projectId,
                ...(isNil(suiteId) ? {} : { suiteId }),
            },
            order: { created: 'DESC' },
            take: MAX_EVAL_RUNS_LIST_LIMIT,
        })
    },

    async listResults({ runId, projectId, request }: ListResultsParams): Promise<AgentEvalCaseResult[]> {
        await this.getOneOrThrow({ id: runId, projectId })
        const sortBy = request.sortBy ?? AgentEvalResultSortBy.STATUS
        const sortOrder = (request.sortOrder ?? 'asc').toUpperCase() as 'ASC' | 'DESC'
        const query = resultRepo().createQueryBuilder('result')
            .where('result."runId" = :runId', { runId })
        if (!isNil(request.status)) {
            query.andWhere('result.status = :status', { status: request.status })
        }
        switch (sortBy) {
            case AgentEvalResultSortBy.STATUS:
                // Bucket order: success, failed, needs approval, timed out, still going, skipped.
                query.addSelect(`CASE result.status
                    WHEN '${AgentEvalCaseStatus.SUCCESS}' THEN 0
                    WHEN '${AgentEvalCaseStatus.FAILED}' THEN 1
                    WHEN '${AgentEvalCaseStatus.NEEDS_APPROVAL}' THEN 2
                    WHEN '${AgentEvalCaseStatus.TIMEOUT}' THEN 3
                    WHEN '${AgentEvalCaseStatus.RUNNING}' THEN 4
                    WHEN '${AgentEvalCaseStatus.PENDING}' THEN 5
                    ELSE 6 END`, 'result_status_rank')
                    .orderBy('result_status_rank', sortOrder)
                    .addOrderBy('result."caseName"', 'ASC')
                break
            case AgentEvalResultSortBy.COST:
                query.orderBy('result."creditsUsed"', sortOrder).addOrderBy('result."caseName"', 'ASC')
                break
            case AgentEvalResultSortBy.DURATION:
                query.orderBy('result."durationMs"', sortOrder, 'NULLS LAST').addOrderBy('result."caseName"', 'ASC')
                break
            case AgentEvalResultSortBy.NAME:
                query.orderBy('result."caseName"', sortOrder)
                break
        }
        return query.getMany()
    },
})

async function executeRun({ runId, platformId, log }: { runId: string, platformId: string, log: FastifyBaseLogger }): Promise<void> {
    const run = await runRepo().findOneBy({ id: runId })
    if (isNil(run)) {
        return
    }
    const agent = await agentRepo().findOneBy({ id: run.agentId })
    const config = isNil(agent) ? null : configForVersion({ agent, version: run.agentVersion })
    const cases = await caseRepo().find({ where: { suiteId: run.suiteId }, order: { sortOrder: 'ASC', created: 'ASC' } })
    const results = await resultRepo().findBy({ runId })
    const resultIdByCaseId = new Map(results.map((result) => [result.caseId, result.id]))

    // Credits accumulate in this process only, so a local counter is the budget source of truth;
    // it is conservative (never undercounts) because every finished case adds before the next check.
    let creditsUsed = 0
    let budgetExhausted = false
    let nextIndex = 0

    const workerCount = Math.max(1, Math.min(run.maxConcurrency, cases.length))
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < cases.length) {
            const evalCase = cases[nextIndex]
            nextIndex += 1
            const resultId = resultIdByCaseId.get(evalCase.id)
            if (isNil(resultId)) {
                continue
            }
            if (budgetExhausted || (!isNil(run.maxCostCredits) && creditsUsed >= run.maxCostCredits)) {
                budgetExhausted = true
                await resultRepo().update({ id: resultId }, {
                    status: AgentEvalCaseStatus.SKIPPED,
                    error: `Skipped: the run reached its budget of ${run.maxCostCredits} credits`,
                    finishedAt: new Date().toISOString(),
                })
                await refreshRunTotals({ runId, log })
                continue
            }
            if (isNil(config)) {
                await resultRepo().update({ id: resultId }, {
                    status: AgentEvalCaseStatus.FAILED,
                    error: 'The agent (or the version selected for this run) no longer exists',
                    finishedAt: new Date().toISOString(),
                })
                await refreshRunTotals({ runId, log })
                continue
            }
            const credits = await executeCase({ run, evalCase, resultId, config, platformId, log }).catch(async (error) => {
                log.error({ error, case: { id: evalCase.id }, run: { id: runId } }, '[agentEvalRun] Case crashed')
                await resultRepo().update({ id: resultId }, {
                    status: AgentEvalCaseStatus.FAILED,
                    error: error instanceof Error ? error.message : String(error),
                    finishedAt: new Date().toISOString(),
                })
                return 0
            })
            creditsUsed += credits
            await refreshRunTotals({ runId, log })
        }
    })
    await Promise.all(workers)

    await refreshRunTotals({ runId, log })
    await runRepo().update({ id: runId }, {
        status: budgetExhausted ? AgentEvalRunStatus.BUDGET_EXHAUSTED : AgentEvalRunStatus.COMPLETED,
        finishedAt: new Date().toISOString(),
    })
}

// Returns the credits this case consumed (fed into the run budget).
async function executeCase({ run, evalCase, resultId, config, platformId, log }: ExecuteCaseParams): Promise<number> {
    const startedAt = Date.now()
    const renderedMessage = agentEvalUtils.render(evalCase.messageTemplate, evalCase.variables)
    await resultRepo().update({ id: resultId }, {
        status: AgentEvalCaseStatus.RUNNING,
        renderedMessage,
        startedAt: new Date().toISOString(),
    })

    // Eval conversations carry the evalconv prefix, which keeps them — and every file or
    // connection reference they produce — out of the production conversation lists.
    const conversation = await agentConversationService(log).createConversation({
        platformId,
        userId: run.createdByUserId,
        request: { agentId: run.agentId, projectId: run.projectId },
        id: (EVAL_CONVERSATION_ID_PREFIX + apId()).slice(0, 21),
    })
    const jobRunId = apId()
    await resultRepo().update({ id: resultId }, { conversationId: conversation.id })

    const dryRun = run.toolExecution === AgentEvalToolExecution.DRY
    await jobQueue(log).add({
        id: apId(),
        type: JobType.ONE_TIME,
        data: {
            schemaVersion: LATEST_JOB_DATA_SCHEMA_VERSION,
            jobType: WorkerJobType.EXECUTE_AGENT_RUN,
            conversationId: conversation.id,
            runId: jobRunId,
            projectId: run.projectId,
            platformId,
            userId: run.createdByUserId,
            userMessage: renderedMessage,
            modelName: run.modelName ?? config.modelName ?? null,
            source: AgentRunSource.AGENT,
            tools: config.tools,
            structuredOutput: config.structuredOutput,
            maxSteps: config.maxSteps,
            ...(isNil(config.provider) ? {} : { provider: config.provider }),
            ...(isNil(config.providerConfigId) ? {} : { providerConfigId: config.providerConfigId }),
            promptOverride: { system: config.instructions },
            dryRun,
        },
    })

    const deadline = startedAt + run.caseTimeoutMs
    let outcome: CaseOutcome | null = null
    while (Date.now() < deadline + CANCEL_GRACE_MS) {
        await sleep(POLL_INTERVAL_MS)
        // Read the row directly (not getConversationOrThrow, which resets stale STREAMING rows),
        // so the poller stays a pure observer.
        const conversationState = await agentHelpers.conversationRepo().findOneBy({ id: conversation.id })
        if (isNil(conversationState)) {
            outcome = { status: AgentEvalCaseStatus.FAILED, error: 'The eval conversation was deleted mid-run', uiMessages: [] }
            break
        }
        // A case waiting on a human must not hold its pool slot: deny the gate, cancel the turn,
        // and bucket the case as NEEDS_APPROVAL so the batch moves on. Only live runs pend real
        // gates — dry runs auto-approve in the worker, and their stale gate entries (kept for the
        // gate TTL) must not be mistaken for a wait.
        if (!dryRun) {
            const pendingGates = await agentApprovalGate.getPendingGates({ conversationId: conversation.id })
            if (pendingGates.length > 0) {
                for (const gate of pendingGates) {
                    await agentApprovalGate.resolveGate({ gateId: gate.gateId, approved: false, log })
                }
                await agentApprovalGate.requestCancel({ conversationId: conversation.id, runId: jobRunId })
                outcome = {
                    status: AgentEvalCaseStatus.NEEDS_APPROVAL,
                    error: `Needs a human to approve: ${pendingGates.map((gate) => gate.displayName).join(', ')}`,
                    uiMessages: (conversationState.uiMessages ?? []) as PersistedAgentMessage[],
                    pendingGateToolNames: pendingGates.map((gate) => gate.toolName),
                }
                break
            }
        }
        if (conversationState.status === AgentConversationStatus.ERROR) {
            outcome = { status: AgentEvalCaseStatus.FAILED, error: 'The agent turn ended in an error', uiMessages: (conversationState.uiMessages ?? []) as PersistedAgentMessage[] }
            break
        }
        if (conversationState.status === AgentConversationStatus.IDLE && countAssistantTurns(conversationState.uiMessages) > 0) {
            const uiMessages = (conversationState.uiMessages ?? []) as PersistedAgentMessage[]
            outcome = { status: outcomeStatusForSettledTurn({ uiMessages, dryRun }), error: null, uiMessages }
            break
        }
    }

    if (isNil(outcome)) {
        await agentApprovalGate.requestCancel({ conversationId: conversation.id, runId: jobRunId })
        outcome = { status: AgentEvalCaseStatus.TIMEOUT, error: `Did not finish within ${Math.round(run.caseTimeoutMs / 1000)}s`, uiMessages: [] }
    }

    const toolCalls = extractToolCalls(outcome.uiMessages, dryRun, outcome.pendingGateToolNames ?? [])
    const output = extractFinalText(outcome.uiMessages)
    const creditsUsed = agentEvalUtils.estimateCredits(toolCalls.length)
    await resultRepo().update({ id: resultId }, {
        status: outcome.status,
        toolCalls,
        creditsUsed,
        output,
        error: outcome.error,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date().toISOString(),
    } as QueryDeepPartialEntity<AgentEvalCaseResultWithRelations>)
    return creditsUsed
}

// Dry runs never pend a real gate, so derive the approval bucket from what the agent tried to do:
// any write-classified tool call would have asked a human before going live.
function outcomeStatusForSettledTurn({ uiMessages, dryRun }: { uiMessages: PersistedAgentMessage[], dryRun: boolean }): AgentEvalCaseStatus {
    if (!dryRun) {
        return AgentEvalCaseStatus.SUCCESS
    }
    const wouldNeedApproval = uiMessages.some((message) =>
        message.role === PersistedAgentRole.ASSISTANT && message.parts.some((part) =>
            part.type === PersistedAgentPartType.TOOL_CALL
            && agentToolClassification.requiresActionPreview({ actionName: part.toolName, input: part.input, needsConfirmation: false, tainted: false }),
        ),
    )
    return wouldNeedApproval ? AgentEvalCaseStatus.NEEDS_APPROVAL : AgentEvalCaseStatus.SUCCESS
}

function extractToolCalls(uiMessages: PersistedAgentMessage[], dryRun: boolean, pendingGateToolNames: string[]): AgentEvalToolCallRecord[] {
    const records: AgentEvalToolCallRecord[] = []
    for (const message of uiMessages) {
        if (message.role !== PersistedAgentRole.ASSISTANT) {
            continue
        }
        for (const part of message.parts) {
            if (part.type !== PersistedAgentPartType.TOOL_CALL) {
                continue
            }
            records.push({
                toolName: part.toolName,
                ...('title' in part && typeof part.title === 'string' ? { title: part.title } : {}),
                input: part.input,
                output: part.output,
                status: dryRun
                    ? AgentEvalToolCallStatus.DRY_RUN
                    : part.status === PersistedToolCallStatus.ERROR ? AgentEvalToolCallStatus.ERROR : AgentEvalToolCallStatus.COMPLETED,
                ...(typeof part.errorText === 'string' ? { errorText: part.errorText } : {}),
            })
        }
    }
    for (const toolName of pendingGateToolNames) {
        records.push({ toolName, status: AgentEvalToolCallStatus.AWAITING_APPROVAL })
    }
    return records
}

function extractFinalText(uiMessages: PersistedAgentMessage[]): string | null {
    const lastAssistant = [...uiMessages].reverse().find((message) => message.role === PersistedAgentRole.ASSISTANT)
    if (isNil(lastAssistant)) {
        return null
    }
    const text = lastAssistant.parts
        .filter((part) => part.type === PersistedAgentPartType.TEXT)
        .map((part) => part.text)
        .join('\n')
        .trim()
    return text.length > 0 ? text : null
}

function countAssistantTurns(uiMessages: unknown[] | null): number {
    return (uiMessages ?? []).filter((message) =>
        typeof message === 'object' && message !== null && 'role' in message && message.role === PersistedAgentRole.ASSISTANT,
    ).length
}

// Totals are recomputed from the results table after every case, so concurrent case workers can
// never lose each other's increments.
async function refreshRunTotals({ runId, log }: { runId: string, log: FastifyBaseLogger }): Promise<void> {
    const rows = await resultRepo().createQueryBuilder('result')
        .select('result.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(result."creditsUsed"), 0)', 'credits')
        .where('result."runId" = :runId', { runId })
        .groupBy('result.status')
        .getRawMany<{ status: AgentEvalCaseStatus, count: string, credits: string }>()
    const totals: AgentEvalRunTotals = emptyAgentEvalRunTotals(0)
    for (const row of rows) {
        const count = Number(row.count)
        totals.total += count
        totals.creditsUsed += Number(row.credits)
        switch (row.status) {
            case AgentEvalCaseStatus.PENDING:
                totals.pending += count
                break
            case AgentEvalCaseStatus.RUNNING:
                totals.running += count
                break
            case AgentEvalCaseStatus.SUCCESS:
                totals.succeeded += count
                break
            case AgentEvalCaseStatus.FAILED:
                totals.failed += count
                break
            case AgentEvalCaseStatus.NEEDS_APPROVAL:
                totals.needsApproval += count
                break
            case AgentEvalCaseStatus.TIMEOUT:
                totals.timedOut += count
                break
            case AgentEvalCaseStatus.SKIPPED:
                totals.skipped += count
                break
        }
    }
    totals.creditsUsed = Math.round(totals.creditsUsed * 1000) / 1000
    await runRepo().update({ id: runId }, { totals })
    log.debug({ run: { id: runId }, totals }, '[agentEvalRun] Totals refreshed')
}

function configForVersion({ agent, version }: { agent: Agent, version: AgentEvalAgentVersion }): AgentConfig | null {
    const config = version === AgentEvalAgentVersion.PUBLISHED ? agent.published : agent.draft
    return config ?? null
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

type CaseOutcome = {
    status: AgentEvalCaseStatus
    error: string | null
    uiMessages: PersistedAgentMessage[]
    pendingGateToolNames?: string[]
}

type StartParams = {
    projectId: string
    platformId: string
    userId: string
    request: CreateAgentEvalRunRequest
}

type GetRunParams = {
    id: string
    projectId: string
}

type ListRunsParams = {
    projectId: string
    suiteId?: string
}

type ListResultsParams = {
    runId: string
    projectId: string
    request: ListAgentEvalCaseResultsRequest
}

type ExecuteCaseParams = {
    run: AgentEvalRun
    evalCase: AgentEvalCase
    resultId: string
    config: AgentConfig
    platformId: string
    log: FastifyBaseLogger
}
