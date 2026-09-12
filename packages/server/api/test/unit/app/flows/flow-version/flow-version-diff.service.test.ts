import {
    ActivepiecesError,
    ErrorCode,
    FlowVersion,
    FlowVersionState,
} from '@activepieces/shared'
import type { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetFlowVersionOrThrow = vi.fn()

vi.mock(
    '../../../../../src/app/flows/flow-version/flow-version.service',
    () => ({
        flowVersionService: vi.fn(() => ({
            getFlowVersionOrThrow: mockGetFlowVersionOrThrow,
        })),
    }),
)

import { flowVersionDiffService } from '../../../../../src/app/flows/flow-version/flow-version-diff.service'

const mockLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
} as unknown as FastifyBaseLogger

function buildVersion(id: string, flowId: string): FlowVersion {
    return {
        id,
        created: '2026-09-01T00:00:00.000Z',
        updated: '2026-09-01T00:00:00.000Z',
        flowId,
        displayName: 'My Flow',
        updatedBy: null,
        valid: true,
        schemaVersion: '26',
        agentIds: [],
        state: FlowVersionState.LOCKED,
        connectionIds: [],
        backupFiles: null,
        notes: [],
        trigger: {
            name: 'trigger',
            type: 'EMPTY',
            valid: false,
            displayName: 'Select Trigger',
            lastUpdatedDate: '2026-09-01T00:00:00.000Z',
            settings: {},
        },
    } as FlowVersion
}

describe('flowVersionDiffService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns a diff for two versions of the same flow', async () => {
        const fromVersion = buildVersion('v-1', 'flow-1')
        const toVersion = buildVersion('v-2', 'flow-1')
        mockGetFlowVersionOrThrow
            .mockResolvedValueOnce(fromVersion)
            .mockResolvedValueOnce(toVersion)

        const diff = await flowVersionDiffService(mockLog).getDiff({
            flowId: 'flow-1',
            request: { fromVersionId: 'v-1', toVersionId: 'v-2' },
        })

        expect(diff.fromVersionId).toBe('v-1')
        expect(diff.toVersionId).toBe('v-2')
        expect(diff.hasChanges).toBe(false)
        expect(mockGetFlowVersionOrThrow).toHaveBeenNthCalledWith(1, {
            flowId: 'flow-1',
            versionId: 'v-1',
        })
    })

    it('throws a validation error when a version belongs to another flow', async () => {
        mockGetFlowVersionOrThrow
            .mockResolvedValueOnce(buildVersion('v-1', 'flow-1'))
            .mockResolvedValueOnce(buildVersion('v-2', 'flow-OTHER'))

        await expect(
            flowVersionDiffService(mockLog).getDiff({
                flowId: 'flow-1',
                request: { fromVersionId: 'v-1', toVersionId: 'v-2' },
            }),
        ).rejects.toMatchObject({
            error: {
                code: ErrorCode.VALIDATION,
                params: { message: 'flowVersionDiff_crossFlow' },
            },
        } satisfies Partial<ActivepiecesError>)
    })

    it('propagates not found errors for missing versions', async () => {
        mockGetFlowVersionOrThrow.mockRejectedValueOnce(
            new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityType: 'FlowVersion', entityId: 'missing' },
            }),
        )

        await expect(
            flowVersionDiffService(mockLog).getDiff({
                flowId: 'flow-1',
                request: { fromVersionId: 'missing', toVersionId: 'v-2' },
            }),
        ).rejects.toMatchObject({
            error: { code: ErrorCode.ENTITY_NOT_FOUND },
        } satisfies Partial<ActivepiecesError>)
    })
})
