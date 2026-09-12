import { ProjectId } from '@activepieces/core-utils'
import {
    FlowOperationRequest,
    FlowOperationType,
    FlowVersion,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { sampleDataService } from '../../step-run/sample-data.service'
import { buildImportVersionOperations } from './import-version-operations'

/**
 * Context handed to operation expanders. `loadVersionOrThrow` lets an
 * expander fetch other versions without importing flowVersionService
 * directly (that would be a circular import).
 */
export type ExpandOperationContext = {
    log: FastifyBaseLogger
    projectId: ProjectId
    flowVersion: FlowVersion
    loadVersionOrThrow: (versionId: string) => Promise<FlowVersion>
}

/**
 * Some operations coming from the UI are composite: they have to be
 * translated into an ordered list of the primitive operations understood by
 * flowOperations.apply. Each expander performs any side-effectful data
 * preparation needed by its operation and returns that ordered list.
 *
 * Operations without an expander are applied as-is.
 */
export type OperationExpander = (
    operation: FlowOperationRequest,
    context: ExpandOperationContext
) => Promise<FlowOperationRequest[]>

const useAsDraftExpander: OperationExpander = async (operation, context) => {
    if (operation.type !== FlowOperationType.USE_AS_DRAFT) {
        return []
    }
    const previousVersion = await context.loadVersionOrThrow(
        operation.request.versionId,
    )
    return buildImportVersionOperations(previousVersion)
}

const saveSampleDataExpander: OperationExpander = async (
    operation,
    context,
) => {
    if (operation.type !== FlowOperationType.SAVE_SAMPLE_DATA) {
        return []
    }
    const sampleDataSettings = await sampleDataService(
        context.log,
    ).saveSampleDataFileIdsInStep({
        projectId: context.projectId,
        flowVersionId: context.flowVersion.id,
        stepName: operation.request.stepName,
        payload: operation.request.payload,
        type: operation.request.type,
    })
    return [
        {
            type: FlowOperationType.UPDATE_SAMPLE_DATA_INFO,
            request: {
                stepName: operation.request.stepName,
                sampleDataSettings,
            },
        },
    ]
}

/**
 * Registry of composite operations. To support a new composite operation,
 * add an entry here with its expander instead of growing a switch statement
 * inside flowVersionService.applyOperation.
 */
export const operationExpanders: Partial<
Record<FlowOperationType, OperationExpander>
> = {
    [FlowOperationType.USE_AS_DRAFT]: useAsDraftExpander,
    [FlowOperationType.SAVE_SAMPLE_DATA]: saveSampleDataExpander,
}

export async function expandOperation(
    operation: FlowOperationRequest,
    context: ExpandOperationContext,
): Promise<FlowOperationRequest[]> {
    const expander = operationExpanders[operation.type]
    return expander ? expander(operation, context) : [operation]
}
