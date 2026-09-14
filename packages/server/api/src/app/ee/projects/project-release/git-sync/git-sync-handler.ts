import { ActivepiecesError, ErrorCode, isNil } from '@activepieces/core-utils'
import { FlowState, FlowVersionState,
    GitPushOperationType,
    GitRepo,
    PopulatedTable,
    PushEverythingGitRepoRequest,
    PushFlowsGitRepoRequest,
    PushGitRepoRequest,
    PushTablesGitRepoRequest,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { SimpleGit } from 'simple-git'
import { flowService } from '../../../../flows/flow/flow.service'
import { projectService } from '../../../../project/project-service'
import { fieldService } from '../../../../tables/field/field.service'
import { tableService } from '../../../../tables/table/table.service'
import { projectStateService } from '../project-state/project-state.service'
import { gitHelper } from './git-helper'
import { gitSyncHelper } from './git-sync-helper'
import { gitRepoService } from './git-sync.service'

export const gitSyncHandler = (log: FastifyBaseLogger) => ({
    async execute({ gitRepoId, userId, request }: ExecuteParams): Promise<void> {
        const gitRepo = await gitRepoService(log).getOrThrow({ id: gitRepoId })
        const platformId = await getPlatformId({ log, projectId: gitRepo.projectId })
        switch (request.type) {
            case GitPushOperationType.PUSH_EVERYTHING:
                await pushEverything({ gitRepoId, platformId, userId, request, log })
                break
            case GitPushOperationType.PUSH_FLOW:
                await this.flows.push({ id: gitRepoId, platformId, userId, request })
                break
            case GitPushOperationType.DELETE_FLOW:
                await this.flows.delete({ id: gitRepoId, platformId, userId, request })
                break
            case GitPushOperationType.PUSH_TABLE:
                await this.tables.push({ id: gitRepoId, userId, request })
                break
            case GitPushOperationType.DELETE_TABLE:
                await this.tables.delete({ id: gitRepoId, userId, request })
                break
        }
    },
    flows: {
        async push({ id, platformId, userId, request }: FlowOperationParams): Promise<void> {
            const gitRepo = await gitRepoService(log).getOrThrow({ id })
            const { git, flowFolderPath, connectionsFolderPath } = await gitHelper.createGitRepoAndReturnPaths(log, gitRepo, userId)

            const flows = await listFlowsByExternalIds(log, gitRepo.projectId, request.externalFlowIds)

            for (const flow of flows) {
                const flowName = flow.externalId
                await gitSyncHelper(log).upsertFlowToGit({
                    fileName: flowName,
                    flow,
                    flowFolderPath,
                })
            }
            await gitHelper.commitAndPush(git, gitRepo, request.commitMessage ?? `chore: updated flows ${request.externalFlowIds.join(', ')}`)

            // This is important to make sure no connections are left behind
            await pushConnectionsWithContext(log, { git, flowFolderPath, connectionsFolderPath, gitRepo, platformId })
        },

        async delete({ id, platformId, userId, request }: FlowOperationParams): Promise<void> {
            const gitRepo = await gitRepoService(log).getOrThrow({ id })
            const { git, flowFolderPath, connectionsFolderPath } = await gitHelper.createGitRepoAndReturnPaths(log, gitRepo, userId)

            const flows = await listFlowsByExternalIds(log, gitRepo.projectId, request.externalFlowIds)

            for (const flow of flows) {
                const fileName = flow.externalId || flow.id
                await gitSyncHelper(log).deleteFromGit({
                    fileName,
                    folderPath: flowFolderPath,
                })
            }
            await gitHelper.commitAndPush(git, gitRepo, request.commitMessage ?? `chore: deleted flow ${request.externalFlowIds.join(', ')} from user interface`)
            await pushConnectionsWithContext(log, { git, flowFolderPath, connectionsFolderPath, gitRepo, platformId })
        },
    },

    connections: {
        async push({ id, platformId, userId }: ConnectionOperationParams): Promise<void> {
            const gitRepo = await gitRepoService(log).getOrThrow({ id })
            const { git, connectionsFolderPath, flowFolderPath } = await gitHelper.createGitRepoAndReturnPaths(log, gitRepo, userId)
            await pushConnectionsWithContext(log, { git, flowFolderPath, connectionsFolderPath, gitRepo, platformId })
        },
    },

    tables: {
        async push({ id, userId, request }: TableOperationParams): Promise<void> {
            const gitRepo = await gitRepoService(log).getOrThrow({ id })
            const { git, tablesFolderPath } = await gitHelper.createGitRepoAndReturnPaths(log, gitRepo, userId)

            const populatedTables: PopulatedTable[] = await listTablesByExternalIds(gitRepo.projectId, request.externalTableIds)

            for (const table of populatedTables) {
                const tableName = table.externalId || table.id
                await gitSyncHelper(log).upsertTableToGit({
                    fileName: tableName,
                    table,
                    tablesFolderPath,
                })
            }

            await gitHelper.commitAndPush(git, gitRepo, request.commitMessage ?? `chore: updated tables ${request.externalTableIds.join(', ')}`)
        },

        async delete({ id, userId, request }: TableOperationParams): Promise<void> {
            const gitRepo = await gitRepoService(log).getOrThrow({ id })
            const { git, tablesFolderPath } = await gitHelper.createGitRepoAndReturnPaths(log, gitRepo, userId)

            const populatedTables = await listTablesByExternalIds(gitRepo.projectId, request.externalTableIds)
            for (const table of populatedTables) {
                await gitSyncHelper(log).deleteFromGit({
                    fileName: table.externalId,
                    folderPath: tablesFolderPath,
                })
            }

            await gitHelper.commitAndPush(git, gitRepo, request.commitMessage ?? `chore: deleted tables ${request.externalTableIds.join(', ')}`)
        },
    },
})

async function listTablesByExternalIds(projectId: string, externalIds: string[]): Promise<PopulatedTable[]> {
    const tables = await tableService.list({
        folderId: undefined,
        projectId,
        limit: 10000,
        cursor: undefined,
        name: undefined,
        externalIds,
    })

    const tableIds = tables.data.map((t) => t.id)
    const fieldsMap = await fieldService.getAllByTableIds({ projectId, tableIds })
    return tables.data.map((table) => ({
        ...table,
        fields: fieldsMap.get(table.id) ?? [],
    }))
}

async function pushConnectionsWithContext(log: FastifyBaseLogger, { git, flowFolderPath, connectionsFolderPath, gitRepo, platformId }: ConnectionContextParams): Promise<void> {
    await gitSyncHelper(log).updateConectionStateOnGit({
        flowFolderPath,
        connectionsFolderPath,
        git,
        gitRepo,
        platformId,
        log,
    })
}

function listFlowsByExternalIds(log: FastifyBaseLogger, projectId: string, externalIds: string[]): Promise<FlowState[]> {
    return flowService(log).list({
        projectIds: [projectId],
        limit: 10000,
        cursorRequest: null,
        folderId: undefined,
        status: undefined,
        name: undefined,
        connectionExternalIds: undefined,
        versionState: FlowVersionState.LOCKED,
    }).then((page) => page.data.filter((flow) => externalIds.includes(flow.externalId)))
}

type FlowOperationParams = {
    id: string
    platformId: string
    userId: string
    request: PushFlowsGitRepoRequest
}

type TableOperationParams = {
    id: string
    userId: string
    request: PushTablesGitRepoRequest
}

type ConnectionOperationParams = {
    id: string
    platformId: string
    userId: string
}

type ConnectionContextParams = {
    git: SimpleGit
    flowFolderPath: string
    connectionsFolderPath: string
    gitRepo: GitRepo
    platformId: string
}

type ExecuteParams = {
    gitRepoId: string
    userId: string
    request: PushGitRepoRequest
}

async function pushEverything({ gitRepoId, platformId, userId, request, log }: {
    gitRepoId: string
    platformId: string
    userId: string
    request: PushEverythingGitRepoRequest
    log: FastifyBaseLogger
}): Promise<void> {
    const gitRepo = await gitRepoService(log).getOrThrow({ id: gitRepoId })
    const projectState = await projectStateService(log).getProjectState(gitRepo.projectId, log)
    if (!isNil(projectState.flows) && projectState.flows.length > 0) {
        await gitSyncHandler(log).flows.push({
            id: gitRepoId,
            platformId,
            userId,
            request: {
                type: GitPushOperationType.PUSH_FLOW,
                commitMessage: request.commitMessage ?? `chore: push all flows ${projectState.flows.map((flow) => flow.version.displayName).join(', ')}`,
                externalFlowIds: projectState.flows.map((flow) => flow.externalId),
            },
        })
    }
    if (!isNil(projectState.tables) && projectState.tables.length > 0) {
        await gitSyncHandler(log).tables.push({
            id: gitRepoId,
            userId,
            request: {
                type: GitPushOperationType.PUSH_TABLE,
                commitMessage: request.commitMessage ?? `chore: push all tables ${projectState.tables.map((table) => table.name).join(', ')}`,
                externalTableIds: projectState.tables.map((table) => table.externalId),
            },
        })
    }
}

async function getPlatformId({ log, projectId }: { log: FastifyBaseLogger, projectId: string }): Promise<string> {
    const project = await projectService(log).getOne(projectId)
    if (isNil(project)) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: {
                entityType: 'project',
                entityId: projectId,
            },
        })
    }
    return project.platformId
}