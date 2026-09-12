import {
    FlowOperationRequest,
    FlowOperationType,
    FlowTriggerType,
    FlowVersion,
} from '@activepieces/shared'

/**
 * Operations that replace the current trigger/contents of a flow version with
 * the ones of another version (e.g. importing an old version as draft).
 *
 * IMPORT_FLOW never carries trigger sample data (its request schemas strip it),
 * so when the source version has a PIECE trigger with sample data a second
 * operation restores it after the import.
 */
export function buildImportVersionOperations(
    source: Pick<
    FlowVersion,
    'trigger' | 'displayName' | 'schemaVersion' | 'notes'
    >,
): FlowOperationRequest[] {
    const operations: FlowOperationRequest[] = [
        {
            type: FlowOperationType.IMPORT_FLOW,
            request: {
                trigger: source.trigger,
                displayName: source.displayName,
                schemaVersion: source.schemaVersion,
                notes: source.notes,
            },
        },
    ]
    if (
        source.trigger.type === FlowTriggerType.PIECE &&
    source.trigger.settings.sampleData !== undefined &&
    source.trigger.settings.sampleData !== null
    ) {
        operations.push({
            type: FlowOperationType.UPDATE_SAMPLE_DATA_INFO,
            request: {
                stepName: source.trigger.name,
                sampleDataSettings: source.trigger.settings.sampleData,
            },
        })
    }
    return operations
}
