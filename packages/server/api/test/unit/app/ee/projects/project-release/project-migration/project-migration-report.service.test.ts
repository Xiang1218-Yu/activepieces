import {
    FlowActionType,
    FlowTriggerType,
    PopulatedFlow,
    ProjectMigrationOperationStatus,
    ProjectMigrationResourceType,
    ProjectMigrationSnapshot,
    ProjectState,
    ProjectSyncPlan,
} from '@activepieces/shared'
import { projectMigrationReportService } from '../../../../../../../src/app/ee/projects/project-release/project-migration/project-migration-report.service'
import { flowGenerator } from '../../../../../../helpers/flow-generator'

describe('Project Migration Report Service', () => {
    it('should group source flows as create when target has no flows', () => {
        const sourceFlow = validFlow('extFlow1')
        const { snapshot, plan } = buildScenario({
            sourceState: { flows: [sourceFlow] },
            targetState: { flows: [] },
        })

        const page = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType: ProjectMigrationResourceType.FLOW,
            offset: 0,
            limit: 20,
            availablePieceKeys: new Set(),
        })

        expect(page.data).toHaveLength(1)
        expect(page.data[0].status).toBe(ProjectMigrationOperationStatus.WILL_CREATE)
    })

    it('should group flows as no change when identical by external id', () => {
        const sourceFlow = validFlow('extFlow1')
        const targetFlow: PopulatedFlow = {
            ...sourceFlow,
            id: 'target-internal-id',
            projectId: 'target-project',
        }
        const { snapshot, plan } = buildScenario({
            sourceState: { flows: [sourceFlow] },
            targetState: { flows: [targetFlow] },
        })

        const page = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType: ProjectMigrationResourceType.FLOW,
            offset: 0,
            limit: 20,
            availablePieceKeys: new Set(),
        })

        expect(page.data[0].status).toBe(ProjectMigrationOperationStatus.NO_CHANGE)
    })

    it('should mark target-only flows as delete', () => {
        const targetFlow = validFlow('extFlowDelete')
        const { snapshot, plan } = buildScenario({
            sourceState: { flows: [] },
            targetState: { flows: [targetFlow] },
        })

        const page = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType: ProjectMigrationResourceType.FLOW,
            offset: 0,
            limit: 20,
            availablePieceKeys: new Set(),
        })

        expect(page.data[0].status).toBe(ProjectMigrationOperationStatus.WILL_DELETE)
    })

    it('should report a missing piece blocker when the piece key is not available', () => {
        const sourceFlow = flowWithPieceStep({
            externalId: 'ext-flow-piece',
            pieceName: '@activepieces/piece-nonexistent',
            pieceVersion: '1.0.0',
        })
        const { snapshot, plan } = buildScenario({
            sourceState: { flows: [sourceFlow] },
            targetState: { flows: [] },
        })

        const page = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType: ProjectMigrationResourceType.FLOW,
            offset: 0,
            limit: 20,
            availablePieceKeys: new Set(),
        })

        expect(page.data[0].isBlocked).toBe(true)
        expect(page.data[0].blockers.some((b) => b.type === 'MISSING_PIECE')).toBe(true)
    })

    it('should not flag a piece blocker when the piece version is available', () => {
        const sourceFlow = flowWithPieceStep({
            externalId: 'ext-flow-piece',
            pieceName: '@activepieces/piece-google-sheets',
            pieceVersion: '1.0.0',
        })
        const { snapshot, plan } = buildScenario({
            sourceState: { flows: [sourceFlow] },
            targetState: { flows: [] },
        })

        const page = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType: ProjectMigrationResourceType.FLOW,
            offset: 0,
            limit: 20,
            availablePieceKeys: new Set(['@activepieces/piece-google-sheets@1.0.0']),
        })

        expect(page.data[0].blockers.filter((b) => b.type === 'MISSING_PIECE')).toHaveLength(0)
    })

    it('should report a missing connection warning when the auth reference is absent in target', () => {
        const sourceFlow = flowWithPieceStep({
            externalId: 'extFlowConnection',
            pieceName: '@activepieces/piece-google-sheets',
            pieceVersion: '1.0.0',
        })
        const { snapshot, plan } = buildScenario({
            sourceState: {
                flows: [sourceFlow],
                connections: [{
                    externalId: 'connExt1',
                    pieceName: '@activepieces/piece-google-sheets',
                    displayName: 'Google Sheets Production',
                }],
            },
            targetState: { flows: [], connections: [] },
        })

        const page = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType: ProjectMigrationResourceType.FLOW,
            offset: 0,
            limit: 20,
            availablePieceKeys: new Set(['@activepieces/piece-google-sheets@1.0.0']),
        })

        const connectionBlockers = page.data[0].blockers.filter((b) => b.type === 'MISSING_CONNECTION')
        expect(connectionBlockers).toHaveLength(1)
        expect(connectionBlockers[0].connectionDisplayName).toBe('Google Sheets Production')
        expect(page.data[0].isBlocked).toBe(false)
    })

    it('should paginate items using offset and return nextOffset', () => {
        const flows = Array.from({ length: 3 }, (_, index) =>
            validFlow(`extFlow${index}`),
        )
        const { snapshot, plan } = buildScenario({
            sourceState: { flows },
            targetState: { flows: [] },
        })

        const firstPage = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType: ProjectMigrationResourceType.FLOW,
            offset: 0,
            limit: 2,
            availablePieceKeys: new Set(),
        })
        expect(firstPage.data).toHaveLength(2)
        expect(firstPage.nextOffset).toBe(2)

        const secondPage = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType: ProjectMigrationResourceType.FLOW,
            offset: 2,
            limit: 2,
            availablePieceKeys: new Set(),
        })
        expect(secondPage.data).toHaveLength(1)
        expect(secondPage.nextOffset).toBeNull()
    })

    it('should return empty resources for empty projects', () => {
        const { snapshot } = buildScenario({
            sourceState: { flows: [] },
            targetState: { flows: [] },
        })

        const summary = projectMigrationReportService.buildSummary({
            snapshot,
            availablePieceKeys: new Set(),
        })

        expect(summary.totals[ProjectMigrationResourceType.FLOW].total).toBe(0)
        expect(summary.totals[ProjectMigrationResourceType.TABLE].total).toBe(0)
        expect(summary.totals[ProjectMigrationResourceType.CONNECTION].total).toBe(0)
        expect(summary.totals[ProjectMigrationResourceType.FOLDER].total).toBe(0)
        expect(summary.hasBlockers).toBe(false)
    })
})

