import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    FlowActionType,
    FlowOperationType,
    FlowTriggerType,
    FlowVersionState,
    PieceTrigger,
    SampleDataFileType,
    SampleDataSettings,
} from '@activepieces/shared'
import type { FlowVersion } from '@activepieces/shared'

const mockGetPiece = vi.fn()
const mockGetPlatformId = vi.fn().mockResolvedValue('platform-1')
const mockRepoFindOne = vi.fn()
const mockRepoSave = vi.fn()
const mockRepoExists = vi.fn()
const mockSaveSampleDataFileIdsInStep = vi.fn()
const mockPreApplyOperation = vi.fn()
const mockPrepareRequest = vi.fn(({ request }: { request: unknown }) => Promise.resolve(request))

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({
        findOne: mockRepoFindOne,
        save: mockRepoSave,
        exists: mockRepoExists,
    })),
}))

vi.mock('../../../../../src/app/pieces/metadata/piece-metadata-service', () => ({
    pieceMetadataService: vi.fn(() => ({
        get: mockGetPiece,
    })),
}))

vi.mock('../../../../../src/app/project/project-service', () => ({
    projectService: vi.fn(() => ({
        getPlatformId: mockGetPlatformId,
    })),
}))

vi.mock('../../../../../src/app/user/user-service', () => ({
    userService: vi.fn(() => ({
        getMetaInformation: vi.fn(),
    })),
}))

vi.mock('../../../../../src/app/flows/step-run/sample-data.service', () => ({
    sampleDataService: vi.fn(() => ({
        saveSampleDataFileIdsInStep: mockSaveSampleDataFileIdsInStep,
    })),
}))

vi.mock('../../../../../src/app/flows/flow-version/flow-version-migration.service', () => ({
    flowVersionMigrationService: vi.fn(() => ({
        migrate: vi.fn((v: FlowVersion) => Promise.resolve(v)),
    })),
}))

vi.mock('../../../../../src/app/flows/flow-version/flow-version-side-effects', () => ({
    flowVersionSideEffects: vi.fn(() => ({
        preApplyOperation: mockPreApplyOperation,
    })),
}))

vi.mock('../../../../../src/app/flows/flow-version/flow-version-validator-util', () => ({
    flowVersionValidationUtil: vi.fn(() => ({
        prepareRequest: mockPrepareRequest,
    })),
}))

import type { FastifyBaseLogger } from 'fastify'
import { flowVersionService } from '../../../../../src/app/flows/flow-version/flow-version.service'

const mockLog = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'info',
} as unknown as FastifyBaseLogger

function makePieceTriggerSettings(extras: Partial<PieceTrigger['settings']> = {}): PieceTrigger['settings'] {
    return {
        pieceName: '@activepieces/piece-gmail',
        pieceVersion: '~0.1.0',
        triggerName: 'new_email',
        input: {},
        propertySettings: {},
        ...extras,
    }
}

