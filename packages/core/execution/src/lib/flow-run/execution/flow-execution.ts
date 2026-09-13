import { isNil } from '@activepieces/core-utils'
import { z } from 'zod'
import { StreamStepProgress } from '../../engine/engine-operation'
import type { FlowRetryStrategy } from '../flow-run'

export enum FlowRunStatus {
    FAILED = 'FAILED',
    QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    PAUSED = 'PAUSED',
    QUEUED = 'QUEUED',
    RUNNING = 'RUNNING',
    SUCCEEDED = 'SUCCEEDED',
    MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
    TIMEOUT = 'TIMEOUT',
    CANCELED = 'CANCELED',
    LOG_SIZE_EXCEEDED = 'LOG_SIZE_EXCEEDED',
}

export enum PauseType {
    DELAY = 'DELAY',
    WEBHOOK = 'WEBHOOK',
    BARRIER = 'BARRIER',
}

export const DelayPauseMetadata = z.object({
    type: z.literal(PauseType.DELAY),
    resumeDateTime: z.string(),
    requestIdToReply: z.string().optional(),
    handlerId: z.string().optional(),
    streamStepProgress: z.nativeEnum(StreamStepProgress).optional(),
})

export type DelayPauseMetadata = z.infer<typeof DelayPauseMetadata>

export const RespondResponse = z.object({
    status: z.number().optional(),
    body: z.unknown().optional(),
    headers: z.record(z.string(), z.string()).optional(),
})

export type RespondResponse = z.infer<typeof RespondResponse>

export const StopResponse = z.object({
    status: z.number().optional(),
    body: z.unknown().optional(),
    headers: z.record(z.string(), z.string()).optional(),
})

export type StopResponse = z.infer<typeof StopResponse>

export const WebhookPauseMetadata = z.object({
    type: z.literal(PauseType.WEBHOOK),
    requestId: z.string(),
    requestIdToReply: z.string().optional(),
    response: RespondResponse,
    handlerId: z.string().optional(),
    streamStepProgress: z.nativeEnum(StreamStepProgress).optional(),
})
export type WebhookPauseMetadata = z.infer<typeof WebhookPauseMetadata>

export const PauseMetadata = z.union([DelayPauseMetadata, WebhookPauseMetadata])
export type PauseMetadata = z.infer<typeof PauseMetadata>

export const isFlowRunStateTerminal = ({ status, ignoreInternalError }: { status: FlowRunStatus, ignoreInternalError: boolean }): boolean => {
    switch (status) {
        case FlowRunStatus.SUCCEEDED:
        case FlowRunStatus.TIMEOUT:
        case FlowRunStatus.FAILED:
        case FlowRunStatus.QUOTA_EXCEEDED:
        case FlowRunStatus.MEMORY_LIMIT_EXCEEDED:
        case FlowRunStatus.LOG_SIZE_EXCEEDED:
        case FlowRunStatus.CANCELED:
            return true
        case FlowRunStatus.INTERNAL_ERROR:
            return !ignoreInternalError
        case FlowRunStatus.QUEUED:
        case FlowRunStatus.RUNNING:
        case FlowRunStatus.PAUSED:
            return false
    }
}


export const FAILED_STATES = [
    FlowRunStatus.FAILED,
    FlowRunStatus.INTERNAL_ERROR,
    FlowRunStatus.QUOTA_EXCEEDED,
    FlowRunStatus.TIMEOUT,
    FlowRunStatus.MEMORY_LIMIT_EXCEEDED,
    FlowRunStatus.LOG_SIZE_EXCEEDED,
]
export const isFailedState = (status: FlowRunStatus): boolean => {
    return FAILED_STATES.includes(status)
}

export const RETRY_ON_LATEST_VERSION_STATUSES = [...FAILED_STATES, FlowRunStatus.SUCCEEDED]

export const canRetryFlowRun = ({
    status,
    archivedAt,
    strategy,
}: {
    status: FlowRunStatus
    archivedAt?: string | null
    strategy: FlowRetryStrategy
}): boolean => {
    if (!isNil(archivedAt)) {
        return false
    }
    switch (strategy) {
        case 'FROM_FAILED_STEP':
            return FAILED_STATES.includes(status)
        case 'ON_LATEST_VERSION':
            return RETRY_ON_LATEST_VERSION_STATUSES.includes(status)
    }
    return false
}

export const getFlowRunRetryUnavailableReason = ({
    status,
    archivedAt,
    strategy,
}: {
    status: FlowRunStatus
    archivedAt?: string | null
    strategy: FlowRetryStrategy
}): string | null => {
    if (!isNil(archivedAt)) {
        return 'Archived flow runs cannot be retried'
    }
    if (status === FlowRunStatus.RUNNING) {
        return 'Running flow runs cannot be retried'
    }
    if (status === FlowRunStatus.QUEUED || status === FlowRunStatus.PAUSED) {
        return 'Active flow runs cannot be retried'
    }
    if (status === FlowRunStatus.CANCELED) {
        return 'Canceled flow runs cannot be retried'
    }
    if (strategy === 'FROM_FAILED_STEP' && !FAILED_STATES.includes(status)) {
        return 'Only failed runs can be retried from failed step'
    }
    if (strategy === 'ON_LATEST_VERSION' && !RETRY_ON_LATEST_VERSION_STATUSES.includes(status)) {
        return 'This flow run cannot be retried'
    }
    return null
}
