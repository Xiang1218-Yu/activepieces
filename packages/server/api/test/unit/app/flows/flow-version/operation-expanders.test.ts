import {
    FlowActionType,
    FlowOperationType,
    FlowTriggerType,
    FlowVersionState,
    PieceTrigger,
} from '@activepieces/shared'
import type { FlowOperationRequest, FlowVersion } from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { describe, expect, it, vi } from 'vitest'

const mockSaveSampleDataFileIdsInStep = vi.fn()

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({})),
}))

vi.mock('../../../../../src/app/flows/step-run/sample-data.service', () => ({
    sampleDataService: vi.fn(() => ({
        saveSampleDataFileIdsInStep: mockSaveSampleDataFileIdsInStep,
    })),
}))

import { buildImportVersionOperations } from '../../../../../src/app/flows/flow-version/operations/import-version-operations'
import { expandOperation } from '../../../../../src/app/flows/flow-version/operations/operation-expanders'

const mockLog = {} as unknown as FastifyBaseLogger

function makePieceTrigger(
    sampleData?: PieceTrigger['settings']['sampleData'],
): FlowVersion['trigger'] {
    return {
        name: 'trigger',
        valid: true,
        displayName: 'Gmail Trigger',
        lastUpdatedDate: '2024-01-01T00:00:00Z',
        type: FlowTriggerType.PIECE,
        settings: {
            pieceName: '@activepieces/piece-gmail',
            pieceVersion: '~0.1.0',
            triggerName: 'new_email',
            input: {},
            propertySettings: {},
            ...(sampleData ? { sampleData } : {}),
        },
        nextAction: {
            name: 'step_1',
            valid: true,
            displayName: 'Slack',
            lastUpdatedDate: '2024-01-01T00:00:00Z',
            type: FlowActionType.PIECE,
            settings: {
                pieceName: '@activepieces/piece-slack',
                pieceVersion: '~0.2.0',
                actionName: 'send_message',
                input: {},
                propertySettings: {},
            },
        },
    }
}

function makeVersion(trigger: FlowVersion['trigger']): FlowVersion {
    return {
        id: 'fv-src',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        flowId: 'flow-1',
        displayName: 'Old Version',
        trigger,
        updatedBy: 'user-9',
        valid: true,
        schemaVersion: '1',
        agentIds: [],
        state: FlowVersionState.LOCKED,
        connectionIds: ['conn-1'],
        notes: [],
    }
}

describe('buildImportVersionOperations', () => {
    it('imports trigger/displayName/schemaVersion/notes without leaking version-only fields', () => {
        const source = makeVersion(makePieceTrigger())
        const operations = buildImportVersionOperations(source)

        expect(operations).toHaveLength(1)
        expect(operations[0].type).toBe(FlowOperationType.IMPORT_FLOW)
        if (operations[0].type !== FlowOperationType.IMPORT_FLOW) {
            return
        }
        expect(operations[0].request.displayName).toBe('Old Version')
        expect(operations[0].request.schemaVersion).toBe('1')
        expect(operations[0].request.trigger).toBe(source.trigger)
        expect(operations[0].request.notes).toEqual([])
    })

    it('appends UPDATE_SAMPLE_DATA_INFO when the source PIECE trigger carries sample data', () => {
        const sampleData = {
            sampleDataFileId: 'file-1',
            sampleDataInputFileId: 'file-2',
            lastTestDate: '2024-01-01T00:00:00Z',
        }
        const source = makeVersion(makePieceTrigger(sampleData))
        const operations = buildImportVersionOperations(source)

        expect(operations.map((op) => op.type)).toEqual([
            FlowOperationType.IMPORT_FLOW,
            FlowOperationType.UPDATE_SAMPLE_DATA_INFO,
        ])
        const sampleDataOp = operations[1]
        if (sampleDataOp.type !== FlowOperationType.UPDATE_SAMPLE_DATA_INFO) {
            return
        }
        expect(sampleDataOp.request.stepName).toBe('trigger')
        expect(sampleDataOp.request.sampleDataSettings).toEqual(sampleData)
    })

    it('emits no sample-data operation for EMPTY triggers', () => {
        const source = makeVersion({
            name: 'trigger',
            valid: false,
            displayName: 'Select Trigger',
            lastUpdatedDate: '2024-01-01T00:00:00Z',
            type: FlowTriggerType.EMPTY,
            settings: {},
        })
        const operations = buildImportVersionOperations(source)
        expect(operations).toHaveLength(1)
        expect(operations[0].type).toBe(FlowOperationType.IMPORT_FLOW)
    })
})

describe('expandOperation', () => {
    it('returns a primitive operation unchanged without calling any expander', async () => {
        const changeName: FlowOperationRequest = {
            type: FlowOperationType.CHANGE_NAME,
            request: { displayName: 'New' },
        }
        const result = await expandOperation(changeName, {
            log: mockLog,
            projectId: 'proj-1',
            flowVersion: makeVersion(makePieceTrigger()),
            loadVersionOrThrow: vi.fn(),
        })
        expect(result).toEqual([changeName])
    })

    it('USE_AS_DRAFT loads the referenced version and expands from it', async () => {
        const previousVersion = makeVersion(
            makePieceTrigger({
                sampleDataFileId: 'file-1',
            }),
        )
        const loadVersionOrThrow = vi.fn().mockResolvedValue(previousVersion)

        const result = await expandOperation(
            {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
            {
                log: mockLog,
                projectId: 'proj-1',
                flowVersion: makeVersion(makePieceTrigger()),
                loadVersionOrThrow,
            },
        )

        expect(loadVersionOrThrow).toHaveBeenCalledWith('fv-prev')
        expect(result.map((op) => op.type)).toEqual([
            FlowOperationType.IMPORT_FLOW,
            FlowOperationType.UPDATE_SAMPLE_DATA_INFO,
        ])
    })
})
