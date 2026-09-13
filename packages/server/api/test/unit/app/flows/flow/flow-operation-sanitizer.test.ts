import { describe, expect, it } from 'vitest'
import {
    FlowActionType,
    FlowOperationType,
    FlowTriggerType,
    FlowVersionState,
} from '@activepieces/shared'
import type { FlowOperationRequest, FlowVersion } from '@activepieces/shared'

import { flowOperationSanitizer } from '../../../../../src/app/flows/flow/flow-operation-sanitizer'

function makeFlowVersion(): FlowVersion {
    return {
        id: 'fv-1',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        flowId: 'flow-1',
        displayName: 'Flow',
        updatedBy: null,
        valid: true,
        schemaVersion: null,
        agentIds: [],
        state: FlowVersionState.DRAFT,
        connectionIds: [],
        backupFiles: null,
        notes: [],
        trigger: {
            name: 'trigger',
            type: FlowTriggerType.PIECE,
            valid: true,
            displayName: 'Trigger',
            lastUpdatedDate: '2024-01-01T00:00:00Z',
            settings: {
                pieceName: '@activepieces/piece-foo',
                pieceVersion: '~0.0.1',
                triggerName: 'foo',
                input: {},
                sampleData: {
                    sampleDataFileId: 'foreign-file-id',
                    sampleDataInputFileId: 'foreign-input-file-id',
                    lastTestDate: '2024-01-02T00:00:00Z',
                },
            },
            nextAction: {
                name: 'step_1',
                type: FlowActionType.PIECE,
                valid: true,
                displayName: 'Action',
                skip: false,
                lastUpdatedDate: '2024-01-01T00:00:00Z',
                settings: {
                    pieceName: '@activepieces/piece-bar',
                    pieceVersion: '~0.0.1',
                    actionName: 'bar',
                    input: {},
                    sampleData: {
                        sampleDataFileId: 'foreign-action-file-id',
                    },
                },
            },
        },
    }
}

describe('flowOperationSanitizer.sanitizeForExternalRequest', () => {
    it('strips sample data file ids from every step on IMPORT_FLOW', () => {
        const operation: FlowOperationRequest = {
            type: FlowOperationType.IMPORT_FLOW,
            request: {
                displayName: 'Imported',
                trigger: makeFlowVersion().trigger,
                schemaVersion: null,
                notes: null,
            },
        }

        const sanitized = flowOperationSanitizer.sanitizeForExternalRequest(operation)
        if (sanitized.type !== FlowOperationType.IMPORT_FLOW) {
            throw new Error('expected IMPORT_FLOW operation')
        }
        expect(sanitized.request.trigger.settings.sampleData).toBeUndefined()
        const action = sanitized.request.trigger.nextAction
        expect(action?.settings.sampleData).toBeUndefined()
    })

    it('leaves non-import operations untouched', () => {
        const operation: FlowOperationRequest = {
            type: FlowOperationType.CHANGE_NAME,
            request: { displayName: 'New name' },
        }
        expect(flowOperationSanitizer.sanitizeForExternalRequest(operation)).toBe(operation)
    })

    it('does not mutate the original operation', () => {
        const operation: FlowOperationRequest = {
            type: FlowOperationType.IMPORT_FLOW,
            request: {
                displayName: 'Imported',
                trigger: makeFlowVersion().trigger,
                schemaVersion: null,
                notes: null,
            },
        }
        flowOperationSanitizer.sanitizeForExternalRequest(operation)
        expect(operation.request.trigger.settings.sampleData?.sampleDataFileId).toBe('foreign-file-id')
    })
})
