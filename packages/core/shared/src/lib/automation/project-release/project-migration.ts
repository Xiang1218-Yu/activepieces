import { isNil, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import {
    ConnectionOperation,
    ConnectionState,
    FlowProjectOperationType,
    FlowState,
    FolderOperation,
    FolderState,
    TableOperation,
    TableState,
} from './project-state'

export enum ProjectMigrationOperationStatus {
    WILL_CREATE = 'WILL_CREATE',
    WILL_UPDATE = 'WILL_UPDATE',
    WILL_DELETE = 'WILL_DELETE',
    NO_CHANGE = 'NO_CHANGE',
}

export enum ProjectMigrationResourceType {
    FLOW = 'FLOW',
    TABLE = 'TABLE',
    CONNECTION = 'CONNECTION',
    FOLDER = 'FOLDER',
}

export enum ProjectMigrationBlockerType {
    MISSING_PIECE = 'MISSING_PIECE',
    MISSING_CONNECTION = 'MISSING_CONNECTION',
}

export enum ProjectMigrationBlockerSeverity {
    BLOCKER = 'BLOCKER',
    WARNING = 'WARNING',
}

export const ProjectMigrationMissingPiece = z.object({
    pieceName: z.string(),
    pieceVersion: z.string(),
    stepName: z.string(),
    stepDisplayName: Nullable(z.string()),
})
export type ProjectMigrationMissingPiece = z.infer<typeof ProjectMigrationMissingPiece>

export const ProjectMigrationBlocker = z.object({
    type: z.nativeEnum(ProjectMigrationBlockerType),
    severity: z.nativeEnum(ProjectMigrationBlockerSeverity),
    message: z.string(),
    piece: Nullable(ProjectMigrationMissingPiece),
    connectionExternalId: Nullable(z.string()),
    connectionDisplayName: Nullable(z.string()),
})
export type ProjectMigrationBlocker = z.infer<typeof ProjectMigrationBlocker>

const MigrationItemBase = {
    blockers: z.array(ProjectMigrationBlocker),
    isBlocked: z.boolean(),
}

export const FlowMigrationItem = z.object({
    ...MigrationItemBase,
    resourceType: z.literal(ProjectMigrationResourceType.FLOW),
    status: z.nativeEnum(ProjectMigrationOperationStatus),
    sourceFlowState: Nullable(FlowState),
    targetFlowState: Nullable(FlowState),
    operation: Nullable(z.union([
        z.object({
            type: z.literal(FlowProjectOperationType.UPDATE_FLOW),
            flow: z.object({ id: z.string(), displayName: z.string() }),
            targetFlow: z.object({ id: z.string(), displayName: z.string() }),
        }),
        z.object({
            type: z.union([
                z.literal(FlowProjectOperationType.CREATE_FLOW),
                z.literal(FlowProjectOperationType.DELETE_FLOW),
            ]),
            flow: z.object({ id: z.string(), displayName: z.string() }),
        }),
    ])),
})
export type FlowMigrationItem = z.infer<typeof FlowMigrationItem>

export const TableMigrationItem = z.object({
    ...MigrationItemBase,
    resourceType: z.literal(ProjectMigrationResourceType.TABLE),
    status: z.nativeEnum(ProjectMigrationOperationStatus),
    sourceTableState: Nullable(TableState),
    targetTableState: Nullable(TableState),
    operation: Nullable(TableOperation),
})
export type TableMigrationItem = z.infer<typeof TableMigrationItem>

export const ConnectionMigrationItem = z.object({
    ...MigrationItemBase,
    resourceType: z.literal(ProjectMigrationResourceType.CONNECTION),
    status: z.nativeEnum(ProjectMigrationOperationStatus),
    sourceConnectionState: Nullable(ConnectionState),
    targetConnectionState: Nullable(ConnectionState),
    operation: Nullable(ConnectionOperation),
})
export type ConnectionMigrationItem = z.infer<typeof ConnectionMigrationItem>

export const FolderMigrationItem = z.object({
    ...MigrationItemBase,
    resourceType: z.literal(ProjectMigrationResourceType.FOLDER),
    status: z.nativeEnum(ProjectMigrationOperationStatus),
    sourceFolderState: Nullable(FolderState),
    targetFolderState: Nullable(FolderState),
    operation: Nullable(FolderOperation),
})
export type FolderMigrationItem = z.infer<typeof FolderMigrationItem>

export const ProjectMigrationItem = z.union([
    FlowMigrationItem,
    TableMigrationItem,
    ConnectionMigrationItem,
    FolderMigrationItem,
])
export type ProjectMigrationItem = z.infer<typeof ProjectMigrationItem>

export const ProjectMigrationResourceCounts = z.object({
    create: z.number(),
    update: z.number(),
    delete: z.number(),
    noChange: z.number(),
    blocked: z.number(),
    total: z.number(),
})
export type ProjectMigrationResourceCounts = z.infer<typeof ProjectMigrationResourceCounts>

export const ProjectMigrationSummary = z.object({
    sourceProjectId: z.string(),
    targetProjectId: z.string(),
    snapshotToken: z.string(),
    generatedAt: z.string(),
    totals: z.record(z.nativeEnum(ProjectMigrationResourceType), ProjectMigrationResourceCounts),
    hasBlockers: z.boolean(),
})
export type ProjectMigrationSummary = z.infer<typeof ProjectMigrationSummary>

export const ProjectMigrationPage = z.object({
    data: z.array(ProjectMigrationItem),
    nextCursor: Nullable(z.string()),
})
export type ProjectMigrationPage = z.infer<typeof ProjectMigrationPage>

export const ProjectMigrationPrecheckReport = z.object({
    summary: ProjectMigrationSummary,
    page: ProjectMigrationPage,
})
export type ProjectMigrationPrecheckReport = z.infer<typeof ProjectMigrationPrecheckReport>

export const ProjectMigrationPrecheckRequest = z.object({
    projectId: z.string(),
    sourceProjectId: Nullable(z.string()),
    snapshotToken: Nullable(z.string()),
    resourceType: Nullable(z.nativeEnum(ProjectMigrationResourceType)),
    cursor: Nullable(z.string()),
    limit: z.coerce.number().min(1).max(200).default(20),
}).superRefine((request, ctx) => {
    if (isNil(request.snapshotToken) && isNil(request.sourceProjectId)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'missingPrecheckProjects',
        })
    }
    if (!isNil(request.snapshotToken) && isNil(request.resourceType)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'missingPrecheckResourceType',
        })
    }
})
export type ProjectMigrationPrecheckRequest = z.infer<typeof ProjectMigrationPrecheckRequest>

export const ProjectMigrationSnapshot = z.object({
    sourceProjectId: z.string(),
    targetProjectId: z.string(),
    generatedAt: z.string(),
    sourceState: z.unknown(),
    targetState: z.unknown(),
})
export type ProjectMigrationSnapshot = z.infer<typeof ProjectMigrationSnapshot>
