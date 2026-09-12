import { isNil, ProjectId } from '@activepieces/core-utils'
import { AppConnectionScope, AppConnectionStatus, AppConnectionType, ConnectionOperationType, ConnectionState, DiffState, FieldState, FieldType, FileCompression, FileId, FileType, FlowOperationStatus, FlowOperationType, FlowProjectOperationType, FlowState, FlowStatus, FlowSyncError, FolderOperationType, FolderState, PopulatedFlow, PopulatedTable, ProjectState, Table, TableOperationType, TableState } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { appConnectionService } from '../../../../app-connection/app-connection-service/app-connection-service'
import { fileService } from '../../../../file/file.service'
import { flowRepo } from '../../../../flows/flow/flow.repo'
import { flowService } from '../../../../flows/flow/flow.service'
import { flowVersionService } from '../../../../flows/flow-version/flow-version.service'
import { flowMigrations } from '../../../../flows/flow-version/migrations'
import { flowFolderService } from '../../../../flows/folder/folder.service'
import { fieldService } from '../../../../tables/field/field.service'
import { tableService } from '../../../../tables/table/table.service'
import { triggerSourceService } from '../../../../trigger/trigger-source/trigger-source-service'
import { cleanFlowStateUtil } from './clean-flow-state'
import { projectStateHelper } from './project-state-helper'

