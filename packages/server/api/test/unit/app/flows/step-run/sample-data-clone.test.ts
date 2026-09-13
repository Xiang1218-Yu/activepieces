import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    FlowActionType,
    FlowTriggerType,
    FlowVersionState,
    SampleDataFileType,
} from '@activepieces/shared'
import type { FlowVersion } from '@activepieces/shared'

const mockGetFile = vi.fn()
const mockGetDataOrUndefined = vi.fn()
const mockSaveFile = vi.fn()
const mockGetOneOrThrow = vi.fn()

vi.mock('../../../../../src/app/file/file.service', () => ({
    fileRepo: vi.fn(() => ({})),
    fileService: vi.fn(() => ({
        getFile: mockGetFile,
        getDataOrUndefined: mockGetDataOrUndefined,
        save: mockSaveFile,
    })),
}))

vi.mock('../../../../../src/app/flows/flow-version/flow-version.service', () => ({
    flowVersionService: vi.fn(() => ({
        getOneOrThrow: mockGetOneOrThrow,
    })),
}))

import type { FastifyBaseLogger } from 'fastify'
import { sampleDataService } from '../../../../../src/app/flows/step-run/sample-data.service'

const mockLog = {} as FastifyBaseLogger

function makeFlowVersion(): FlowVersion {
    return {
        id: 'fv-source',
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
                    sampleDataFileId: 'trigger-output-file',
                    sampleDataInputFileId: 'trigger-input-file',
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
                        sampleDataFileId: 'step-output-file',
                    },
                },
            },
        },
    }
}

describe('sampleDataService.cloneForNewVersion', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockGetFile.mockImplementation(({ fileId }: { fileId: string }) =>
            Promise.resolve({
                id: fileId,
                metadata: { flowVersionId: 'fv-source' },
            }),
        )
        mockGetDataOrUndefined.mockResolvedValue({
            data: Buffer.from('{}'),
            metadata: {},
        })
        mockSaveFile.mockImplementation(({ fileId }: { fileId?: string }) =>
            Promise.resolve({ id: fileId }),
        )
    })

    it('creates fresh file ids for every sample data file and returns settings per step', async () => {
        const source = makeFlowVersion()
        const target: FlowVersion = {
            ...source,
            id: 'fv-target',
        }

        const result = await sampleDataService(mockLog).cloneForNewVersion({
            projectId: 'proj-1',
            sourceFlowVersion: source,
            targetFlowVersion: target,
        })

        expect(result.size).toBe(2)
        expect(mockSaveFile).toHaveBeenCalledTimes(3)
        const savedTypes = mockSaveFile.mock.calls.map(
            (call: [{ type: SampleDataFileType }]) => call[0].type,
        )
        expect(savedTypes).toContain(SampleDataFileType.OUTPUT)
        expect(savedTypes).toContain(SampleDataFileType.INPUT)
        for (const settings of result.values()) {
            expect(settings.sampleDataFileId).not.toBe('trigger-output-file')
            expect(settings.sampleDataInputFileId).not.toBe('trigger-input-file')
        }
        expect(result.get('step_1')?.sampleDataFileId).toBeDefined()
        expect(result.get('step_1')?.sampleDataInputFileId).toBeUndefined()
    })

    it('skips files that belong to a different flow version', async () => {
        const source = makeFlowVersion()
        const target: FlowVersion = {
            ...source,
            id: 'fv-target',
        }
        mockGetFile.mockResolvedValue({
            id: 'trigger-output-file',
            metadata: { flowVersionId: 'some-other-version' },
        })

        const result = await sampleDataService(mockLog).cloneForNewVersion({
            projectId: 'proj-1',
            sourceFlowVersion: source,
            targetFlowVersion: target,
        })

        const triggerSettings = result.get('trigger')
        expect(triggerSettings?.sampleDataFileId).toBeUndefined()
        expect(triggerSettings?.sampleDataInputFileId).toBeDefined()
    })
})
