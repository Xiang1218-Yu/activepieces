import { isNil } from '@activepieces/core-utils'
import {
    ConnectionMigrationItem,
    ConnectionOperationType,
    ConnectionState,
    FlowActionType,
    FlowMigrationItem,
    FlowProjectOperationType,
    FlowState,
    flowStructureUtil,
    FlowTriggerType,
    FolderMigrationItem,
    FolderOperationType,
    FolderState,
    ProjectMigrationBlocker,
    ProjectMigrationBlockerSeverity,
    ProjectMigrationBlockerType,
    ProjectMigrationItem,
    ProjectMigrationMissingPiece,
    ProjectMigrationOperationStatus,
    ProjectMigrationResourceCounts,
    ProjectMigrationResourceType,
    ProjectMigrationSnapshot,
    ProjectMigrationSummary,
    ProjectState,
    ProjectSyncPlan,
    TableMigrationItem,
    TableOperationType,
    TableState,
} from '@activepieces/shared'
import deepEqual from 'deep-equal'

type BuildReportParams = {
    snapshot: ProjectMigrationSnapshot
    availablePieceKeys: Set<string>
}

export const projectMigrationReportService = {
    buildSummary({ snapshot, availablePieceKeys }: BuildReportParams): ProjectMigrationSummary {
        const items = groupAllItems({ snapshot, availablePieceKeys })
        const totals = {} as Record<ProjectMigrationResourceType, ProjectMigrationResourceCounts>
        for (const resourceType of Object.values(ProjectMigrationResourceType)) {
            totals[resourceType] = countItems(items[resourceType])
        }
        const hasBlockers = Object.values(totals).some((counts) => counts.blocked > 0)
        return {
            sourceProjectId: snapshot.sourceProjectId,
            targetProjectId: snapshot.targetProjectId,
            generatedAt: snapshot.generatedAt,
            snapshotToken: '',
            totals,
            hasBlockers,
        }
    },
    getPage({ snapshot, plan, resourceType, offset, limit, availablePieceKeys }: GetPageParams): { data: ProjectMigrationItem[], nextOffset: number | null } {
        const items = groupItems({ snapshot, plan, resourceType, availablePieceKeys })
        const page = items.slice(offset, offset + limit)
        const nextOffset = offset + limit < items.length ? offset + limit : null
        return { data: page, nextOffset }
    },
}

function groupAllItems({ snapshot, availablePieceKeys }: { snapshot: ProjectMigrationSnapshot, availablePieceKeys: Set<string> }): Record<ProjectMigrationResourceType, ProjectMigrationItem[]> {
    const sourceState = ProjectState.parse(snapshot.sourceState)
    const targetState = ProjectState.parse(snapshot.targetState)
    return {
        [ProjectMigrationResourceType.FLOW]: buildFlowItems({ sourceState, targetState, availablePieceKeys }),
        [ProjectMigrationResourceType.TABLE]: buildTableItems({ sourceState, targetState }),
        [ProjectMigrationResourceType.CONNECTION]: buildConnectionItems({ sourceState, targetState }),
        [ProjectMigrationResourceType.FOLDER]: buildFolderItems({ sourceState, targetState }),
    }
}

function groupItems({ snapshot, plan, resourceType, availablePieceKeys }: { snapshot: ProjectMigrationSnapshot, plan: ProjectSyncPlan, resourceType: ProjectMigrationResourceType, availablePieceKeys: Set<string> }): ProjectMigrationItem[] {
    const sourceState = ProjectState.parse(snapshot.sourceState)
    const targetState = ProjectState.parse(snapshot.targetState)
    switch (resourceType) {
        case ProjectMigrationResourceType.FLOW:
            return buildFlowItems({ sourceState, targetState, flowPlan: plan.flows, availablePieceKeys })
        case ProjectMigrationResourceType.TABLE:
            return buildTableItems({ sourceState, targetState })
        case ProjectMigrationResourceType.CONNECTION:
            return buildConnectionItems({ sourceState, targetState })
        case ProjectMigrationResourceType.FOLDER:
            return buildFolderItems({ sourceState, targetState })
    }
}

