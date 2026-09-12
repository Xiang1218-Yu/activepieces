import {
    FlowCompatibilityStatus,
    PieceStepCompatibilityVerdict,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const PIECE_NAME = '@activepieces/piece-test'

const mockGetPiece = vi.fn()
const mockGetProject = vi.fn()
const mockFlowFind = vi.fn()
const mockVersionFind = vi.fn()

vi.mock('../../../../src/app/pieces/metadata/piece-metadata-service', () => ({
    pieceMetadataService: vi.fn(() => ({
        getOrThrow: mockGetPiece,
    })),
}))

vi.mock('../../../../src/app/project/project-service', () => ({
    projectService: vi.fn(() => ({
        getOne: mockGetProject,
    })),
}))

vi.mock('../../../../src/app/flows/flow/flow.repo', () => ({
    flowRepo: vi.fn(() => ({
        find: mockFlowFind,
    })),
}))

vi.mock('../../../../src/app/flows/flow-version/flow-version.service', () => ({
    flowVersionRepo: vi.fn(() => ({
        find: mockVersionFind,
    })),
}))

import { pieceCompatibilityService } from '../../../../src/app/pieces/compatibility/piece-compatibility.service'

const log = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
} as unknown as FastifyBaseLogger

const OLD_PROPS = {
    message: { type: 'SHORT_TEXT', displayName: 'Message', required: true },
    mode: {
        type: 'STATIC_DROPDOWN',
        displayName: 'Mode',
        required: true,
        options: { options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
    },
}

const NEW_PROPS = {
    message: { type: 'SHORT_TEXT', displayName: 'Message', required: true },
    mode: {
        type: 'STATIC_DROPDOWN',
        displayName: 'Mode',
        required: true,
        options: { options: [{ label: 'A', value: 'a' }] },
    },
}

function buildPiece(version: string, props: Record<string, unknown>): Record<string, unknown> {
    return {
        name: PIECE_NAME,
        displayName: 'Test',
        logoUrl: 'https://example.com/logo.png',
        description: 'test piece',
        authors: [],
        version,
        actions: {
            send: {
                name: 'send',
                displayName: 'Send',
                description: 'sends things',
                requireAuth: false,
                props,
            },
        },
        triggers: {},
        projectUsage: 0,
        pieceType: 'OFFICIAL',
        packageType: 'REGISTRY',
    }
}

function flowVersionWithPieceStep(id: string, input: Record<string, unknown> = { message: 'hi', mode: 'b' }): Record<string, unknown> {
    return {
        id,
        flowId: `flow-for-${id}`,
        displayName: `Flow ${id}`,
        trigger: {
            name: 'trigger',
            type: 'EMPTY',
            valid: true,
            displayName: 'Trigger',
            settings: {},
            nextAction: {
                name: 'step_1',
                type: 'PIECE',
                valid: true,
                displayName: 'Send Step',
                settings: {
                    pieceName: PIECE_NAME,
                    pieceVersion: '1.0.0',
                    actionName: 'send',
                    input,
                    propertySettings: {},
                },
            },
        },
    }
}

const flowVersionWithoutPiece = {
    id: 'fv-other',
    flowId: 'flow-other',
    displayName: 'Other Flow',
    trigger: {
        name: 'trigger',
        type: 'EMPTY',
        valid: true,
        displayName: 'Trigger',
        settings: {},
    },
}

describe('pieceCompatibilityService.check', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockGetPiece.mockImplementation(({ version }: { version: string }) =>
            Promise.resolve(version === '1.0.0' ? buildPiece('1.0.0', OLD_PROPS) : buildPiece('2.0.0', NEW_PROPS)))
    })

    it('checks pasted flow versions and isolates failures per entry', async () => {
        const report = await pieceCompatibilityService(log).check({
            platformId: 'platform-1',
            request: {
                pieceName: PIECE_NAME,
                fromVersion: '1.0.0',
                toVersion: '2.0.0',
                source: {
                    type: 'PASTED',
                    flowVersions: [
                        flowVersionWithPieceStep('fv-1'),
                        { id: 'fv-invalid', flowId: 'flow-invalid', not: 'a flow version' },
                        { id: 'fv-broken', flowId: 'flow-broken', trigger: { type: 'ROUTER', children: 'not-an-array' } },
                        flowVersionWithoutPiece,
                    ],
                },
            },
        })

        expect(report.pieceName).toBe(PIECE_NAME)
        expect(report.fromVersion).toBe('1.0.0')
        expect(report.toVersion).toBe('2.0.0')
        expect(report.flows).toHaveLength(4)

        const [checked, invalid, broken, notUsing] = report.flows

        expect(checked.status).toBe(FlowCompatibilityStatus.CHECKED)
        expect(checked.flowVersionId).toBe('fv-1')
        expect(checked.steps).toHaveLength(1)
        expect(checked.steps[0].stepName).toBe('step_1')
        expect(checked.steps[0].verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)

        expect(invalid.status).toBe(FlowCompatibilityStatus.ERROR)
        expect(invalid.error).toContain('Invalid flow version payload')
        // failed rows still carry whatever identity the payload had, for locating
        expect(invalid.flowVersionId).toBe('fv-invalid')
        expect(invalid.flowId).toBe('flow-invalid')

        expect(broken.status).toBe(FlowCompatibilityStatus.ERROR)
        expect(broken.flowVersionId).toBe('fv-broken')
        expect(broken.error).toBeTruthy()

        expect(notUsing.status).toBe(FlowCompatibilityStatus.NOT_USING_PIECE)
        expect(notUsing.steps).toHaveLength(0)

        expect(report.summary.flowsErrored).toBe(2)
        expect(report.summary.flowsChecked).toBe(2)
        expect(report.summary.flowsNotUsingPiece).toBe(1)
        expect(report.summary.stepsChecked).toBe(1)
        expect(report.summary.incompatibleSteps).toBe(1)
    })

    it('reads latest and published versions from a project and locates steps in the report', async () => {
        mockGetProject.mockResolvedValue({ id: 'project-1', platformId: 'platform-1', displayName: 'Main Project' })
        mockFlowFind.mockResolvedValue([{ id: 'flow-1', projectId: 'project-1', publishedVersionId: 'fv-published' }])
        mockVersionFind.mockResolvedValue([
            { id: 'fv-latest', flowId: 'flow-1', displayName: 'My Flow', trigger: flowVersionWithPieceStep('fv-latest').trigger },
            { id: 'fv-published', flowId: 'flow-1', displayName: 'My Flow', trigger: flowVersionWithPieceStep('fv-published', { message: 'hi', mode: 'a' }).trigger },
        ])

        const report = await pieceCompatibilityService(log).check({
            platformId: 'platform-1',
            request: {
                pieceName: PIECE_NAME,
                fromVersion: '1.0.0',
                toVersion: '2.0.0',
                source: { type: 'PROJECT', projectId: 'project-1' },
            },
        })

        expect(report.flows).toHaveLength(2)
        const [latest, published] = report.flows

        expect(latest.flowVersionId).toBe('fv-latest')
        expect(latest.projectId).toBe('project-1')
        expect(latest.projectName).toBe('Main Project')
        expect(latest.flowId).toBe('flow-1')
        expect(latest.steps[0].stepName).toBe('step_1')
        expect(latest.steps[0].verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)

        expect(published.flowVersionId).toBe('fv-published')
        // saved value 'a' is still valid, but the option set changed in the new version
        expect(published.steps[0].verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)

        expect(report.summary.flowsChecked).toBe(2)
        expect(report.summary.displayOnlySteps).toBe(1)
        expect(report.summary.incompatibleSteps).toBe(1)
    })

    it('rejects when the project belongs to another platform', async () => {
        mockGetProject.mockResolvedValue({ id: 'project-1', platformId: 'other-platform', displayName: 'Foreign' })

        await expect(pieceCompatibilityService(log).check({
            platformId: 'platform-1',
            request: {
                pieceName: PIECE_NAME,
                fromVersion: '1.0.0',
                toVersion: '2.0.0',
                source: { type: 'PROJECT', projectId: 'project-1' },
            },
        })).rejects.toThrow()
    })
})
