import { PieceMetadataModel } from '@activepieces/pieces-framework'
import {
    FlowAction,
    FlowActionType,
    FlowTrigger,
    FlowTriggerType,
    PieceCompatibilityIssueCode,
    PieceCompatibilityIssueSeverity,
    PieceStepCompatibilityVerdict,
    PropertyExecutionType,
} from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import { assessPieceStep } from '../../../../src/app/pieces/compatibility/piece-compatibility-diff'

const PIECE_NAME = '@activepieces/piece-test'

function buildPiece(overrides: {
    version?: string
    auth?: unknown
    actions?: Record<string, unknown>
    triggers?: Record<string, unknown>
}): PieceMetadataModel {
    return {
        name: PIECE_NAME,
        displayName: 'Test',
        logoUrl: 'https://example.com/logo.png',
        description: 'test piece',
        authors: [],
        version: overrides.version ?? '1.0.0',
        auth: overrides.auth,
        actions: (overrides.actions ?? {}) as PieceMetadataModel['actions'],
        triggers: (overrides.triggers ?? {}) as PieceMetadataModel['triggers'],
        projectUsage: 0,
        pieceType: 'OFFICIAL',
        packageType: 'REGISTRY',
    } as PieceMetadataModel
}

function textProp(required = false): Record<string, unknown> {
    return { type: 'SHORT_TEXT', displayName: 'Text', required }
}

function buildActionDef(overrides: {
    requireAuth?: boolean
    props?: Record<string, unknown>
}): Record<string, unknown> {
    return {
        name: 'send',
        displayName: 'Send',
        description: 'sends things',
        requireAuth: overrides.requireAuth ?? false,
        props: overrides.props ?? {},
    }
}

function buildActionStep(settings: {
    actionName?: string
    input?: Record<string, unknown>
    propertySettings?: Record<string, unknown>
}): FlowAction {
    return {
        name: 'step_1',
        displayName: 'Step 1',
        valid: true,
        type: FlowActionType.PIECE,
        lastUpdatedDate: new Date().toISOString(),
        settings: {
            pieceName: PIECE_NAME,
            pieceVersion: '1.0.0',
            actionName: settings.actionName ?? 'send',
            input: settings.input ?? {},
            propertySettings: settings.propertySettings ?? {},
        },
    } as FlowAction
}

function buildTriggerStep(settings: {
    triggerName?: string
    input?: Record<string, unknown>
    propertySettings?: Record<string, unknown>
}): FlowTrigger {
    return {
        name: 'trigger',
        displayName: 'Trigger',
        valid: true,
        type: FlowTriggerType.PIECE,
        lastUpdatedDate: new Date().toISOString(),
        settings: {
            pieceName: PIECE_NAME,
            pieceVersion: '1.0.0',
            triggerName: settings.triggerName ?? 'new_record',
            input: settings.input ?? {},
            propertySettings: settings.propertySettings ?? {},
        },
    } as FlowTrigger
}

function buildTriggerDef(overrides: {
    type?: string
    testStrategy?: string
    props?: Record<string, unknown>
    requireAuth?: boolean
}): Record<string, unknown> {
    return {
        name: 'new_record',
        displayName: 'New Record',
        description: 'fires on new records',
        requireAuth: overrides.requireAuth ?? false,
        type: overrides.type ?? 'POLLING',
        testStrategy: overrides.testStrategy ?? 'SIMULATION',
        props: overrides.props ?? {},
    }
}

function issueCodes(result: ReturnType<typeof assessPieceStep>): PieceCompatibilityIssueCode[] {
    return result.issues.map((issue) => issue.code)
}

