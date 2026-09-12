import { ActivepiecesError, ErrorCode, isNil, PlatformId, ProjectId } from '@activepieces/core-utils'
import {
    FlowActionType,
    flowPieceUtil,
    FlowProjectOperationType,
    flowStructureUtil,
    FlowTriggerType,
    ProjectMigrationPage,
    ProjectMigrationPrecheckReport,
    ProjectMigrationPrecheckRequest,
    ProjectMigrationResourceType,
    ProjectMigrationSnapshot,
    ProjectState,
    ProjectSyncPlan,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { pieceMetadataService } from '../../../../pieces/metadata/piece-metadata-service'
import { projectService } from '../../../../project/project-service'
import { projectDiffService } from '../project-state/project-diff.service'
import { projectStateService } from '../project-state/project-state.service'
import { projectMigrationReportService } from './project-migration-report.service'
import { projectMigrationSnapshotService } from './project-migration-snapshot.service'

const WILDCARD_PIECE_VERSION = '*'

export const projectMigrationService = (log: FastifyBaseLogger): {
    precheck: (params: PrecheckParams) => Promise<ProjectMigrationPrecheckReport>
} => ({
    async precheck({ params, platformId }: PrecheckParams): Promise<ProjectMigrationPrecheckReport> {
        const snapshot = await resolveSnapshot({ params, platformId, log })

        const sourceState = ProjectState.parse(snapshot.sourceState)
        const targetState = ProjectState.parse(snapshot.targetState)

        const availablePieceKeys = await resolveAvailablePieces({
            sourceState,
            targetProjectId: snapshot.targetProjectId,
            platformId,
            log,
        })

        const diffs = await projectDiffService.diff({
            newState: sourceState,
            currentState: targetState,
        })
        const plan = toSyncPlan(diffs)

        const summary = projectMigrationReportService.buildSummary({
            snapshot,
            availablePieceKeys,
        })
        summary.snapshotToken = await projectMigrationSnapshotService.encode({ snapshot })

        const resourceType = params.resourceType ?? ProjectMigrationResourceType.FLOW
        const offset = decodeOffset(params.cursor)
        const { data, nextOffset } = projectMigrationReportService.getPage({
            snapshot,
            plan,
            resourceType,
            offset,
            limit: params.limit,
            availablePieceKeys,
        })

        const page: ProjectMigrationPage = {
            data,
            nextCursor: isNil(nextOffset) ? null : encodeOffset(nextOffset),
        }

        return { summary, page }
    },
})

async function resolveSnapshot({ params, platformId, log }: ResolveSnapshotParams): Promise<ProjectMigrationSnapshot> {
    if (!isNil(params.snapshotToken)) {
        const decoded = await projectMigrationSnapshotService.decode({
            token: params.snapshotToken,
            expectedTargetProjectId: params.targetProjectId,
        })
        if (decoded.sourceProjectId === params.targetProjectId
            || decoded.targetProjectId !== params.targetProjectId) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'The precheck snapshot does not match the selected projects. Run the precheck again.' },
            })
        }
        await assertProjectOwnedByPlatform({ projectId: decoded.sourceProjectId, platformId, log })
        await assertProjectOwnedByPlatform({ projectId: decoded.targetProjectId, platformId, log })
        return decoded
    }
    const sourceProjectId = params.sourceProjectId
    const targetProjectId = params.targetProjectId
    if (isNil(sourceProjectId)) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'A source project is required' },
        })
    }
    if (sourceProjectId === targetProjectId) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'Source and target projects must be different' },
        })
    }
    await assertProjectOwnedByPlatform({ projectId: sourceProjectId, platformId, log })
    await assertProjectOwnedByPlatform({ projectId: targetProjectId, platformId, log })
    const [sourceState, targetState] = await Promise.all([
        projectStateService(log).getProjectState(sourceProjectId, log),
        projectStateService(log).getProjectState(targetProjectId, log),
    ])
    return {
        sourceProjectId,
        targetProjectId,
        generatedAt: new Date().toISOString(),
        sourceState,
        targetState,
    }
}

async function assertProjectOwnedByPlatform({ projectId, platformId, log }: { projectId: ProjectId, platformId: PlatformId, log: FastifyBaseLogger }): Promise<void> {
    const project = await projectService(log).getOne(projectId)
    if (isNil(project) || project.platformId !== platformId) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'Project does not belong to the current platform',
            },
        })
    }
}

