import { ActivepiecesError, apId, ApId, ErrorCode, isNil, PlatformId, ProjectId, SeekPage } from '@activepieces/core-utils'
import { memoryLock } from '@activepieces/server-utils'
import { CreateProjectReleaseRequestBody, DiffReleaseRequest, DiffState, FlowProjectOperation, FlowProjectOperationType, FlowSyncError, ListProjectReleasesRequest, ProjectMigrationSnapshot, ProjectRelease, ProjectReleaseType, ProjectState, ProjectSyncPlan } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../../core/db/repo-factory'
import { buildPaginator } from '../../../helper/pagination/build-paginator'
import { paginationHelper } from '../../../helper/pagination/pagination-utils'
import { projectService } from '../../../project/project-service'
import { userService } from '../../../user/user-service'
import { gitRepoService } from './git-sync/git-sync.service'
import { projectMigrationSnapshotService } from './project-migration/project-migration-snapshot.service'
import { ProjectReleaseEntity } from './project-release.entity'
import { projectDiffService } from './project-state/project-diff.service'
import { projectStateService } from './project-state/project-state.service'
const projectReleaseRepo = repoFactory(ProjectReleaseEntity)

export const projectReleaseService = {
    async create(request: CreateProjectReleaseParams): Promise<ProjectRelease> {
        const { platformId, projectId, ownerId, params, log } = request
        const lockKey = `project-release:${params.projectId}`
        const lock = await memoryLock.acquire(lockKey)
        try {
            const snapshot = await resolveSnapshotToken({ params, projectId, platformId, log })
            const sourceState = snapshot ? ProjectState.parse(snapshot.sourceState) : undefined
            const diffs = await findDiffStates({ projectId, userId: ownerId, platformId, params, log, newState: sourceState })
            const flowIdsToApply = params.selectedFlowsIds ?? diffs.flows.map((flow) => flow.flowState.id)
            const filteredDiffs = await projectDiffService.filterFlows(flowIdsToApply, diffs)
            await projectStateService(log).apply({
                projectId,
                diffs: filteredDiffs,
                log,
                platformId,
                sourceFolders: sourceState?.folders ?? [],
            })
            const fileId = await projectStateService(log).save(projectId, params.name, log)
            const projectRelease: ProjectRelease = {
                id: apId(),
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                projectId,
                importedBy: ownerId,
                fileId,
                name: params.name,
                description: params.description,
                type: params.type,
            }
            return await projectReleaseRepo().save(projectRelease)
        }
        finally {
            await lock.release()
        }
    },
    async releasePlan({ projectId, userId, platformId, params, log }: ReleasePlanParams): Promise<ProjectSyncPlan> {
        const snapshot = await resolveSnapshotToken({ params, projectId, platformId, log })
        const newState = snapshot ? ProjectState.parse(snapshot.sourceState) : undefined
        const diffs = await findDiffStates({ projectId, userId, platformId, params, log, newState })
        return toResponse({
            diffs,
            errors: [],
        })
    },
    async list({ projectId, request, log }: ListParams): Promise<SeekPage<ProjectRelease>> {
        const decodedCursor = paginationHelper.decodeCursor(request.cursor ?? null)
        const paginator = buildPaginator({
            entity: ProjectReleaseEntity,
            query: {
                limit: request.limit ?? 10,
                order: 'DESC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        const { data, cursor } = await paginator.paginate(projectReleaseRepo()
            .createQueryBuilder('project_release')
            .where({
                projectId,
            })
            .orderBy('created', 'DESC'))
        const enrichedData = await Promise.all(data.map(
            async (projectRelease) => this.enrich(projectRelease, log),
        ))
        return paginationHelper.createPage<ProjectRelease>(enrichedData, cursor)
    },
    async enrich(projectRelease: ProjectRelease, log: FastifyBaseLogger): Promise<ProjectRelease> {
        return {
            ...projectRelease,
            importedByUser: isNil(projectRelease.importedBy) ? undefined : await userService(log).getMetaInformation({
                id: projectRelease.importedBy,
            }) ?? undefined,
        }
    },
    async getOneOrThrow(params: GetOneProjectReleaseParams): Promise<ProjectRelease> {
        const projectRelease = await projectReleaseRepo().findOneBy({
            id: params.id,
            projectId: params.projectId,
        })
        if (isNil(projectRelease)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: params.id,
                },
            })
        }
        return projectRelease
    },
}
async function findDiffStates({ projectId, userId, platformId, params, log, newState }: FindDiffStatesParams): Promise<DiffState> {
    const [resolvedNewState, currentState] = await Promise.all([
        newState ?? getStateFromCreateRequest({ projectId, userId, platformId, params, log }),
        projectStateService(log).getProjectState(projectId, log),
    ])
    const diffs = await projectDiffService.diff({
        newState: resolvedNewState,
        currentState,
    })
    return diffs
}