function makeFlowVersion(overrides: { id?: string, trigger?: FlowVersion['trigger'] } = {}): FlowVersion {
    return {
        id: overrides.id ?? 'fv-1',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        flowId: 'flow-1',
        displayName: 'Test Flow',
        trigger: overrides.trigger ?? {
            name: 'trigger',
            valid: true,
            displayName: 'Gmail Trigger',
            lastUpdatedDate: '2024-01-01T00:00:00Z',
            type: FlowTriggerType.PIECE,
            settings: makePieceTriggerSettings(),
            nextAction: {
                name: 'step_1',
                valid: true,
                displayName: 'Slack Action',
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
        },
        updatedBy: null,
        valid: true,
        schemaVersion: null,
        agentIds: [],
        state: FlowVersionState.DRAFT,
        connectionIds: [],
        backupFiles: null,
        notes: [],
    }
}

describe('flowVersionService.applyOperation - USE_AS_DRAFT', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockGetPlatformId.mockResolvedValue('platform-1')
        mockRepoFindOne.mockResolvedValue(null)
        mockRepoSave.mockImplementation((v: FlowVersion) => Promise.resolve(v))
        mockRepoExists.mockResolvedValue(false)
    })

    it('preserves PIECE trigger sample data from the previous version', async () => {
        const sampleData: SampleDataSettings = {
            sampleDataFileId: 'sd-file-1',
            sampleDataInputFileId: 'sdi-file-1',
            lastTestDate: '2024-01-01T00:00:00Z',
        }
        const currentDraft = makeFlowVersion()
        const previousVersion = makeFlowVersion({
            id: 'fv-prev',
            trigger: {
                ...makeFlowVersion().trigger,
                settings: makePieceTriggerSettings({ sampleData }),
            } as PieceTrigger,
        })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: currentDraft,
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })

        expect(result.trigger.type).toBe(FlowTriggerType.PIECE)
        const settings = (result.trigger as PieceTrigger).settings
        expect(settings.sampleData?.sampleDataFileId).toBe(sampleData.sampleDataFileId)
        expect(settings.sampleData?.sampleDataInputFileId).toBe(sampleData.sampleDataInputFileId)
    })

    it('does not set trigger sample data when previous version has no sampleData', async () => {
        const currentDraft = makeFlowVersion()
        const previousVersion = makeFlowVersion({ id: 'fv-prev' })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: currentDraft,
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })

        expect(result.trigger.type).toBe(FlowTriggerType.PIECE)
        expect((result.trigger as PieceTrigger).settings.sampleData).toBeUndefined()
    })

    it('skips the sample data preservation when previous version has an EMPTY trigger', async () => {
        const currentDraft = makeFlowVersion()
        const previousVersion = makeFlowVersion({
            id: 'fv-prev',
            trigger: {
                name: 'trigger',
                valid: false,
                displayName: 'Select Trigger',
                lastUpdatedDate: '2024-01-01T00:00:00Z',
                type: FlowTriggerType.EMPTY,
                settings: {},
            },
        })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: currentDraft,
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })

        expect(result.trigger.type).toBe(FlowTriggerType.EMPTY)
    })
})

describe('flowVersionService.applyOperation - ordinary edits', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockPrepareRequest.mockImplementation(({ request }) => Promise.resolve(request))
        mockRepoSave.mockImplementation((v: FlowVersion) => Promise.resolve(v))
    })

    it('applies a primitive operation as-is and persists once with fresh metadata', async () => {
        const draft = makeFlowVersion()
        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: draft,
            userOperation: {
                type: FlowOperationType.CHANGE_NAME,
                request: { displayName: 'Renamed Flow' },
            },
        })

        expect(result.displayName).toBe('Renamed Flow')
        expect(result.updatedBy).toBe('user-1')
        expect(result.updated).not.toBe('2024-01-01T00:00:00Z')
        expect(result.connectionIds).toEqual([])
        // Exactly one persist for the whole operation
        expect(mockRepoSave).toHaveBeenCalledTimes(1)
        // Side effects fire once for the single primitive operation
        expect(mockPreApplyOperation).toHaveBeenCalledTimes(1)
        expect(mockPreApplyOperation.mock.calls[0][0].operation.type).toBe(FlowOperationType.CHANGE_NAME)
    })

    it('leaves updatedBy untouched when userId is null', async () => {
        const draft = makeFlowVersion()
        draft.updatedBy = null
        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: null,
            flowVersion: draft,
            userOperation: {
                type: FlowOperationType.CHANGE_NAME,
                request: { displayName: 'Renamed Flow' },
            },
        })

        expect(result.updatedBy).toBeNull()
    })

    it('extracts connection ids from steps after applying the operation', async () => {
        const triggerWithConnection = {
            ...makeFlowVersion().trigger,
            settings: makePieceTriggerSettings({
                input: { auth: '{{connections[\'gmail_connection\']}}' },
            }),
        } as PieceTrigger
        const draft = makeFlowVersion({ trigger: triggerWithConnection })

        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: draft,
            userOperation: {
                type: FlowOperationType.CHANGE_NAME,
                request: { displayName: 'Renamed Flow' },
            },
        })

        expect(result.connectionIds).toEqual(['gmail_connection'])
    })

    it('stamps the owner on a newly added note', async () => {
        const draft = makeFlowVersion()
        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-42',
            flowVersion: draft,
            userOperation: {
                type: FlowOperationType.ADD_NOTE,
                request: {
                    id: 'note-1',
                    content: 'hello',
                    color: 'blue',
                    position: { x: 0, y: 0 },
                    size: { width: 100, height: 50 },
                    createdAt: '2024-01-01T00:00:00Z',
                    updatedAt: '2024-01-01T00:00:00Z',
                },
            },
        })

        const note = result.notes.find((n) => n.id === 'note-1')
        expect(note?.ownerId).toBe('user-42')
    })
})