describe('assessPieceStep', () => {
    it('returns COMPATIBLE when nothing changed', () => {
        const def = buildActionDef({ props: { message: textProp(true) } })
        const fromPiece = buildPiece({ actions: { send: def } })
        const toPiece = buildPiece({ version: '2.0.0', actions: { send: def } })
        const result = assessPieceStep({
            step: buildActionStep({ input: { message: 'hello' } }),
            fromPiece,
            toPiece,
        })
        expect(result.verdict).toBe(PieceStepCompatibilityVerdict.COMPATIBLE)
        expect(result.issues).toHaveLength(0)
        expect(result.stepName).toBe('step_1')
        expect(result.actionOrTriggerName).toBe('send')
    })

    it('flags INCOMPATIBLE when the action was removed in the new version', () => {
        const fromPiece = buildPiece({ actions: { send: buildActionDef({}) } })
        const toPiece = buildPiece({ version: '2.0.0', actions: {} })
        const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
        expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
        expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.ACTION_OR_TRIGGER_REMOVED])
    })

    it('flags INCOMPATIBLE when the trigger was removed in the new version', () => {
        const fromPiece = buildPiece({ triggers: { new_record: buildTriggerDef({}) } })
        const toPiece = buildPiece({ version: '2.0.0', triggers: {} })
        const result = assessPieceStep({ step: buildTriggerStep({}), fromPiece, toPiece })
        expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
        expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.ACTION_OR_TRIGGER_REMOVED])
    })

    it('flags DISPLAY_ONLY when the step has no action selected yet', () => {
        const piece = buildPiece({ actions: { send: buildActionDef({}) } })
        const step = buildActionStep({})
        ;(step.settings as { actionName?: string }).actionName = undefined
        const result = assessPieceStep({ step, fromPiece: piece, toPiece: piece })
        expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
        expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.ACTION_OR_TRIGGER_MISSING])
    })

    describe('property structure', () => {
        it('flags INCOMPATIBLE when a removed property has a saved value', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { message: textProp() } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({}) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { message: 'saved' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.PROPERTY_REMOVED])
            expect(result.issues[0].propertyName).toBe('message')
        })

        it('flags DISPLAY_ONLY when a removed property has no saved value', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { message: textProp() } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({}) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
            expect(result.issues[0].severity).toBe(PieceCompatibilityIssueSeverity.DISPLAY_ONLY)
        })

        it('flags INCOMPATIBLE when a property type changes and a value is saved', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { count: textProp() } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { count: { type: 'NUMBER', displayName: 'Count', required: false } } }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { count: '5' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.PROPERTY_TYPE_CHANGED])
        })

        it('flags DISPLAY_ONLY when a property type changes without a saved value', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { count: textProp() } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { count: { type: 'NUMBER', displayName: 'Count', required: false } } }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
        })

        it('flags INCOMPATIBLE when a new required property without default is added', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({}) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { channel: textProp(true) } }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.PROPERTY_ADDED])
        })

        it('flags DISPLAY_ONLY when a new required property has a default', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({}) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { channel: { ...textProp(true), defaultValue: 'general' } } }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
        })

        it('flags INCOMPATIBLE when an existing property becomes required without a saved value', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { message: textProp(false) } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { message: textProp(true) } }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.PROPERTY_BECAME_REQUIRED])
        })

        it('does not flag a property that became required when a value is saved', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { message: textProp(false) } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { message: textProp(true) } }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { message: 'saved' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.COMPATIBLE)
        })

        it('flags DISPLAY_ONLY for label, description or default value changes', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { message: textProp() } }) } })
            const toPiece = buildPiece({
                version: '2.0.0',
                actions: { send: buildActionDef({ props: { message: { ...textProp(), displayName: 'Renamed', defaultValue: 'x' } } }) },
            })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
            expect(issueCodes(result)).toEqual([
                PieceCompatibilityIssueCode.PROPERTY_DISPLAY_CHANGED,
                PieceCompatibilityIssueCode.DEFAULT_VALUE_CHANGED,
            ])
        })
    })

    describe('saved inputs', () => {
        const staticDropdown = (options: unknown[]): Record<string, unknown> => ({
            type: 'STATIC_DROPDOWN',
            displayName: 'Choice',
            required: true,
            options: { options: options.map((value) => ({ label: String(value), value })) },
        })

        it('flags INCOMPATIBLE when the saved dropdown value is no longer an option', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { choice: staticDropdown(['a', 'b']) } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { choice: staticDropdown(['a']) } }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { choice: 'b' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.SAVED_VALUE_NOT_IN_OPTIONS])
        })

        it('flags DISPLAY_ONLY when options changed but the saved value is still available', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { choice: staticDropdown(['a']) } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { choice: staticDropdown(['a', 'b']) } }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { choice: 'a' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.STATIC_OPTIONS_CHANGED])
        })

        it('flags INCOMPATIBLE when one of the saved multi-select values was removed', () => {
            const multi = (options: unknown[]): Record<string, unknown> => ({
                type: 'STATIC_MULTI_SELECT_DROPDOWN',
                displayName: 'Choices',
                required: true,
                options: { options: options.map((value) => ({ label: String(value), value })) },
            })
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { choices: multi(['a', 'b']) } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { choices: multi(['a']) } }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { choices: ['a', 'b'] } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.SAVED_VALUE_NOT_IN_OPTIONS])
        })
    })

    describe('saved input validation against the new version', () => {
        const propsOf = (prop: Record<string, unknown>): Record<string, unknown> => ({ value: prop })

        it('flags INCOMPATIBLE when a saved number value is not numeric', () => {
            const prop = { type: 'NUMBER', displayName: 'Value', required: false }
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { value: 'not-a-number' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.SAVED_VALUE_INVALID_TYPE])
        })

        it('accepts numeric strings and numbers for number properties', () => {
            const prop = { type: 'NUMBER', displayName: 'Value', required: false }
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            for (const input of [{ value: 5 }, { value: '5.5' }]) {
                const result = assessPieceStep({ step: buildActionStep({ input }), fromPiece, toPiece })
                expect(result.verdict).toBe(PieceStepCompatibilityVerdict.COMPATIBLE)
            }
        })

        it('flags INCOMPATIBLE when a saved checkbox value is not a boolean', () => {
            const prop = { type: 'CHECKBOX', displayName: 'Value', required: false }
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { value: 'yes' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.SAVED_VALUE_INVALID_TYPE])
        })

        it('flags INCOMPATIBLE when a saved array value is not an array', () => {
            const prop = { type: 'ARRAY', displayName: 'Value', required: false }
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { value: { unexpected: 'object' } } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.SAVED_VALUE_INVALID_TYPE])
        })

        it('flags INCOMPATIBLE when a saved object value is not an object', () => {
            const prop = { type: 'OBJECT', displayName: 'Value', required: false }
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { value: ['an', 'array'] } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.SAVED_VALUE_INVALID_TYPE])
        })

        it('skips validation for dynamic expressions', () => {
            const prop = { type: 'NUMBER', displayName: 'Value', required: false }
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: propsOf(prop) }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { value: '{{trigger.body.count}}' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.COMPATIBLE)
        })

        it('does not double-report when the property type also changed', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { value: textProp() } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { value: { type: 'NUMBER', displayName: 'Value', required: false } } }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { value: 'not-a-number' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.PROPERTY_TYPE_CHANGED])
        })
    })

    describe('dynamic fields', () => {
        it('flags DISPLAY_ONLY when dynamic dropdown refreshers change', () => {
            const dropdown = (refreshers: string[]): Record<string, unknown> => ({
                type: 'DROPDOWN',
                displayName: 'Parent',
                required: false,
                refreshers,
            })
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { parent: dropdown([]) } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { parent: dropdown(['message']) } }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { parent: 'x' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.DYNAMIC_OPTIONS_CHANGED])
        })

        it('flags DISPLAY_ONLY when a dynamic property has a saved value but no resolved schema', () => {
            const dynamicProp = { type: 'DYNAMIC', displayName: 'Fields', required: false, refreshers: [] }
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { fields: dynamicProp } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { fields: dynamicProp } }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { fields: { a: 1 } } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.DYNAMIC_SETTINGS_MISSING])
        })

        it('does not flag a dynamic property with a resolved schema stored', () => {
            const dynamicProp = { type: 'DYNAMIC', displayName: 'Fields', required: false, refreshers: [] }
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ props: { fields: dynamicProp } }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ props: { fields: dynamicProp } }) } })
            const result = assessPieceStep({
                step: buildActionStep({
                    input: { fields: { a: 1 } },
                    propertySettings: { fields: { type: PropertyExecutionType.DYNAMIC, schema: {} } },
                }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.COMPATIBLE)
        })
    })

    describe('authentication requirements', () => {
        const secretAuth = { type: 'SECRET_TEXT', displayName: 'API Key', required: true }
        const oauth2Auth = (scopes: string[] = [], authUrl = 'https://auth.example.com'): Record<string, unknown> => ({
            type: 'OAUTH2',
            displayName: 'Connection',
            required: true,
            authUrl,
            tokenUrl: 'https://auth.example.com/token',
            scope: scopes,
        })

        it('flags REAUTH_REQUIRED when the new version starts requiring a connection', () => {
            const fromPiece = buildPiece({ actions: { send: buildActionDef({ requireAuth: false }) } })
            const toPiece = buildPiece({ version: '2.0.0', auth: secretAuth, actions: { send: buildActionDef({ requireAuth: true }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.REAUTH_REQUIRED)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.AUTH_REQUIREMENT_ADDED])
        })

        it('flags DISPLAY_ONLY when the new version drops the connection requirement', () => {
            const fromPiece = buildPiece({ auth: secretAuth, actions: { send: buildActionDef({ requireAuth: true }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ requireAuth: false }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { auth: '{{connections[\'conn-1\']}}' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.AUTH_REQUIREMENT_REMOVED])
        })

        it('flags REAUTH_REQUIRED when the authentication type changes', () => {
            const fromPiece = buildPiece({ auth: secretAuth, actions: { send: buildActionDef({ requireAuth: true }) } })
            const toPiece = buildPiece({ version: '2.0.0', auth: oauth2Auth(), actions: { send: buildActionDef({ requireAuth: true }) } })
            const result = assessPieceStep({
                step: buildActionStep({ input: { auth: '{{connections[\'conn-1\']}}' } }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.REAUTH_REQUIRED)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.AUTH_TYPE_CHANGED])
        })

        it('flags REAUTH_REQUIRED when OAuth2 scopes are added', () => {
            const fromPiece = buildPiece({ auth: oauth2Auth(['read']), actions: { send: buildActionDef({ requireAuth: true }) } })
            const toPiece = buildPiece({ version: '2.0.0', auth: oauth2Auth(['read', 'write']), actions: { send: buildActionDef({ requireAuth: true }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.REAUTH_REQUIRED)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED])
        })

        it('flags DISPLAY_ONLY when OAuth2 scopes are removed', () => {
            const fromPiece = buildPiece({ auth: oauth2Auth(['read', 'write']), actions: { send: buildActionDef({ requireAuth: true }) } })
            const toPiece = buildPiece({ version: '2.0.0', auth: oauth2Auth(['read']), actions: { send: buildActionDef({ requireAuth: true }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED])
        })

        it('flags REAUTH_REQUIRED when OAuth2 endpoints change', () => {
            const fromPiece = buildPiece({ auth: oauth2Auth(['read']), actions: { send: buildActionDef({ requireAuth: true }) } })
            const toPiece = buildPiece({ version: '2.0.0', auth: oauth2Auth(['read'], 'https://login.example.com'), actions: { send: buildActionDef({ requireAuth: true }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.REAUTH_REQUIRED)
        })

        it('flags REAUTH_REQUIRED when a required custom auth field is added', () => {
            const customAuth = (props: Record<string, unknown>): Record<string, unknown> => ({
                type: 'CUSTOM_AUTH',
                displayName: 'Custom',
                required: true,
                props,
            })
            const fromPiece = buildPiece({ auth: customAuth({}), actions: { send: buildActionDef({ requireAuth: true }) } })
            const toPiece = buildPiece({
                version: '2.0.0',
                auth: customAuth({ region: { type: 'SHORT_TEXT', displayName: 'Region', required: true } }),
                actions: { send: buildActionDef({ requireAuth: true }) },
            })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.REAUTH_REQUIRED)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED])
        })

        it('flags INCOMPATIBLE when the new version requires auth but declares no auth method', () => {
            const fromPiece = buildPiece({ auth: secretAuth, actions: { send: buildActionDef({ requireAuth: true }) } })
            const toPiece = buildPiece({ version: '2.0.0', actions: { send: buildActionDef({ requireAuth: true }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.AUTH_TYPE_CHANGED])
        })

        it('keeps the connection compatible when the old auth method is still supported', () => {
            const fromPiece = buildPiece({ auth: secretAuth, actions: { send: buildActionDef({ requireAuth: true }) } })
            const toPiece = buildPiece({ version: '2.0.0', auth: [secretAuth, oauth2Auth()], actions: { send: buildActionDef({ requireAuth: true }) } })
            const result = assessPieceStep({ step: buildActionStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.COMPATIBLE)
        })
    })

    describe('trigger configuration', () => {
        it('flags INCOMPATIBLE when the trigger strategy changes', () => {
            const fromPiece = buildPiece({ triggers: { new_record: buildTriggerDef({ type: 'POLLING' }) } })
            const toPiece = buildPiece({ version: '2.0.0', triggers: { new_record: buildTriggerDef({ type: 'WEBHOOK' }) } })
            const result = assessPieceStep({ step: buildTriggerStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.TRIGGER_STRATEGY_CHANGED])
        })

        it('flags DISPLAY_ONLY when the trigger test strategy changes', () => {
            const fromPiece = buildPiece({ triggers: { new_record: buildTriggerDef({ testStrategy: 'SIMULATION' }) } })
            const toPiece = buildPiece({ version: '2.0.0', triggers: { new_record: buildTriggerDef({ testStrategy: 'TEST_FUNCTION' }) } })
            const result = assessPieceStep({ step: buildTriggerStep({}), fromPiece, toPiece })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.DISPLAY_ONLY)
            expect(issueCodes(result)).toEqual([PieceCompatibilityIssueCode.TRIGGER_CONFIG_CHANGED])
        })
    })

    describe('secret hygiene', () => {
        it('never copies connection references or saved input values into the report', () => {
            const fromPiece = buildPiece({
                auth: { type: 'SECRET_TEXT', displayName: 'API Key', required: true },
                actions: { send: buildActionDef({ requireAuth: true, props: { mode: { type: 'STATIC_DROPDOWN', displayName: 'Mode', required: true, options: { options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] } } } }) },
            })
            const toPiece = buildPiece({
                version: '2.0.0',
                auth: { type: 'OAUTH2', displayName: 'Connection', required: true, authUrl: 'https://auth.example.com', tokenUrl: 'https://auth.example.com/token', scope: ['read'] },
                actions: { send: buildActionDef({ requireAuth: true, props: { mode: { type: 'STATIC_DROPDOWN', displayName: 'Mode', required: true, options: { options: [{ label: 'A', value: 'a' }] } } } }) },
            })
            const result = assessPieceStep({
                step: buildActionStep({
                    input: {
                        auth: '{{connections[\'super-secret-connection-ref\']}}',
                        mode: 'b',
                        note: 'sk-live-secret-value',
                    },
                }),
                fromPiece,
                toPiece,
            })
            expect(result.verdict).toBe(PieceStepCompatibilityVerdict.INCOMPATIBLE)
            expect(result.connectionConfigured).toBe(true)
            const serialized = JSON.stringify(result)
            expect(serialized).not.toContain('super-secret-connection-ref')
            expect(serialized).not.toContain('sk-live-secret-value')
        })
    })
})