export const projectStateService = (log: FastifyBaseLogger) => ({
    async apply({ projectId, diffs, platformId, sourceFolders = [] }: ApplyProjectStateRequest): Promise<void> {
        const { flows, connections, tables } = diffs
        const folders = diffs.folders ?? []
        const folderIdMap = folders.length > 0
            ? await this.applyFolders({ projectId, folders })
            : new Map<string, string>()
        const publishJobs: Promise<FlowSyncError | null>[] = []
        for (const state of connections) {
            switch (state.type) {
                case ConnectionOperationType.CREATE_CONNECTION: {
                    await appConnectionService(log).upsert({
                        scope: AppConnectionScope.PROJECT,
                        platformId,
                        projectIds: [projectId],
                        externalId: state.connectionState.externalId,
                        displayName: state.connectionState.displayName,
                        pieceName: state.connectionState.pieceName,
                        type: AppConnectionType.NO_AUTH,
                        status: AppConnectionStatus.MISSING,
                        value: {
                            type: AppConnectionType.NO_AUTH,
                        },
                        ownerId: null,
                    })
                    break
                }
                case ConnectionOperationType.UPDATE_CONNECTION: {
                    const existingConnection = await appConnectionService(log).getOne({
                        externalId: state.newConnectionState.externalId,
                        platformId,
                        projectId,
                    })
                    if (!isNil(existingConnection)) {
                        await appConnectionService(log).update({
                            projectIds: [projectId],
                            platformId,
                            id: existingConnection.id,
                            scope: AppConnectionScope.PROJECT,
                            request: {
                                displayName: state.newConnectionState.displayName,
                                projectIds: null,
                            },
                        })
                    }
                    break
                }
            }
        }

        for (const operation of tables) {
            switch (operation.type) {
                case TableOperationType.CREATE_TABLE: {
                    const table = await tableService.create({
                        projectId,
                        request: {
                            name: operation.tableState.name,
                            externalId: operation.tableState.externalId,
                            projectId,
                        },
                    })

                    await fieldService.validateCount({ projectId, tableId: table.id, insertCount: operation.tableState.fields.length })
                    await Promise.all(operation.tableState.fields.map(async (field, position) => {
                        await fieldService.createFromState({ projectId, field, tableId: table.id, position })
                    }))
                    break
                }
                case TableOperationType.UPDATE_TABLE: {
                    const table = await tableService.update({
                        projectId,
                        id: operation.tableState.id,
                        request: {
                            name: operation.newTableState.name,
                        },
                    })

                    const fields = await fieldService.getAll({
                        projectId,
                        tableId: table.id,
                    })

                    const newFieldsCount = operation.newTableState.fields.filter((field) => !fields.some((f) => f.externalId === field.externalId)).length
                    await fieldService.validateCount({ projectId, tableId: table.id, insertCount: newFieldsCount })
                    await Promise.all(operation.newTableState.fields.map(async (field, position) => {
                        const existingField = fields.find((f) => f.externalId === field.externalId)
                        if (!isNil(existingField)) {
                            await fieldService.update({
                                projectId,
                                id: existingField.id,
                                request: field,
                            })
                        }
                        else {
                            await fieldService.createFromState({ projectId, field, tableId: table.id, position })
                        }
                    }))

                    const fieldsToDelete = fields.filter((f) => !operation.newTableState.fields.some((nf) => nf.externalId === f.externalId))

                    await Promise.all(fieldsToDelete.map(async (field) => {
                        await fieldService.delete({
                            id: field.id,
                            projectId,
                        })
                    }))
                    break
                }
                case TableOperationType.DELETE_TABLE: {
                    const table = await tableService.getOneByExternalIdOrThrow({
                        externalId: operation.tableState.externalId,
                        projectId,
                    })
                    await tableService.delete({
                        id: table.id,
                        projectId,
                    })
                    break
                }
            }
        }

        for (const operation of flows) {
            switch (operation.type) {
                case FlowProjectOperationType.UPDATE_FLOW: {
                    const flowUpdated = await projectStateHelper(log).updateFlowInProject(operation.flowState, operation.newFlowState, projectId)
                    await this.assignFolderFromState({
                        flowState: operation.newFlowState,
                        targetFlowId: flowUpdated.id,
                        projectId,
                        platformId,
                        folderIdMap,
                        sourceFolders,
                    })
                    const keepOriginalState = projectStateHelper(log).republishFlow({ flow: flowUpdated, projectId, status: operation.flowState.status })
                    publishJobs.push(keepOriginalState)
                    break
                }
                case FlowProjectOperationType.CREATE_FLOW: {
                    const flowCreated = await projectStateHelper(log).createFlowInProject(operation.flowState, projectId)
                    await this.assignFolderFromState({
                        flowState: operation.flowState,
                        targetFlowId: flowCreated.id,
                        projectId,
                        platformId,
                        folderIdMap,
                        sourceFolders,
                    })
                    const alwaysEnableNewFlow = projectStateHelper(log).republishFlow({ flow: flowCreated, projectId, status: FlowStatus.ENABLED })
                    publishJobs.push(alwaysEnableNewFlow)
                    break
                }
                case FlowProjectOperationType.DELETE_FLOW: {
                    await projectStateHelper(log).deleteFlowFromProject(operation.flowState.id, projectId)
                    break
                }
            }
        }
    },
    async applyFolders({ projectId, folders }: ApplyFoldersParams): Promise<Map<string, string>> {
        const folderIdMap = new Map<string, string>()
        const existingFolders = await flowFolderService(log).listAllByProject({ projectId })
        for (const folder of existingFolders) {
            if (!isNil(folder.externalId)) {
                folderIdMap.set(folder.externalId, folder.id)
            }
        }
        for (const operation of folders) {
            switch (operation.type) {
                case FolderOperationType.CREATE_FOLDER: {
                    const folder = await flowFolderService(log).upsertByExternalId({
                        projectId,
                        externalId: operation.folderState.externalId,
                        displayName: operation.folderState.displayName,
                        displayOrder: operation.folderState.displayOrder,
                    })
                    folderIdMap.set(operation.folderState.externalId, folder.id)
                    break
                }
                case FolderOperationType.UPDATE_FOLDER: {
                    const folder = await flowFolderService(log).upsertByExternalId({
                        projectId,
                        externalId: operation.newFolderState.externalId,
                        displayName: operation.newFolderState.displayName,
                        displayOrder: operation.newFolderState.displayOrder,
                    })
                    folderIdMap.set(operation.newFolderState.externalId, folder.id)
                    break
                }
                case FolderOperationType.DELETE_FOLDER: {
                    await flowFolderService(log).deleteByExternalId({
                        projectId,
                        externalId: operation.folderState.externalId,
                    })
                    break
                }
            }
        }
        return folderIdMap
    },
    async assignFolderFromState({ flowState, targetFlowId, projectId, platformId, folderIdMap, sourceFolders }: AssignFolderParams): Promise<void> {
        const sourceFolderId = flowState.folderId
        if (isNil(sourceFolderId)) {
            return
        }
        const sourceFolderExternalId = sourceFolders.find((folder) => folder.id === sourceFolderId)?.externalId
        if (isNil(sourceFolderExternalId)) {
            return
        }
        const targetFolderId = folderIdMap.get(sourceFolderExternalId)
        if (isNil(targetFolderId)) {
            return
        }
        await flowService(log).update({
            id: targetFlowId,
            projectId,
            platformId,
            userId: null,
            emitEvents: false,
            operation: {
                type: FlowOperationType.CHANGE_FOLDER,
                request: {
                    folderId: targetFolderId,
                },
            },
        })
    },
    async save(projectId: ProjectId, name: string, log: FastifyBaseLogger): Promise<FileId> {
        const fileToSave: ProjectState = await this.getProjectState(projectId, log)

        const fileData = Buffer.from(JSON.stringify(fileToSave))

        const file = await fileService(log).save({
            projectId,
            type: FileType.PROJECT_RELEASE,
            fileName: `${name}.json`,
            size: fileData.byteLength,
            data: fileData,
            compression: FileCompression.NONE,
        })
        return file.id
    },
    async getStateFromRelease(projectId: ProjectId, fileId: FileId, log: FastifyBaseLogger): Promise<ProjectState> {
        const file = await fileService(log).getFileOrThrow({
            projectId,
            fileId,
            type: FileType.PROJECT_RELEASE,
        })
        return JSON.parse(file.data.toString()) as ProjectState
    },
    async getProjectState(projectId: ProjectId, log: FastifyBaseLogger): Promise<ProjectState> {
        const flows = await flowRepo().find({
            where: {
                projectId,
            },
        })
        const flowIds = flows.map((f) => f.id)

        const [flowVersionMap, triggerSourceMap, connections, tables, folders] = await Promise.all([
            flowVersionService(log).getLatestVersionsByFlowIds(flowIds, projectId),
            triggerSourceService(log).getByFlowIds({ flowIds, projectId }),
            appConnectionService(log).getManyConnectionStates({ projectId }),
            getAllTables({ projectId }),
            flowFolderService(log).listAllByProject({ projectId }),
        ])
        const allPopulatedFlows: PopulatedFlow[] = flows
            .filter((flow) => flowVersionMap.has(flow.id))
            .map((flow) => {
                const triggerSource = triggerSourceMap.get(flow.id)
                return {
                    ...flow,
                    version: flowVersionMap.get(flow.id)!,
                    triggerSource: triggerSource ? {
                        schedule: triggerSource.schedule,
                    } : undefined,
                }
            })

        const tableIds = tables.map((t) => t.id)
        const fieldsMap = await fieldService.getAllByTableIds({ projectId, tableIds })
        const populatedTables: PopulatedTable[] = tables.map((table) => ({
            ...table,
            fields: fieldsMap.get(table.id) ?? [],
        }))

        const folderStates: FolderState[] = folders.map((folder) => ({
            id: folder.id,
            externalId: folder.externalId ?? folder.id,
            displayName: folder.displayName,
            displayOrder: folder.displayOrder,
        }))

        return toProjectState({
            flows: allPopulatedFlows,
            connections,
            tables: populatedTables,
            folders: folderStates,
            log,
        })
    },
    async getFlowState(flow: PopulatedFlow): Promise<FlowState> {
        const migratedVersion = await flowMigrations.apply(flow.version)
        const flowState: FlowState = {
            ...flow,
            operationStatus: flow.operationStatus ?? FlowOperationStatus.NONE,
            externalId: flow.externalId ?? flow.id,
            version: migratedVersion,
        }
        return cleanFlowStateUtil.cleanFlowState(flowState)
    },
    getTableState(table: PopulatedTable): TableState {
        const fields: FieldState[] = table.fields.map((field) => ({
            name: field.name,
            type: field.type,
            externalId: field.externalId,
            data: field.type === FieldType.STATIC_DROPDOWN ? field.data : undefined,
        }))
        const tableState: TableState = {
            id: table.id,
            externalId: table.externalId ?? table.id,
            name: table.name,
            fields,
        }
        return TableState.parse(tableState)
    },
})