describe('flowVersionService.applyOperation - SAVE_SAMPLE_DATA', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockPrepareRequest.mockImplementation(({ request }) => Promise.resolve(request))
        mockRepoSave.mockImplementation((v: FlowVersion) => Promise.resolve(v))
    })

    it('persists the uploaded sample data and folds it into an UPDATE_SAMPLE_DATA_INFO operation', async () => {
        const savedSettings: SampleDataSettings = {
            sampleDataFileId: 'new-file',
            sampleDataInputFileId: undefined,
            lastTestDate: '2024-02-02T00:00:00Z',
        }
        mockSaveSampleDataFileIdsInStep.mockResolvedValue(savedSettings)

        const draft = makeFlowVersion()
        const result = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: draft,
            userOperation: {
                type: FlowOperationType.SAVE_SAMPLE_DATA,
                request: {
                    stepName: 'trigger',
                    payload: { foo: 'bar' },
                    type: SampleDataFileType.OUTPUT,
                },
            },
        })

        expect(mockSaveSampleDataFileIdsInStep).toHaveBeenCalledTimes(1)
        expect(mockSaveSampleDataFileIdsInStep).toHaveBeenCalledWith({
            projectId: 'proj-1',
            flowVersionId: 'fv-1',
            stepName: 'trigger',
            payload: { foo: 'bar' },
            type: SampleDataFileType.OUTPUT,
        })
        // The expanded operation is what went through validation/side effects
        expect(mockPreApplyOperation).toHaveBeenCalledTimes(1)
        expect(mockPreApplyOperation.mock.calls[0][0].operation.type).toBe(FlowOperationType.UPDATE_SAMPLE_DATA_INFO)
        const settings = (result.trigger as PieceTrigger).settings
        expect(settings.sampleData?.sampleDataFileId).toBe('new-file')
    })

    it('does not persist or apply anything when sample data preparation fails', async () => {
        mockSaveSampleDataFileIdsInStep.mockRejectedValue(new Error('upload exploded'))

        const draft = makeFlowVersion()
        await expect(flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: draft,
            userOperation: {
                type: FlowOperationType.SAVE_SAMPLE_DATA,
                request: {
                    stepName: 'trigger',
                    payload: { foo: 'bar' },
                    type: SampleDataFileType.OUTPUT,
                },
            },
        })).rejects.toThrow('upload exploded')

        expect(mockRepoSave).not.toHaveBeenCalled()
        expect(mockPreApplyOperation).not.toHaveBeenCalled()
    })
})

