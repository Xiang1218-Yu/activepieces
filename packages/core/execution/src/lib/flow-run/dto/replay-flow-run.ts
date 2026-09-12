import { z } from 'zod'
import { ApId } from '@activepieces/core-utils'
import { FlowTriggerType } from '../../flows/triggers/trigger'

export enum FlowRunReplayBlockerCode {
    TRIGGER_PAYLOAD_MISSING = 'TRIGGER_PAYLOAD_MISSING',
    TRIGGER_INPUT_FILE_EXPIRED = 'TRIGGER_INPUT_FILE_EXPIRED',
    CONNECTION_MISSING = 'CONNECTION_MISSING',
    CONNECTION_ERROR = 'CONNECTION_ERROR',
    PIECE_UNAVAILABLE = 'PIECE_UNAVAILABLE',
}

export const FlowRunReplayBlocker = z.object({
    code: z.nativeEnum(FlowRunReplayBlockerCode),
    stepName: z.string(),
    stepDisplayName: z.string(),
    connectionExternalId: z.string().optional(),
    fileId: z.string().optional(),
    pieceName: z.string().optional(),
    pieceVersion: z.string().optional(),
})
export type FlowRunReplayBlocker = z.infer<typeof FlowRunReplayBlocker>

export const FlowRunReplayStep = z.object({
    name: z.string(),
    displayName: z.string(),
    order: z.number(),
    isTrigger: z.boolean(),
    pieceName: z.string().optional(),
    pieceVersion: z.string().optional(),
    connectionExternalId: z.string().optional(),
    connectionStatus: z.string().optional(),
    blockers: z.array(FlowRunReplayBlocker),
})
export type FlowRunReplayStep = z.infer<typeof FlowRunReplayStep>

export const PrepareReplayResponse = z.object({
    sourceRunId: ApId,
    flowId: ApId,
    flowVersionId: ApId,
    flowDisplayName: z.string(),
    sourceRunCreated: z.string(),
    triggerType: z.nativeEnum(FlowTriggerType).optional(),
    steps: z.array(FlowRunReplayStep),
    blockers: z.array(FlowRunReplayBlocker),
    canReplay: z.boolean(),
})
export type PrepareReplayResponse = z.infer<typeof PrepareReplayResponse>

export const CreateReplayRequestBody = z.object({
    projectId: ApId,
})
export type CreateReplayRequestBody = z.infer<typeof CreateReplayRequestBody>