function buildFlowItems({ sourceState, targetState, flowPlan, availablePieceKeys }: BuildFlowItemsParams): FlowMigrationItem[] {
    const itemsFromSource: FlowMigrationItem[] = sourceState.flows.map((sourceFlow) => {
        const targetFlow = targetState.flows.find((flow) => flow.externalId === sourceFlow.externalId)
        const status = isNil(targetFlow)
            ? ProjectMigrationOperationStatus.WILL_CREATE
            : flowsAreEqual(sourceFlow, targetFlow)
                ? ProjectMigrationOperationStatus.NO_CHANGE
                : ProjectMigrationOperationStatus.WILL_UPDATE
        const blockers = isNil(targetFlow) || status === ProjectMigrationOperationStatus.WILL_UPDATE
            ? findFlowBlockers({ sourceFlow, sourceState, targetState, availablePieceKeys })
            : []
        const planOperation = flowPlan?.find((operation) => {
            if (operation.type !== mapFlowStatus(status)) {
                return false
            }
            if (operation.type === FlowProjectOperationType.UPDATE_FLOW) {
                return operation.targetFlow.id === targetFlow?.id
            }
            return operation.flow.id === sourceFlow.id
        })
        return {
            resourceType: ProjectMigrationResourceType.FLOW,
            status,
            sourceFlowState: sourceFlow,
            targetFlowState: targetFlow ?? null,
            operation: planOperation ?? null,
            blockers,
            isBlocked: blockers.some((blocker) => blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER),
        }
    })
    const deletedItems: FlowMigrationItem[] = targetState.flows
        .filter((targetFlow) => !sourceState.flows.some((flow) => flow.externalId === targetFlow.externalId))
        .map((targetFlow) => ({
            resourceType: ProjectMigrationResourceType.FLOW,
            status: ProjectMigrationOperationStatus.WILL_DELETE,
            sourceFlowState: null,
            targetFlowState: targetFlow,
            operation: {
                type: FlowProjectOperationType.DELETE_FLOW,
                flow: {
                    id: targetFlow.id,
                    displayName: targetFlow.version.displayName,
                },
            },
            blockers: [],
            isBlocked: false,
        }))
    return [...itemsFromSource, ...deletedItems]
}

function mapFlowStatus(status: ProjectMigrationOperationStatus): FlowProjectOperationType | null {
    switch (status) {
        case ProjectMigrationOperationStatus.WILL_CREATE:
            return FlowProjectOperationType.CREATE_FLOW
        case ProjectMigrationOperationStatus.WILL_UPDATE:
            return FlowProjectOperationType.UPDATE_FLOW
        case ProjectMigrationOperationStatus.WILL_DELETE:
            return FlowProjectOperationType.DELETE_FLOW
        case ProjectMigrationOperationStatus.NO_CHANGE:
            return null
    }
}

function flowsAreEqual(sourceFlow: FlowState, targetFlow: FlowState): boolean {
    return sourceFlow.version.displayName === targetFlow.version.displayName
        && deepEqual(normalizeTrigger(sourceFlow), normalizeTrigger(targetFlow))
        && deepEqual(
            Object.fromEntries(sourceFlow.version.notes.map((note) => [note.id, note.content])),
            Object.fromEntries(targetFlow.version.notes.map((note) => [note.id, note.content])),
        )
        && pieceVersionsMatch(sourceFlow, targetFlow)
}

function normalizeTrigger(flow: FlowState): unknown {
    return flowStructureUtil.transferFlow(flow.version, (step) => {
        const clonedStep = JSON.parse(JSON.stringify(step))
        clonedStep.settings.sampleData = undefined
        clonedStep.lastUpdatedDate = ''
        const authExists = clonedStep?.settings?.input?.auth
        if (clonedStep.type === FlowActionType.PIECE || clonedStep.type === FlowTriggerType.PIECE) {
            clonedStep.settings.pieceVersion = ''
            if (authExists) {
                clonedStep.settings.input.auth = ''
            }
        }
        return clonedStep
    }).trigger
}

function pieceVersionsMatch(sourceFlow: FlowState, targetFlow: FlowState): boolean {
    const sourceVersions = collectPieceVersions(sourceFlow)
    const targetVersions = collectPieceVersions(targetFlow)
    for (const [stepName, version] of sourceVersions) {
        if (targetVersions.get(stepName) !== version) {
            return false
        }
    }
    return sourceVersions.size === targetVersions.size
}

function collectPieceVersions(flow: FlowState): Map<string, string> {
    const versions = new Map<string, string>()
    flowStructureUtil.getAllSteps(flow.version.trigger).forEach((step) => {
        if (step.type === FlowActionType.PIECE || step.type === FlowTriggerType.PIECE) {
            const version = step.settings.pieceVersion.startsWith('^') || step.settings.pieceVersion.startsWith('~')
                ? step.settings.pieceVersion.slice(1)
                : step.settings.pieceVersion
            versions.set(step.name, version)
        }
    })
    return versions
}

