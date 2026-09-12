import { PlatformId, ProjectId, UserId } from '@activepieces/core-utils'
import {
    FlowOperationRequest,
    flowOperations,
    FlowOperationType,
    FlowVersion,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { EntityManager } from 'typeorm'
import { flowVersionSideEffects } from '../flow-version-side-effects'
import { flowVersionValidationUtil } from '../flow-version-validator-util'

export type ApplySingleOperationParams = {
    projectId: ProjectId
    platformId: PlatformId
    log: FastifyBaseLogger
    userId: UserId | null
    entityManager?: EntityManager
    flowVersion: FlowVersion
    operation: FlowOperationRequest
}

/**
 * Per-operation enrichments applied to the mutated version AFTER
 * flowOperations.apply. Registry mirrors operationExpanders: adding a hook
 * for a new operation is a single entry instead of another `if` in the loop.
 */
type PostApplyHook = (
    flowVersion: FlowVersion,
    operation: FlowOperationRequest,
    userId: UserId | null
) => FlowVersion

const setAddedNoteOwner: PostApplyHook = (flowVersion, operation, userId) => {
    if (operation.type !== FlowOperationType.ADD_NOTE) {
        return flowVersion
    }
    const noteIndex = flowVersion.notes.findIndex(
        (note) => note.id === operation.request.id,
    )
    if (noteIndex === -1) {
        return flowVersion
    }
    const updatedNotes = [...flowVersion.notes]
    updatedNotes[noteIndex] = { ...updatedNotes[noteIndex], ownerId: userId }
    return { ...flowVersion, notes: updatedNotes }
}

const postApplyHooks: Partial<Record<FlowOperationType, PostApplyHook>> = {
    [FlowOperationType.ADD_NOTE]: setAddedNoteOwner,
}

/**
 * Applies one primitive operation to a flow version:
 * 1. pre-apply side effects (sample data cleanup, webhook simulation,
 *    flow lastModified bump),
 * 2. request preparation/validation,
 * 3. pure structure application,
 * 4. post-apply enrichments (e.g. note ownership).
 *
 * Nothing is persisted here; persistence of the whole batch happens once in
 * flowVersionService.applyOperation so a failure midway leaves the stored
 * version untouched.
 */
export async function applySingleOperation({
    projectId,
    flowVersion,
    operation,
    platformId,
    log,
    userId,
    entityManager,
}: ApplySingleOperationParams): Promise<FlowVersion> {
    await flowVersionSideEffects(log).preApplyOperation({
        projectId,
        flowVersion,
        operation,
        entityManager,
    })
    const preparedOperation = await flowVersionValidationUtil(log).prepareRequest(
        { platformId, request: operation, userId },
    )
    const updatedFlowVersion = flowOperations.apply(
        flowVersion,
        preparedOperation,
    )
    const postApplyHook = postApplyHooks[preparedOperation.type]
    return postApplyHook
        ? postApplyHook(updatedFlowVersion, preparedOperation, userId)
        : updatedFlowVersion
}
