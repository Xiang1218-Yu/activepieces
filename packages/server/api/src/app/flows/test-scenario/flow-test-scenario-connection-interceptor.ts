import { ActivepiecesError, apId, ErrorCode, isNil } from '@activepieces/core-utils'
import {
    AppConnection,
    AppConnectionScope,
    AppConnectionStatus,
    AppConnectionType,
    AppConnectionValue,
    FlowTestScenarioConnectionStrategy,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../core/db/repo-factory'
import { FlowTestScenarioEntity, FlowTestScenarioRunEntity, FlowTestScenarioRunSchema, FlowTestScenarioSchema } from './flow-test-scenario-entity'

const scenarioRunRepo = repoFactory<FlowTestScenarioRunSchema>(FlowTestScenarioRunEntity)
const scenarioRepo = repoFactory<FlowTestScenarioSchema>(FlowTestScenarioEntity)

/**
 * Enforces a flow test scenario's connection strategy while its isolated
 * test run executes. The engine principal id of an EXECUTE_FLOW job is the
 * flow run id, so the worker-facing connection endpoint can key the lookup
 * off it without any extra context threading.
 *
 * This module deliberately depends only on the scenario repositories (not on
 * the scenario service) so the app-connection module can import it without
 * creating a dependency cycle.
 */
export const flowTestScenarioConnectionInterceptor = {
    /**
     * Returns a mocked connection when the run belongs to a MOCK scenario
     * that defines a mock for `externalId`. Returns null when the run is not
     * a scenario run or no mock is defined (callers then resolve the real
     * connection). Throws when the scenario explicitly blocks connections.
     */
    async resolveConnectionOverride({ flowRunId, externalId, projectId, platformId, log }: ResolveConnectionOverrideParams): Promise<AppConnection | null> {
        const scenario = await findScenarioForRun(flowRunId)
        if (isNil(scenario)) {
            return null
        }
        if (scenario.connectionStrategy === FlowTestScenarioConnectionStrategy.BLOCK) {
            log.info({ flowRunId, externalId, scenarioId: scenario.id }, 'Connection resolution blocked by flow test scenario')
            throw new ActivepiecesError({
                code: ErrorCode.FLOW_TEST_SCENARIO_CONNECTION_BLOCKED,
                params: {
                    connectionExternalId: externalId,
                    flowRunId,
                },
            })
        }
        const mockValue = scenario.connectionMocks[externalId]
        if (isNil(mockValue)) {
            return null
        }
        log.info({ flowRunId, externalId, scenarioId: scenario.id }, 'Connection resolved from flow test scenario mock')
        const now = new Date().toISOString()
        const mockedValue = mockValue as AppConnectionValue
        const mockedConnection: AppConnection = {
            id: apId(),
            created: now,
            updated: now,
            externalId,
            type: (mockedValue as { type?: AppConnectionType }).type ?? AppConnectionType.CUSTOM_AUTH,
            scope: AppConnectionScope.PROJECT,
            pieceName: '',
            displayName: `Test scenario mock (${externalId})`,
            projectIds: [projectId],
            platformId,
            status: AppConnectionStatus.ACTIVE,
            ownerId: '',
            owner: null,
            value: mockedValue,
            metadata: null,
            pieceVersion: '',
            preSelectForNewProjects: false,
        }
        return mockedConnection
    },
}

async function findScenarioForRun(flowRunId: string): Promise<FlowTestScenarioSchema | null> {
    const run = await scenarioRunRepo().findOne({
        where: { flowRunId },
        select: ['id', 'scenarioId'],
    })
    if (isNil(run)) {
        return null
    }
    return scenarioRepo().findOneBy({ id: run.scenarioId })
}

type ResolveConnectionOverrideParams = {
    flowRunId: string
    externalId: string
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}