function findFlowBlockers({ sourceFlow, sourceState, targetState, availablePieceKeys }: { sourceFlow: FlowState, sourceState: ProjectState, targetState: ProjectState, availablePieceKeys: Set<string> }): ProjectMigrationBlocker[] {
    const blockers: ProjectMigrationBlocker[] = []
    const missingPieces = findMissingPieces({ sourceFlow, availablePieceKeys })
    for (const piece of missingPieces) {
        blockers.push({
            type: ProjectMigrationBlockerType.MISSING_PIECE,
            severity: ProjectMigrationBlockerSeverity.BLOCKER,
            message: `Piece ${piece.pieceName}@${piece.pieceVersion} used by step ${piece.stepName} is not available in the target project`,
            piece,
            connectionExternalId: null,
            connectionDisplayName: null,
        })
    }
    const missingConnections = findMissingConnections({ sourceFlow, sourceState, targetState })
    for (const connection of missingConnections) {
        blockers.push({
            type: ProjectMigrationBlockerType.MISSING_CONNECTION,
            severity: ProjectMigrationBlockerSeverity.WARNING,
            message: `Connection ${connection.displayName} for ${connection.pieceName} is missing in the target project and will be created as a placeholder`,
            piece: null,
            connectionExternalId: connection.externalId,
            connectionDisplayName: connection.displayName,
        })
    }
    return blockers
}