describe('flowVersionService.applyOperation - batch order and failure consistency', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockPrepareRequest.mockImplementation(({ request }) => Promise.resolve(request))
        mockRepoFindOne.mockImplementation(({ where }: { where: { id?: string } }) => {
            if (where?.id === 'fv-prev') {
                return Promise.resolve(makeFlowVersion({ id: 'fv-prev' }))
            }
            return Promise.resolve(null)
        })
        mockRepoSave.mockImplementation((v: FlowVersion) => Promise.resolve(v))
    })

    it('applies the USE_AS_DRAFT batch strictly in order: IMPORT_FLOW then UPDATE_SAMPLE_DATA_INFO', async () => {
        const sampleData: SampleDataSettings = {
            sampleDataFileId: 'sd-file-1',
            sampleDataInputFileId: 'sdi-file-1',
            lastTestDate: '2024-01-01T00:00:00Z',
        }
        const previousVersion = makeFlowVersion({
            id: 'fv-prev',
            trigger: {
                ...makeFlowVersion().trigger,
                settings: makePieceTriggerSettings({ sampleData }),
            } as PieceTrigger,
        })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: makeFlowVersion(),
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })

        const appliedTypes = mockPreApplyOperation.mock.calls.map((call) => call[0].operation.type)
        expect(appliedTypes).toEqual([
            FlowOperationType.IMPORT_FLOW,
            FlowOperationType.UPDATE_SAMPLE_DATA_INFO,
        ])
        expect(mockRepoSave).toHaveBeenCalledTimes(1)
    })

    it('does not persist when an operation in the middle of the batch throws', async () => {
        // USE_AS_DRAFT expands into an ordered [IMPORT_FLOW,
        // UPDATE_SAMPLE_DATA_INFO] batch. Make validation fail on the second
        // operation and assert no save happens, i.e. the stored version stays
        // consistent even though the first operation was already applied in
        // memory.
        mockPrepareRequest.mockImplementation(({ request }) => {
            if (request.type === FlowOperationType.UPDATE_SAMPLE_DATA_INFO) {
                return Promise.reject(new Error('boom mid-batch'))
            }
            return Promise.resolve(request)
        })
        const sampleData: SampleDataSettings = {
            sampleDataFileId: 'sd-file-1',
            sampleDataInputFileId: 'sdi-file-1',
            lastTestDate: '2024-01-01T00:00:00Z',
        }
        const previousVersion = makeFlowVersion({
            id: 'fv-prev',
            trigger: {
                ...makeFlowVersion().trigger,
                settings: makePieceTriggerSettings({ sampleData }),
            } as PieceTrigger,
        })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        await expect(flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: makeFlowVersion(),
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })).rejects.toThrow('boom mid-batch')

        expect(mockRepoSave).not.toHaveBeenCalled()
        // The first operation ran (including its pre-apply side effects), the
        // second reached validation but never applied, nothing was persisted.
        const appliedTypes = mockPreApplyOperation.mock.calls.map((call) => call[0].operation.type)
        expect(appliedTypes).toEqual([
            FlowOperationType.IMPORT_FLOW,
            FlowOperationType.UPDATE_SAMPLE_DATA_INFO,
        ])
    })

    it('leaves the input flow version object untouched when the batch fails (no in-place mutation)', async () => {
        mockPrepareRequest.mockImplementation(({ request }) => {
            if (request.type === FlowOperationType.UPDATE_SAMPLE_DATA_INFO) {
                return Promise.reject(new Error('boom mid-batch'))
            }
            return Promise.resolve(request)
        })
        const sampleData: SampleDataSettings = {
            sampleDataFileId: 'sd-file-1',
            sampleDataInputFileId: 'sdi-file-1',
            lastTestDate: '2024-01-01T00:00:00Z',
        }
        const previousVersion = makeFlowVersion({
            id: 'fv-prev',
            trigger: {
                ...makeFlowVersion().trigger,
                settings: makePieceTriggerSettings({ sampleData }),
            } as PieceTrigger,
        })
        mockRepoFindOne.mockResolvedValue(previousVersion)

        const draft = makeFlowVersion()
        const snapshot = JSON.stringify(draft)
        await expect(flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: draft,
            userOperation: {
                type: FlowOperationType.USE_AS_DRAFT,
                request: { versionId: 'fv-prev' },
            },
        })).rejects.toThrow('boom mid-batch')

        // flowOperations.apply clones before each application, so callers can
        // safely retry with the same draft instance.
        expect(JSON.stringify(draft)).toBe(snapshot)
    })

    it('does not load the previous version for a primitive operation', async () => {
        const locked = await flowVersionService(mockLog).applyOperation({
            projectId: 'proj-1',
            platformId: 'platform-1',
            userId: 'user-1',
            flowVersion: makeFlowVersion(),
            userOperation: {
                type: FlowOperationType.LOCK_FLOW,
                request: {},
            },
        })

        expect(mockRepoFindOne).not.toHaveBeenCalled()
        // Publish chain relies on LOCK_FLOW flipping a DRAFT into LOCKED while
        // still refreshing metadata and persisting exactly once.
        expect(locked.state).toBe(FlowVersionState.LOCKED)
        expect(locked.updatedBy).toBe('user-1')
        expect(mockRepoSave).toHaveBeenCalledTimes(1)
    })
})
