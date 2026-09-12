import { FlowActionType, FlowTriggerType } from '@activepieces/core-execution'
import { z } from 'zod'

/**
 * Contract for the piece compatibility checker. Admins pick two versions of a
 * piece and a set of flow versions (pasted JSON or read from a project) and
 * get a per-step report telling them whether saved configuration is still
 * accepted by the new version before they enable automation on it.
 */

export const MAX_PASTED_FLOW_VERSIONS = 200
export const MAX_PROJECT_FLOWS_PER_CHECK = 500

export enum PieceCompatibilityIssueSeverity {
    INCOMPATIBLE = 'INCOMPATIBLE',
    REAUTH_REQUIRED = 'REAUTH_REQUIRED',
    DISPLAY_ONLY = 'DISPLAY_ONLY',
}

export enum PieceCompatibilityIssueCode {
    ACTION_OR_TRIGGER_REMOVED = 'ACTION_OR_TRIGGER_REMOVED',
    ACTION_OR_TRIGGER_MISSING = 'ACTION_OR_TRIGGER_MISSING',
    TRIGGER_STRATEGY_CHANGED = 'TRIGGER_STRATEGY_CHANGED',
    TRIGGER_CONFIG_CHANGED = 'TRIGGER_CONFIG_CHANGED',
    PROPERTY_REMOVED = 'PROPERTY_REMOVED',
    PROPERTY_TYPE_CHANGED = 'PROPERTY_TYPE_CHANGED',
    PROPERTY_ADDED = 'PROPERTY_ADDED',
    PROPERTY_BECAME_REQUIRED = 'PROPERTY_BECAME_REQUIRED',
    PROPERTY_DISPLAY_CHANGED = 'PROPERTY_DISPLAY_CHANGED',
    DEFAULT_VALUE_CHANGED = 'DEFAULT_VALUE_CHANGED',
    SAVED_VALUE_NOT_IN_OPTIONS = 'SAVED_VALUE_NOT_IN_OPTIONS',
    SAVED_VALUE_INVALID_TYPE = 'SAVED_VALUE_INVALID_TYPE',
    STATIC_OPTIONS_CHANGED = 'STATIC_OPTIONS_CHANGED',
    DYNAMIC_OPTIONS_CHANGED = 'DYNAMIC_OPTIONS_CHANGED',
    DYNAMIC_SETTINGS_MISSING = 'DYNAMIC_SETTINGS_MISSING',
    AUTH_REQUIREMENT_ADDED = 'AUTH_REQUIREMENT_ADDED',
    AUTH_REQUIREMENT_REMOVED = 'AUTH_REQUIREMENT_REMOVED',
    AUTH_TYPE_CHANGED = 'AUTH_TYPE_CHANGED',
    AUTH_CONFIG_CHANGED = 'AUTH_CONFIG_CHANGED',
}

export enum PieceStepCompatibilityVerdict {
    COMPATIBLE = 'COMPATIBLE',
    DISPLAY_ONLY = 'DISPLAY_ONLY',
    REAUTH_REQUIRED = 'REAUTH_REQUIRED',
    INCOMPATIBLE = 'INCOMPATIBLE',
}

export enum FlowCompatibilityStatus {
    CHECKED = 'CHECKED',
    NOT_USING_PIECE = 'NOT_USING_PIECE',
    ERROR = 'ERROR',
}

export const PastedFlowVersionSource = z.object({
    type: z.literal('PASTED'),
    flowVersions: z.array(z.unknown()).min(1).max(MAX_PASTED_FLOW_VERSIONS),
})
export type PastedFlowVersionSource = z.infer<typeof PastedFlowVersionSource>

export const ProjectFlowVersionSource = z.object({
    type: z.literal('PROJECT'),
    projectId: z.string().min(1),
    flowIds: z.array(z.string().min(1)).min(1).max(MAX_PROJECT_FLOWS_PER_CHECK).optional(),
})
export type ProjectFlowVersionSource = z.infer<typeof ProjectFlowVersionSource>

export const CheckPieceCompatibilityRequest = z.object({
    pieceName: z.string().min(1),
    fromVersion: z.string().min(1),
    toVersion: z.string().min(1),
    source: z.discriminatedUnion('type', [
        PastedFlowVersionSource,
        ProjectFlowVersionSource,
    ]),
})
export type CheckPieceCompatibilityRequest = z.infer<typeof CheckPieceCompatibilityRequest>

/**
 * A single finding. Messages describe structure only — they must never embed
 * saved input values or connection references, so reports are safe to share.
 */
export const PieceCompatibilityIssue = z.object({
    code: z.nativeEnum(PieceCompatibilityIssueCode),
    severity: z.nativeEnum(PieceCompatibilityIssueSeverity),
    propertyName: z.string().optional(),
    message: z.string(),
})
export type PieceCompatibilityIssue = z.infer<typeof PieceCompatibilityIssue>

export const PieceStepCompatibilityResult = z.object({
    stepName: z.string(),
    stepDisplayName: z.string(),
    stepType: z.union([z.literal(FlowActionType.PIECE), z.literal(FlowTriggerType.PIECE)]),
    actionOrTriggerName: z.string().nullable(),
    pieceVersion: z.string(),
    verdict: z.nativeEnum(PieceStepCompatibilityVerdict),
    connectionConfigured: z.boolean(),
    issues: z.array(PieceCompatibilityIssue),
})
export type PieceStepCompatibilityResult = z.infer<typeof PieceStepCompatibilityResult>

export const FlowCompatibilityResult = z.object({
    status: z.nativeEnum(FlowCompatibilityStatus),
    flowId: z.string().nullable(),
    flowVersionId: z.string().nullable(),
    flowDisplayName: z.string().nullable(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable(),
    error: z.string().optional(),
    steps: z.array(PieceStepCompatibilityResult),
})
export type FlowCompatibilityResult = z.infer<typeof FlowCompatibilityResult>

export const PieceCompatibilitySummary = z.object({
    flowsChecked: z.number(),
    flowsErrored: z.number(),
    flowsNotUsingPiece: z.number(),
    stepsChecked: z.number(),
    compatibleSteps: z.number(),
    displayOnlySteps: z.number(),
    reauthRequiredSteps: z.number(),
    incompatibleSteps: z.number(),
})
export type PieceCompatibilitySummary = z.infer<typeof PieceCompatibilitySummary>

export const PieceCompatibilityReport = z.object({
    pieceName: z.string(),
    fromVersion: z.string(),
    toVersion: z.string(),
    generatedAt: z.string(),
    summary: PieceCompatibilitySummary,
    flows: z.array(FlowCompatibilityResult),
})
export type PieceCompatibilityReport = z.infer<typeof PieceCompatibilityReport>