function findMissingPieces({ sourceFlow, availablePieceKeys }: { sourceFlow: FlowState, availablePieceKeys: Set<string> }): ProjectMigrationMissingPiece[] {
    const steps = flowStructureUtil.getAllSteps(sourceFlow.version.trigger)
    const missingPieces: ProjectMigrationMissingPiece[] = []
    const seen = new Set<string>()
    for (const step of steps) {
        if (step.type !== FlowActionType.PIECE && step.type !== FlowTriggerType.PIECE) {
            continue
        }
        const pieceName = step.settings.pieceName
        const pieceVersion = step.settings.pieceVersion
        if (isNil(pieceName) || isNil(pieceVersion)) {
            continue
        }
        const key = `${pieceName}@${pieceVersion}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        const available = availablePieceKeys.has(key) || availablePieceKeys.has(pieceName)
        if (available) {
            continue
        }
        missingPieces.push({
            pieceName,
            pieceVersion,
            stepName: step.name,
            stepDisplayName: step.displayName ?? null,
        })
    }
    return missingPieces
}

function findMissingConnections({ sourceFlow, sourceState, targetState }: { sourceFlow: FlowState, sourceState: ProjectState, targetState: ProjectState }): { externalId: string, displayName: string, pieceName: string }[] {
    const steps = flowStructureUtil.getAllSteps(sourceFlow.version.trigger)
    const missing: { externalId: string, displayName: string, pieceName: string }[] = []
    const seen = new Set<string>()
    for (const step of steps) {
        if (step.type !== FlowActionType.PIECE && step.type !== FlowTriggerType.PIECE) {
            continue
        }
        const authValue = step.settings.input?.auth
        const authExternalIds = typeof authValue === 'string' ? extractConnectionExternalIds(authValue) : []
        for (const authExternalId of authExternalIds) {
            const existsInTarget = targetState.connections?.some((connection) => connection.externalId === authExternalId)
            if (existsInTarget || seen.has(authExternalId)) {
                continue
            }
            seen.add(authExternalId)
            const sourceConnection = sourceState.connections?.find((connection) => connection.externalId === authExternalId)
            missing.push({
                externalId: authExternalId,
                displayName: sourceConnection?.displayName ?? `${step.settings.pieceName} (${authExternalId})`,
                pieceName: sourceConnection?.pieceName ?? step.settings.pieceName,
            })
        }
    }
    return missing
}

function extractConnectionExternalIds(authValue: string): string[] {
    const match = authValue.match(/\{\{connections\['([^']*(?:'\s*,\s*'[^'])*)'\]\}\}/)
    if (isNil(match) || isNil(match[1])) {
        return []
    }
    return match[1].split(/'\s*,\s*'/).map((id) => id.trim())
}

function buildTableItems({ sourceState, targetState }: { sourceState: ProjectState, targetState: ProjectState }): TableMigrationItem[] {
    const sourceTables = sourceState.tables ?? []
    const itemsFromSource: TableMigrationItem[] = sourceTables.map((sourceTable) => {
        const targetTable = targetState.tables?.find((table) => table.externalId === sourceTable.externalId)
        const status = isNil(targetTable)
            ? ProjectMigrationOperationStatus.WILL_CREATE
            : tablesAreEqual(sourceTable, targetTable)
                ? ProjectMigrationOperationStatus.NO_CHANGE
                : ProjectMigrationOperationStatus.WILL_UPDATE
        return {
            resourceType: ProjectMigrationResourceType.TABLE,
            status,
            sourceTableState: sourceTable,
            targetTableState: targetTable ?? null,
            operation: toTableOperation({ status, sourceTable, targetTable }),
            blockers: [],
            isBlocked: false,
        }
    })
    const deletedItems: TableMigrationItem[] = (targetState.tables ?? [])
        .filter((targetTable) => !sourceTables.some((table) => table.externalId === targetTable.externalId))
        .map((targetTable) => ({
            resourceType: ProjectMigrationResourceType.TABLE,
            status: ProjectMigrationOperationStatus.WILL_DELETE,
            sourceTableState: null,
            targetTableState: targetTable,
            operation: { type: TableOperationType.DELETE_TABLE, tableState: targetTable },
            blockers: [],
            isBlocked: false,
        }))
    return [...itemsFromSource, ...deletedItems]
}

function tablesAreEqual(sourceTable: TableState, targetTable: TableState): boolean {
    return sourceTable.name === targetTable.name
        && sourceTable.fields.length === targetTable.fields.length
        && sourceTable.fields.every((field, index) => {
            const targetField = targetTable.fields[index]
            return field.externalId === targetField.externalId
                && field.name === targetField.name
                && field.type === targetField.type
        })
}

function toTableOperation({ status, sourceTable, targetTable }: { status: ProjectMigrationOperationStatus, sourceTable: TableState, targetTable: TableState | null | undefined }): TableMigrationItem['operation'] {
    switch (status) {
        case ProjectMigrationOperationStatus.WILL_CREATE:
            return { type: TableOperationType.CREATE_TABLE, tableState: sourceTable }
        case ProjectMigrationOperationStatus.WILL_UPDATE:
            if (isNil(targetTable)) {
                return null
            }
            return { type: TableOperationType.UPDATE_TABLE, tableState: targetTable, newTableState: sourceTable }
        case ProjectMigrationOperationStatus.WILL_DELETE:
        case ProjectMigrationOperationStatus.NO_CHANGE:
            return null
    }
}

function buildConnectionItems({ sourceState, targetState }: { sourceState: ProjectState, targetState: ProjectState }): ConnectionMigrationItem[] {
    const sourceConnections = sourceState.connections ?? []
    const itemsFromSource: ConnectionMigrationItem[] = sourceConnections.map((sourceConnection) => {
        const targetConnection = targetState.connections?.find((connection) => connection.externalId === sourceConnection.externalId)
        const status = isNil(targetConnection)
            ? ProjectMigrationOperationStatus.WILL_CREATE
            : connectionsAreEqual(sourceConnection, targetConnection)
                ? ProjectMigrationOperationStatus.NO_CHANGE
                : ProjectMigrationOperationStatus.WILL_UPDATE
        return {
            resourceType: ProjectMigrationResourceType.CONNECTION,
            status,
            sourceConnectionState: sourceConnection,
            targetConnectionState: targetConnection ?? null,
            operation: toConnectionOperation({ status, sourceConnection, targetConnection }),
            blockers: [],
            isBlocked: false,
        }
    })
    const deletedItems: ConnectionMigrationItem[] = (targetState.connections ?? [])
        .filter((targetConnection) => !sourceConnections.some((connection) => connection.externalId === targetConnection.externalId))
        .map((targetConnection) => ({
            resourceType: ProjectMigrationResourceType.CONNECTION,
            status: ProjectMigrationOperationStatus.NO_CHANGE,
            sourceConnectionState: null,
            targetConnectionState: targetConnection,
            operation: null,
            blockers: [],
            isBlocked: false,
        }))
    return [...itemsFromSource, ...deletedItems]
}

function connectionsAreEqual(sourceConnection: ConnectionState, targetConnection: ConnectionState): boolean {
    return sourceConnection.pieceName === targetConnection.pieceName
        && sourceConnection.displayName === targetConnection.displayName
}

function toConnectionOperation({ status, sourceConnection, targetConnection }: { status: ProjectMigrationOperationStatus, sourceConnection: ConnectionState, targetConnection: ConnectionState | null | undefined }): ConnectionMigrationItem['operation'] {
    switch (status) {
        case ProjectMigrationOperationStatus.WILL_CREATE:
            return { type: ConnectionOperationType.CREATE_CONNECTION, connectionState: sourceConnection }
        case ProjectMigrationOperationStatus.WILL_UPDATE:
            if (isNil(targetConnection)) {
                return null
            }
            return { type: ConnectionOperationType.UPDATE_CONNECTION, connectionState: targetConnection, newConnectionState: sourceConnection }
        case ProjectMigrationOperationStatus.WILL_DELETE:
        case ProjectMigrationOperationStatus.NO_CHANGE:
            return null
    }
}

function buildFolderItems({ sourceState, targetState }: { sourceState: ProjectState, targetState: ProjectState }): FolderMigrationItem[] {
    const sourceFolders = sourceState.folders ?? []
    const itemsFromSource: FolderMigrationItem[] = sourceFolders.map((sourceFolder) => {
        const targetFolder = targetState.folders?.find((folder) => folder.externalId === sourceFolder.externalId)
        const status = isNil(targetFolder)
            ? ProjectMigrationOperationStatus.WILL_CREATE
            : foldersAreEqual(sourceFolder, targetFolder)
                ? ProjectMigrationOperationStatus.NO_CHANGE
                : ProjectMigrationOperationStatus.WILL_UPDATE
        return {
            resourceType: ProjectMigrationResourceType.FOLDER,
            status,
            sourceFolderState: sourceFolder,
            targetFolderState: targetFolder ?? null,
            operation: toFolderOperation({ status, sourceFolder, targetFolder }),
            blockers: [],
            isBlocked: false,
        }
    })
    const deletedItems: FolderMigrationItem[] = (targetState.folders ?? [])
        .filter((targetFolder) => !sourceFolders.some((folder) => folder.externalId === targetFolder.externalId))
        .map((targetFolder) => ({
            resourceType: ProjectMigrationResourceType.FOLDER,
            status: ProjectMigrationOperationStatus.WILL_DELETE,
            sourceFolderState: null,
            targetFolderState: targetFolder,
            operation: { type: FolderOperationType.DELETE_FOLDER, folderState: targetFolder },
            blockers: [],
            isBlocked: false,
        }))
    return [...itemsFromSource, ...deletedItems]
}

function foldersAreEqual(sourceFolder: FolderState, targetFolder: FolderState): boolean {
    return sourceFolder.displayName === targetFolder.displayName
        && sourceFolder.displayOrder === targetFolder.displayOrder
}

function toFolderOperation({ status, sourceFolder, targetFolder }: { status: ProjectMigrationOperationStatus, sourceFolder: FolderState, targetFolder: FolderState | null | undefined }): FolderMigrationItem['operation'] {
    switch (status) {
        case ProjectMigrationOperationStatus.WILL_CREATE:
            return { type: FolderOperationType.CREATE_FOLDER, folderState: sourceFolder }
        case ProjectMigrationOperationStatus.WILL_UPDATE:
            if (isNil(targetFolder)) {
                return null
            }
            return { type: FolderOperationType.UPDATE_FOLDER, folderState: targetFolder, newFolderState: sourceFolder }
        case ProjectMigrationOperationStatus.WILL_DELETE:
        case ProjectMigrationOperationStatus.NO_CHANGE:
            return null
    }
}

function countItems(items: ProjectMigrationItem[]): ProjectMigrationResourceCounts {
    const counts: ProjectMigrationResourceCounts = {
        create: 0,
        update: 0,
        delete: 0,
        noChange: 0,
        blocked: 0,
        total: items.length,
    }
    for (const item of items) {
        if (item.isBlocked || item.blockers.some((blocker) => blocker.severity === ProjectMigrationBlockerSeverity.BLOCKER)) {
            counts.blocked += 1
        }
        switch (item.status) {
            case ProjectMigrationOperationStatus.WILL_CREATE:
                counts.create += 1
                break
            case ProjectMigrationOperationStatus.WILL_UPDATE:
                counts.update += 1
                break
            case ProjectMigrationOperationStatus.WILL_DELETE:
                counts.delete += 1
                break
            case ProjectMigrationOperationStatus.NO_CHANGE:
                counts.noChange += 1
                break
        }
    }
    return counts
}

type BuildFlowItemsParams = {
    sourceState: ProjectState
    targetState: ProjectState
    flowPlan?: ProjectSyncPlan['flows']
    availablePieceKeys: Set<string>
}

type GetPageParams = {
    snapshot: ProjectMigrationSnapshot
    plan: ProjectSyncPlan
    resourceType: ProjectMigrationResourceType
    offset: number
    limit: number
    availablePieceKeys: Set<string>
}