function buildScenario({ sourceState, targetState }: {
    sourceState: Partial<ProjectState>
    targetState: Partial<ProjectState>
}): { snapshot: ProjectMigrationSnapshot, plan: ProjectSyncPlan } {
    const fullSource: ProjectState = {
        flows: [],
        connections: [],
        tables: [],
        folders: [],
        ...sourceState,
    }
    const fullTarget: ProjectState = {
        flows: [],
        connections: [],
        tables: [],
        folders: [],
        ...targetState,
    }
    const snapshot: ProjectMigrationSnapshot = {
        sourceProjectId: 'source-project',
        targetProjectId: 'target-project',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceState: fullSource,
        targetState: fullTarget,
    }
    const plan: ProjectSyncPlan = {
        flows: [],
        connections: [],
        tables: [],
        folders: [],
        errors: [],
    }
    return { snapshot, plan }
}

function validFlow(externalId?: string): PopulatedFlow {
    return withValidStepNames(flowGenerator.simpleActionAndTrigger(externalId))
}

function withValidStepNames(flow: PopulatedFlow): PopulatedFlow {
    const renameTrigger = (trigger: PopulatedFlow['version']['trigger']): PopulatedFlow['version']['trigger'] => ({
        ...trigger,
        name: `trigger_${trigger.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        nextAction: trigger.nextAction
            ? {
                ...trigger.nextAction,
                name: `action_${trigger.nextAction.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
            }
            : undefined,
    })
    return {
        ...flow,
        version: {
            ...flow.version,
            trigger: renameTrigger(flow.version.trigger),
        },
    }
}

function flowWithPieceStep({ externalId, pieceName, pieceVersion }: {
    externalId: string
    pieceName: string
    pieceVersion: string
}): PopulatedFlow {
    const flow = flowGenerator.simpleActionAndTrigger(externalId)
    const flowWithSteps: PopulatedFlow = {
        ...flow,
        version: {
            ...flow.version,
            trigger: {
                ...flow.version.trigger,
                name: 'piece_trigger',
                type: FlowTriggerType.PIECE,
                settings: {
                    ...flow.version.trigger.settings,
                    pieceName,
                    pieceVersion,
                    input: {
                        auth: '{{connections[\'connExt1\']}}',
                    },
                },
                nextAction: {
                    name: 'piece_action',
                    displayName: 'Piece Action',
                    valid: true,
                    type: FlowActionType.PIECE,
                    settings: {
                        pieceName,
                        pieceVersion,
                        input: {},
                    },
                    lastUpdatedDate: '',
                },
            },
        },
    }
    return flowWithSteps
}