async function toResponse(params: toResponseParams): Promise<ProjectSyncPlan> {
    const { diffs, errors } = params
    const { flows, connections, tables, folders } = diffs
    const responsePlans: FlowProjectOperation[] = flows.map((operation) => {
        switch (operation.type) {
            case FlowProjectOperationType.DELETE_FLOW:
                return {
                    type: operation.type,
                    flow: {
                        id: operation.flowState.id,
                        displayName: operation.flowState.version.displayName,
                    },
                }
            case FlowProjectOperationType.CREATE_FLOW:
                return {
                    type: operation.type,
                    flow: {
                        id: operation.flowState.id,
                        displayName: operation.flowState.version.displayName,
                    },
                }
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
        }
    })
    return {
        errors,
        flows: responsePlans,
        connections,
        tables,
        folders,
    }
}
async function getStateFromCreateRequest({ projectId, userId, platformId, params, log }: GetStateFromCreateRequestParams): Promise<ProjectState> {
    switch (params.type) {
        case ProjectReleaseType.GIT: {
            const gitRepo = await gitRepoService(log).getOneByProjectOrThrow({ projectId })
            return gitRepoService(log).getState({ gitRepo, userId, log })
        }
        case ProjectReleaseType.PROJECT: {
            await assertTargetProjectOwnedByPlatform({ targetProjectId: params.targetProjectId, platformId, log })
            return projectStateService(log).getProjectState(params.targetProjectId, log)
        }
        case ProjectReleaseType.ROLLBACK: {
            const projectRelease = await projectReleaseService.getOneOrThrow({
                id: params.projectReleaseId,
                projectId,
            })
            return projectStateService(log).getStateFromRelease(projectId, projectRelease.fileId, log)
        }
    }
}

async function resolveSnapshotToken({ params, projectId, platformId, log }: { params: DiffReleaseRequest | CreateProjectReleaseRequestBody, projectId: ProjectId, platformId: PlatformId, log: FastifyBaseLogger }): Promise<ProjectMigrationSnapshot | undefined> {
    if (params.type !== ProjectReleaseType.PROJECT || isNil(params.snapshotToken)) {
        return undefined
    }
    const snapshot = projectMigrationSnapshotService.decode({
        token: params.snapshotToken,
        expectedTargetProjectId: projectId,
    })
    if (snapshot.sourceProjectId !== params.targetProjectId) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: {
                message: 'The precheck snapshot does not match the requested source project. Run the precheck again.',
            },
        })
    }
    await assertTargetProjectOwnedByPlatform({ targetProjectId: snapshot.sourceProjectId, platformId, log })
    return snapshot
}

async function assertTargetProjectOwnedByPlatform({ targetProjectId, platformId, log }: { targetProjectId: string, platformId: PlatformId, log: FastifyBaseLogger }): Promise<void> {
    const targetProject = await projectService(log).getOne(targetProjectId)
    if (isNil(targetProject) || targetProject.platformId !== platformId) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'Target project does not belong to the current platform',
            },
        })
    }
}

type CreateProjectReleaseParams = {
    platformId: PlatformId
    projectId: ProjectId
    ownerId: ApId
    params: CreateProjectReleaseRequestBody
    log: FastifyBaseLogger
}

type toResponseParams = {
    diffs: DiffState
    errors: FlowSyncError[]
}

type ListParams = {
    projectId: ProjectId
    request: ListProjectReleasesRequest
    log: FastifyBaseLogger
}

type ReleasePlanParams = {
    projectId: ProjectId
    userId: ApId
    platformId: PlatformId
    params: DiffReleaseRequest | CreateProjectReleaseRequestBody
    log: FastifyBaseLogger
}

type FindDiffStatesParams = {
    projectId: ProjectId
    userId: ApId
    platformId: PlatformId
    params: DiffReleaseRequest | CreateProjectReleaseRequestBody
    log: FastifyBaseLogger
    newState?: ProjectState
}

type GetStateFromCreateRequestParams = {
    projectId: ProjectId
    userId: ApId
    platformId: PlatformId
    params: DiffReleaseRequest | CreateProjectReleaseRequestBody
    log: FastifyBaseLogger
}

type GetOneProjectReleaseParams = {
    id: ApId
    projectId: ProjectId
}