async function toProjectState({ flows, connections, tables, folders, log }: ToProjectStateParams): Promise<ProjectState> {
    const flowsInProjectState: FlowState[] = await Promise.all(flows.map(async (flow) => projectStateService(log).getFlowState(flow)))

    const tablesInProjectState: TableState[] = tables.map((table) => projectStateService(log).getTableState(table))

    return {
        flows: flowsInProjectState,
        connections,
        tables: tablesInProjectState,
        folders,
    }
}

async function getAllTables({ projectId }: { projectId: ProjectId }): Promise<Table[]> {
    const result: Table[] = []
    let cursor: string | undefined
    do {
        const page = await tableService.list({
            folderId: undefined,
            projectId,
            cursor,
            limit: 200,
            name: undefined,
            externalIds: undefined,
        })
        result.push(...page.data)
        cursor = page.next ?? undefined
    } while (!isNil(cursor))
    return result
}

type ApplyProjectStateRequest = {
    projectId: string
    diffs: DiffState
    log: FastifyBaseLogger
    platformId: string
    sourceFolders?: FolderState[]
}

type ApplyFoldersParams = {
    projectId: ProjectId
    folders: DiffState['folders']
}

type AssignFolderParams = {
    flowState: FlowState
    targetFlowId: string
    projectId: ProjectId
    platformId: string
    folderIdMap: Map<string, string>
    sourceFolders: FolderState[]
}

type ToProjectStateParams = {
    flows: PopulatedFlow[]
    connections: ConnectionState[]
    tables: PopulatedTable[]
    folders: FolderState[]
    log: FastifyBaseLogger
}