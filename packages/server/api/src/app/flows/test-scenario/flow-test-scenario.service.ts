import { ActivepiecesError, apId, Cursor, ErrorCode, FlowId, isNil, ProjectId, SeekPage } from '@activepieces/core-utils'
import {
    computeFlowTestScenarioDiff,
    CreateFlowTestScenarioRequest,
    FileType,
    FlowRunStatus,
    FlowTestScenario,
    FlowTestScenarioConnectionStrategy,
    FlowTestScenarioRun,
    FlowTestScenarioRunStatus,
    FlowTestScenarioVersionSnapshot,
    FlowTestScenarioWithExecutability,
    FlowVersion,
    isFlowRunStateTerminal,
    isPassingDiffReport,
    UpdateFlowTestScenarioRequest,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../core/db/repo-factory'
import { fileService } from '../../file/file.service'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { Order } from '../../helper/pagination/paginator'
import { flowService } from '../flow/flow.service'
import { flowRunService } from '../flow-run/flow-run-service'
import { flowVersionService } from '../flow-version/flow-version.service'
import { FlowTestScenarioEntity, FlowTestScenarioRunEntity, FlowTestScenarioRunSchema, FlowTestScenarioSchema } from './flow-test-scenario-entity'

export const flowTestScenarioRepo = repoFactory<FlowTestScenarioSchema>(FlowTestScenarioEntity)
export const flowTestScenarioRunRepo = repoFactory<FlowTestScenarioRunSchema>(FlowTestScenarioRunEntity)

export const flowTestScenarioService = (log: FastifyBaseLogger) => ({
    async create(params: CreateParams): Promise<FlowTestScenarioWithExecutability> {
        const { request, projectId } = params
        await flowService(log).getOneOrThrow({ id: request.flowId, projectId })
        const flowVersion = await flowVersionService(log).getFlowVersionOrThrow({
            flowId: request.flowId,
            versionId: request.flowVersionId,
        })
        const scenario: FlowTestScenario = {
            id: apId(),
            projectId,
            flowId: request.flowId,
            flowVersionId: flowVersion.id,
            name: request.name,
            description: request.description ?? null,
            triggerInput: request.triggerInput ?? {},
            inputFileIds: request.inputFileIds ?? [],
            expectedOutputs: request.expectedOutputs ?? {},
            allowedDynamicFields: request.allowedDynamicFields ?? [],
            connectionStrategy: request.connectionStrategy ?? FlowTestScenarioConnectionStrategy.BLOCK,
            connectionMocks: request.connectionMocks ?? {},
            versionSnapshot: snapshotOf(flowVersion),
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
        }
        const saved = await flowTestScenarioRepo().save(scenario)
        log.info({ scenarioId: saved.id, flowId: saved.flowId, flowVersionId: saved.flowVersionId }, 'Flow test scenario created')
        return this.getOneOrThrow({ id: saved.id, projectId })
    },

    async update(params: UpdateParams): Promise<FlowTestScenarioWithExecutability> {
        const scenario = await this.getRawOneOrThrow({ id: params.id, projectId: params.projectId })
        const { request } = params

        let versionSnapshot = scenario.versionSnapshot
        let flowVersionId = scenario.flowVersionId
        if (!isNil(request.flowVersionId) && request.flowVersionId !== scenario.flowVersionId) {
            // Explicit rebind only: the scenario never follows the latest draft
            // on its own, it keeps reproducing the pinned version structure.
            const flowVersion = await flowVersionService(log).getFlowVersionOrThrow({
                flowId: scenario.flowId,
                versionId: request.flowVersionId,
            })
            flowVersionId = flowVersion.id
            versionSnapshot = snapshotOf(flowVersion)
        }

        const updatedScenario: FlowTestScenario = {
            ...scenario,
            name: request.name ?? scenario.name,
            description: request.description === undefined ? scenario.description : request.description,
            flowVersionId,
            triggerInput: request.triggerInput === undefined ? scenario.triggerInput : request.triggerInput,
            inputFileIds: request.inputFileIds ?? scenario.inputFileIds,
            expectedOutputs: request.expectedOutputs ?? scenario.expectedOutputs,
            allowedDynamicFields: request.allowedDynamicFields ?? scenario.allowedDynamicFields,
            connectionStrategy: request.connectionStrategy ?? scenario.connectionStrategy,
            connectionMocks: request.connectionMocks ?? scenario.connectionMocks,
            versionSnapshot,
        }
        await flowTestScenarioRepo().save(updatedScenario)
        return this.getOneOrThrow({ id: scenario.id, projectId: params.projectId })
    },

    async getOneOrThrow(params: GetOneParams): Promise<FlowTestScenarioWithExecutability> {
        const scenario = await this.getRawOneOrThrow(params)
        return withExecutability(log, scenario)
    },

    async getRawOneOrThrow(params: GetOneParams): Promise<FlowTestScenario> {
        const scenario = await flowTestScenarioRepo().findOneBy({ id: params.id, projectId: params.projectId })
        if (isNil(scenario)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'flow_test_scenario',
                    entityId: params.id,
                    message: 'Flow test scenario not found',
                },
            })
        }
        return scenario
    },

    async list(params: ListParams): Promise<SeekPage<FlowTestScenarioWithExecutability>> {
        const decodedCursor = paginationHelper.decodeCursor(params.cursor)
        const paginator = buildPaginator<FlowTestScenarioSchema>({
            entity: FlowTestScenarioEntity,
            query: {
                limit: params.limit,
                orderBy: [
                    { field: 'created', order: Order.DESC },
                    { field: 'id', order: Order.DESC },
                ],
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        const query = flowTestScenarioRepo().createQueryBuilder('flow_test_scenario').where({
            projectId: params.projectId,
            flowId: params.flowId,
        })
        const { data, cursor } = await paginator.paginate(query)
        const enriched = await Promise.all(data.map((scenario) => withExecutability(log, scenario)))
        return paginationHelper.createPage<FlowTestScenarioWithExecutability>(enriched, cursor)
    },

    async delete(params: GetOneParams): Promise<void> {
        await this.getRawOneOrThrow(params)
        await flowTestScenarioRepo().delete({ id: params.id })
    },

    async execute(params: ExecuteParams): Promise<FlowTestScenarioRun> {
        const scenario = await this.getRawOneOrThrow({ id: params.scenarioId, projectId: params.projectId })
        const executability = await computeExecutability(log, scenario)

        if (!executability.executable) {
            // Missing input files never fail the execution path; the scenario
            // is simply marked as not executable.
            return this.createRunRecord({
                scenario,
                flowRunId: null,
                status: FlowTestScenarioRunStatus.NOT_EXECUTABLE,
                failureReason: `Missing input files: ${executability.missingInputFileIds.join(', ')}`,
                triggeredBy: params.triggeredBy,
            })
        }

        const flowVersion = await flowVersionService(log).getOneOrThrow(scenario.flowVersionId)
        if (scenario.connectionStrategy === FlowTestScenarioConnectionStrategy.BLOCK && flowVersion.connectionIds.length > 0) {
            return this.createRunRecord({
                scenario,
                flowRunId: null,
                status: FlowTestScenarioRunStatus.BLOCKED,
                failureReason: `Connection strategy BLOCK: the pinned flow version uses ${flowVersion.connectionIds.length} connection(s), external side effects are explicitly blocked`,
                triggeredBy: params.triggeredBy,
            })
        }

        const flowRun = await flowRunService(log).test({
            projectId: scenario.projectId,
            flowVersionId: scenario.flowVersionId,
            payload: scenario.triggerInput ?? {},
            triggeredBy: params.triggeredBy,
        })
        log.info({ scenarioId: scenario.id, flowRunId: flowRun.id }, 'Flow test scenario execution started')
        return this.createRunRecord({
            scenario,
            flowRunId: flowRun.id,
            status: FlowTestScenarioRunStatus.PENDING,
            failureReason: null,
            triggeredBy: params.triggeredBy,
        })
    },

    async createRunRecord(params: CreateRunRecordParams): Promise<FlowTestScenarioRun> {
        const run: FlowTestScenarioRun = {
            id: apId(),
            projectId: params.scenario.projectId,
            scenarioId: params.scenario.id,
            flowId: params.scenario.flowId,
            flowVersionId: params.scenario.flowVersionId,
            flowRunId: params.flowRunId,
            status: params.status,
            failureReason: params.failureReason,
            diffReport: null,
            triggeredBy: params.triggeredBy ?? null,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
        }
        return flowTestScenarioRunRepo().save(run)
    },

    async listRuns(params: ListRunsParams): Promise<SeekPage<FlowTestScenarioRun>> {
        const decodedCursor = paginationHelper.decodeCursor(params.cursor)
        const paginator = buildPaginator<FlowTestScenarioRunSchema>({
            entity: FlowTestScenarioRunEntity,
            query: {
                limit: params.limit,
                orderBy: [
                    { field: 'created', order: Order.DESC },
                    { field: 'id', order: Order.DESC },
                ],
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        const query = flowTestScenarioRunRepo().createQueryBuilder('flow_test_scenario_run').where({
            scenarioId: params.scenarioId,
            projectId: params.projectId,
        })
        const { data, cursor } = await paginator.paginate(query)
        const finalized = await Promise.all(data.map((run) => this.finalizeRunIfNeeded(run)))
        return paginationHelper.createPage<FlowTestScenarioRun>(finalized, cursor)
    },

    async getRunOrThrow(params: GetRunParams): Promise<FlowTestScenarioRun> {
        const run = await flowTestScenarioRunRepo().findOneBy({
            id: params.runId,
            scenarioId: params.scenarioId,
            projectId: params.projectId,
        })
        if (isNil(run)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'flow_test_scenario_run',
                    entityId: params.runId,
                    message: 'Flow test scenario run not found',
                },
            })
        }
        return this.finalizeRunIfNeeded(run)
    },

    /**
     * Lazily generates the diff report once the isolated test run reaches a
     * terminal state. Runs are never reported against a different structure:
     * the report always compares the pinned version's actual step outputs.
     */
    async finalizeRunIfNeeded(run: FlowTestScenarioRun): Promise<FlowTestScenarioRun> {
        if (run.status !== FlowTestScenarioRunStatus.PENDING || isNil(run.flowRunId)) {
            return run
        }
        const flowRunSummary = await flowRunService(log).getOne({ id: run.flowRunId, projectId: run.projectId })
        if (isNil(flowRunSummary)) {
            // The isolated run was cleaned up before finalization; the scenario
            // run must not fail reads, it is simply marked as errored.
            const finalizedRun: FlowTestScenarioRun = {
                ...run,
                status: FlowTestScenarioRunStatus.ERROR,
                failureReason: 'The isolated test run no longer exists',
            }
            await flowTestScenarioRunRepo().save(finalizedRun)
            return finalizedRun
        }
        const flowRun = await flowRunService(log).getOnePopulatedOrThrow({ id: run.flowRunId, projectId: run.projectId })
        if (!isFlowRunStateTerminal({ status: flowRun.status, ignoreInternalError: false })) {
            return run
        }
        const scenario = await flowTestScenarioRepo().findOneBy({ id: run.scenarioId })
        if (isNil(scenario)) {
            return run
        }
        const diffReport = computeFlowTestScenarioDiff({
            expectedOutputs: scenario.expectedOutputs,
            allowedDynamicFields: scenario.allowedDynamicFields,
            steps: flowRun.steps ?? {},
            flowRunStatus: flowRun.status,
            generatedAt: new Date().toISOString(),
        })
        const succeeded = flowRun.status === FlowRunStatus.SUCCEEDED
        const status = succeeded
            ? (isPassingDiffReport(diffReport) ? FlowTestScenarioRunStatus.PASSED : FlowTestScenarioRunStatus.FAILED)
            : FlowTestScenarioRunStatus.ERROR
        const failureReason = succeeded
            ? null
            : (flowRun.failedStep?.name ? `Flow run ${flowRun.status.toLowerCase()} at step "${flowRun.failedStep.name}"` : `Flow run finished with status ${flowRun.status}`)
        const finalizedRun: FlowTestScenarioRun = {
            ...run,
            status,
            failureReason,
            diffReport,
        }
        await flowTestScenarioRunRepo().save(finalizedRun)
        return finalizedRun
    },
})

function snapshotOf(flowVersion: FlowVersion): FlowTestScenarioVersionSnapshot {
    return {
        displayName: flowVersion.displayName,
        schemaVersion: flowVersion.schemaVersion,
        state: flowVersion.state,
        valid: flowVersion.valid,
    }
}

async function computeExecutability(log: FastifyBaseLogger, scenario: FlowTestScenario): Promise<{ executable: boolean, missingInputFileIds: string[] }> {
    const existence = await Promise.all(
        scenario.inputFileIds.map((fileId) => fileService(log).exists({
            projectId: scenario.projectId,
            fileId,
            type: FileType.FLOW_TEST_SCENARIO_INPUT,
        })),
    )
    const missingInputFileIds = scenario.inputFileIds.filter((_, index) => !existence[index])
    return {
        executable: missingInputFileIds.length === 0,
        missingInputFileIds,
    }
}

async function withExecutability(log: FastifyBaseLogger, scenario: FlowTestScenario): Promise<FlowTestScenarioWithExecutability> {
    const executability = await computeExecutability(log, scenario)
    return {
        ...scenario,
        ...executability,
    }
}

type CreateParams = {
    projectId: ProjectId
    request: CreateFlowTestScenarioRequest
}

type UpdateParams = {
    id: string
    projectId: ProjectId
    request: UpdateFlowTestScenarioRequest
}

type GetOneParams = {
    id: string
    projectId: ProjectId
}

type ListParams = {
    projectId: ProjectId
    flowId: FlowId
    cursor: Cursor | null
    limit: number
}

type ExecuteParams = {
    scenarioId: string
    projectId: ProjectId
    triggeredBy?: string
}

type CreateRunRecordParams = {
    scenario: FlowTestScenario
    flowRunId: string | null
    status: FlowTestScenarioRunStatus
    failureReason: string | null
    triggeredBy?: string
}

type ListRunsParams = {
    scenarioId: string
    projectId: ProjectId
    cursor: Cursor | null
    limit: number
}

type GetRunParams = {
    scenarioId: string
    runId: string
    projectId: ProjectId
}