async function resolveAvailablePieces({ sourceState, targetProjectId, platformId, log }: ResolveAvailablePiecesParams): Promise<Set<string>> {
    const pieceVersions = new Map<string, Set<string>>()
    for (const flow of sourceState.flows) {
        for (const step of flowStructureUtil.getAllSteps(flow.version.trigger)) {
            if (step.type !== FlowActionType.PIECE && step.type !== FlowTriggerType.PIECE) {
                continue
            }
            const pieceName = step.settings.pieceName
            const exactVersion = flowPieceUtil.getExactVersion(step.settings.pieceVersion)
            const versions = pieceVersions.get(pieceName) ?? new Set<string>()
            versions.add(exactVersion)
            if (step.settings.pieceVersion === WILDCARD_PIECE_VERSION) {
                versions.add(WILDCARD_PIECE_VERSION)
            }
            pieceVersions.set(pieceName, versions)
        }
    }
    const availableKeys = new Set<string>()
    const checks: Promise<void>[] = []
    for (const [pieceName, versions] of pieceVersions) {
        for (const version of versions) {
            if (version === WILDCARD_PIECE_VERSION) {
                checks.push(resolveWildcardPiece({ pieceName, targetProjectId, platformId, log, availableKeys }))
                continue
            }
            checks.push((async (): Promise<void> => {
                const piece = await pieceMetadataService(log).get({
                    name: pieceName,
                    version,
                    platformId,
                    projectId: targetProjectId,
                })
                if (!isNil(piece)) {
                    availableKeys.add(`${pieceName}@${version}`)
                }
            })())
        }
    }
    await Promise.all(checks)
    return availableKeys
}

async function resolveWildcardPiece({ pieceName, targetProjectId, platformId, log, availableKeys }: ResolveWildcardParams): Promise<void> {
    const pieces = await pieceMetadataService(log).list({
        platformId,
        projectId: targetProjectId,
        includeHidden: true,
    })
    const installedPiece = pieces.find((piece) => piece.name === pieceName)
    if (!isNil(installedPiece)) {
        availableKeys.add(`${pieceName}@${installedPiece.version}`)
    }
}

function toSyncPlan(diffs: Awaited<ReturnType<typeof projectDiffService.diff>>): ProjectSyncPlan {
    const flows = diffs.flows.map((operation) => {
        switch (operation.type) {
            case FlowProjectOperationType.UPDATE_FLOW:
                return {
                    type: operation.type,
                    flow: {
                        id: operation.flowState.id,
                        displayName: operation.newFlowState.version.displayName,
                    },
                    targetFlow: {
                        id: operation.newFlowState.id,
                        displayName: operation.flowState.version.displayName,
                    },
                }
            case FlowProjectOperationType.CREATE_FLOW:
            case FlowProjectOperationType.DELETE_FLOW:
                return {
                    type: operation.type,
                    flow: {
                        id: operation.flowState.id,
                        displayName: operation.flowState.version.displayName,
                    },
                }
        }
    })
    return {
        flows,
        connections: diffs.connections,
        tables: diffs.tables,
        folders: diffs.folders,
        errors: [],
    }
}

function decodeOffset(cursor: string | null | undefined): number {
    if (isNil(cursor)) {
        return 0
    }
    const decoded = Number(Buffer.from(cursor, 'base64url').toString('utf-8'))
    return Number.isFinite(decoded) && decoded >= 0 ? Math.floor(decoded) : 0
}

function encodeOffset(offset: number): string {
    return Buffer.from(String(offset), 'utf-8').toString('base64url')
}

type PrecheckParams = {
    params: ProjectMigrationPrecheckRequest
    platformId: PlatformId
}

type ResolveSnapshotParams = {
    params: ProjectMigrationPrecheckRequest
    platformId: PlatformId
    log: FastifyBaseLogger
}

type ResolveAvailablePiecesParams = {
    sourceState: ProjectState
    targetProjectId: ProjectId
    platformId: PlatformId
    log: FastifyBaseLogger
}

type ResolveWildcardParams = {
    pieceName: string
    targetProjectId: ProjectId
    platformId: PlatformId
    log: FastifyBaseLogger
    availableKeys: Set<string>
}
