import { isNil } from '@activepieces/core-utils'
import { PieceMetadataModel, PropertyType } from '@activepieces/pieces-framework'
import {
    AUTHENTICATION_PROPERTY_NAME,
    FlowAction,
    FlowActionType,
    FlowTrigger,
    FlowTriggerType,
    PieceCompatibilityIssue,
    PieceCompatibilityIssueCode,
    PieceCompatibilityIssueSeverity,
    PieceStepCompatibilityResult,
    PieceStepCompatibilityVerdict,
    PropertyExecutionType,
} from '@activepieces/shared'

/**
 * Pure compatibility engine: compares one piece step (trigger or action) of a
 * flow version against the metadata of the piece version it was configured
 * with (`fromPiece`) and the version it would run on (`toPiece`).
 *
 * The functions here are total — malformed steps produce best-effort results,
 * never exceptions — and they never copy saved input values or connection
 * references into the report, only structural facts.
 */

type AssessStepParams = {
    step: FlowAction | FlowTrigger
    fromPiece: PieceMetadataModel
    toPiece: PieceMetadataModel
}

type ActionOrTriggerDef = PieceMetadataModel['actions'][string] | PieceMetadataModel['triggers'][string]

/**
 * Structural view over a piece property as stored in piece metadata (JSON).
 * Functions are stripped from stored metadata, so only data fields are read.
 */
type PropertyShape = {
    type?: string
    required?: boolean
    displayName?: string
    description?: string
    placeholder?: string
    defaultValue?: unknown
    options?: { options?: { value: unknown }[] }
    refreshers?: string[]
    refreshOnSearch?: boolean
}

type AuthPropShape = {
    type?: string
    required?: boolean
}

type AuthShape = {
    type?: string
    displayName?: string
    authUrl?: string
    tokenUrl?: string
    scope?: string[]
    grantType?: string
    pkce?: boolean
    prompt?: string
    authorizationMethod?: string
    props?: Record<string, AuthPropShape>
}

const SEVERITY_TO_VERDICT: Record<PieceCompatibilityIssueSeverity, PieceStepCompatibilityVerdict> = {
    [PieceCompatibilityIssueSeverity.INCOMPATIBLE]: PieceStepCompatibilityVerdict.INCOMPATIBLE,
    [PieceCompatibilityIssueSeverity.REAUTH_REQUIRED]: PieceStepCompatibilityVerdict.REAUTH_REQUIRED,
    [PieceCompatibilityIssueSeverity.DISPLAY_ONLY]: PieceStepCompatibilityVerdict.DISPLAY_ONLY,
}

const VERDICT_RANK: Record<PieceStepCompatibilityVerdict, number> = {
    [PieceStepCompatibilityVerdict.COMPATIBLE]: 0,
    [PieceStepCompatibilityVerdict.DISPLAY_ONLY]: 1,
    [PieceStepCompatibilityVerdict.REAUTH_REQUIRED]: 2,
    [PieceStepCompatibilityVerdict.INCOMPATIBLE]: 3,
}

export function assessPieceStep({ step, fromPiece, toPiece }: AssessStepParams): PieceStepCompatibilityResult {
    const stepType = step.type as FlowActionType.PIECE | FlowTriggerType.PIECE
    const isTrigger = step.type === FlowTriggerType.PIECE
    const settings = (step.settings ?? {}) as Record<string, unknown>
    const input = isRecord(settings['input']) ? settings['input'] : {}
    const propertySettings = isRecord(settings['propertySettings']) ? settings['propertySettings'] : {}
    const actionOrTriggerName = stringOrNull(isTrigger ? settings['triggerName'] : settings['actionName'])
    const connectionConfigured = hasValue(input[AUTHENTICATION_PROPERTY_NAME])

    const base = {
        stepName: step.name,
        stepDisplayName: step.displayName ?? step.name,
        stepType,
        actionOrTriggerName,
        pieceVersion: typeof settings['pieceVersion'] === 'string' ? settings['pieceVersion'] : '',
        connectionConfigured,
    }

    if (isNil(actionOrTriggerName)) {
        return buildResult(base, [{
            code: PieceCompatibilityIssueCode.ACTION_OR_TRIGGER_MISSING,
            severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            message: `Step "${base.stepDisplayName}" uses piece "${toPiece.name}" but has no ${isTrigger ? 'trigger' : 'action'} selected yet, so there is no saved configuration to check.`,
        }])
    }

    const toDef = lookupDef(toPiece, isTrigger, actionOrTriggerName)
    if (isNil(toDef)) {
        return buildResult(base, [{
            code: PieceCompatibilityIssueCode.ACTION_OR_TRIGGER_REMOVED,
            severity: PieceCompatibilityIssueSeverity.INCOMPATIBLE,
            message: `${isTrigger ? 'Trigger' : 'Action'} "${actionOrTriggerName}" does not exist in ${toPiece.name}@${toPiece.version}. The step must be reconfigured or removed.`,
        }])
    }

    const fromDef = lookupDef(fromPiece, isTrigger, actionOrTriggerName)

    const issues: PieceCompatibilityIssue[] = [
        ...assessAuth({ fromPiece, toPiece, fromDef, toDef }),
        ...assessProperties({ fromDef, toDef, input, propertySettings, toVersion: toPiece.version }),
        ...assessTriggerConfig({ fromDef, toDef }),
    ]
    return buildResult(base, issues)
}

function buildResult(base: Omit<PieceStepCompatibilityResult, 'verdict' | 'issues'>, issues: PieceCompatibilityIssue[]): PieceStepCompatibilityResult {
    const verdict = issues.reduce<PieceStepCompatibilityVerdict>(
        (worst, issue) => VERDICT_RANK[SEVERITY_TO_VERDICT[issue.severity]] > VERDICT_RANK[worst] ? SEVERITY_TO_VERDICT[issue.severity] : worst,
        PieceStepCompatibilityVerdict.COMPATIBLE,
    )
    return { ...base, verdict, issues }
}

function lookupDef(piece: PieceMetadataModel, isTrigger: boolean, name: string): ActionOrTriggerDef | undefined {
    const defs = isTrigger ? piece.triggers : piece.actions
    return isRecord(defs) ? (defs as Record<string, ActionOrTriggerDef>)[name] : undefined
}

type AssessAuthParams = {
    fromPiece: PieceMetadataModel
    toPiece: PieceMetadataModel
    fromDef: ActionOrTriggerDef | undefined
    toDef: ActionOrTriggerDef
}

function assessAuth({ fromPiece, toPiece, fromDef, toDef }: AssessAuthParams): PieceCompatibilityIssue[] {
    const fromRequiresAuth = fromDef?.requireAuth === true
    const toRequiresAuth = toDef.requireAuth === true

    if (!toRequiresAuth) {
        if (fromRequiresAuth) {
            return [{
                code: PieceCompatibilityIssueCode.AUTH_REQUIREMENT_REMOVED,
                severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
                message: 'The new version no longer requires a connection. Any configured connection is ignored.',
            }]
        }
        return []
    }
    if (!fromRequiresAuth) {
        return [{
            code: PieceCompatibilityIssueCode.AUTH_REQUIREMENT_ADDED,
            severity: PieceCompatibilityIssueSeverity.REAUTH_REQUIRED,
            message: 'The new version requires a connection. A connection must be created and selected before the step can run.',
        }]
    }

    const fromAuths = normalizeAuthList(fromPiece.auth)
    const toAuths = normalizeAuthList(toPiece.auth)

    if (toAuths.length === 0) {
        return [{
            code: PieceCompatibilityIssueCode.AUTH_TYPE_CHANGED,
            severity: PieceCompatibilityIssueSeverity.INCOMPATIBLE,
            message: 'The new version requires a connection but declares no authentication method. The step cannot obtain a valid connection.',
        }]
    }
    if (fromAuths.length === 0) {
        return [{
            code: PieceCompatibilityIssueCode.AUTH_TYPE_CHANGED,
            severity: PieceCompatibilityIssueSeverity.REAUTH_REQUIRED,
            message: 'The new version declares authentication methods the old version did not have. Existing connections must be recreated.',
        }]
    }

    const toTypes = new Set(toAuths.map((auth) => auth.type))
    const droppedTypes = fromAuths.map((auth) => auth.type).filter((type) => !toTypes.has(type))
    const issues: PieceCompatibilityIssue[] = []
    if (droppedTypes.length > 0) {
        issues.push({
            code: PieceCompatibilityIssueCode.AUTH_TYPE_CHANGED,
            severity: PieceCompatibilityIssueSeverity.REAUTH_REQUIRED,
            message: `The new version no longer supports the previous authentication method (${droppedTypes.join(', ')}). A new connection must be created.`,
        })
    }
    for (const fromAuth of fromAuths) {
        const toAuth = toAuths.find((candidate) => candidate.type === fromAuth.type)
        if (!isNil(toAuth)) {
            issues.push(...compareSameTypeAuth(fromAuth, toAuth))
        }
    }
    return issues
}

function compareSameTypeAuth(fromAuth: AuthShape, toAuth: AuthShape): PieceCompatibilityIssue[] {
    if (fromAuth.type !== PropertyType.OAUTH2) {
        return compareAuthProps(fromAuth, toAuth)
    }
    const issues: PieceCompatibilityIssue[] = []
    const fromScopes = new Set(fromAuth.scope ?? [])
    const toScopes = new Set(toAuth.scope ?? [])
    const addedScopes = [...toScopes].filter((scope) => !fromScopes.has(scope))
    const removedScopes = [...fromScopes].filter((scope) => !toScopes.has(scope))
    if (addedScopes.length > 0) {
        issues.push({
            code: PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED,
            severity: PieceCompatibilityIssueSeverity.REAUTH_REQUIRED,
            message: 'The new version requests additional OAuth2 scopes. Existing connections must be reauthorized.',
        })
    }
    else if (removedScopes.length > 0) {
        issues.push({
            code: PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED,
            severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            message: 'The new version requests fewer OAuth2 scopes. Existing connections remain valid.',
        })
    }
    if (fromAuth.authUrl !== toAuth.authUrl || fromAuth.tokenUrl !== toAuth.tokenUrl) {
        issues.push({
            code: PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED,
            severity: PieceCompatibilityIssueSeverity.REAUTH_REQUIRED,
            message: 'The OAuth2 endpoints changed between versions. Existing connections must be reauthorized.',
        })
    }
    if (fromAuth.grantType !== toAuth.grantType) {
        issues.push({
            code: PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED,
            severity: PieceCompatibilityIssueSeverity.REAUTH_REQUIRED,
            message: 'The OAuth2 grant type changed between versions. Existing connections must be reauthorized.',
        })
    }
    if (fromAuth.pkce !== toAuth.pkce || fromAuth.prompt !== toAuth.prompt || fromAuth.authorizationMethod !== toAuth.authorizationMethod) {
        issues.push({
            code: PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED,
            severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            message: 'OAuth2 flow details (PKCE, prompt or authorization method) changed. This only affects connections created after the upgrade.',
        })
    }
    issues.push(...compareAuthProps(fromAuth, toAuth))
    return issues
}

function compareAuthProps(fromAuth: AuthShape, toAuth: AuthShape): PieceCompatibilityIssue[] {
    const fromProps = fromAuth.props ?? {}
    const toProps = toAuth.props ?? {}
    const issues: PieceCompatibilityIssue[] = []
    for (const [name, toProp] of Object.entries(toProps)) {
        const fromProp = fromProps[name]
        if (isNil(fromProp)) {
            issues.push({
                code: PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED,
                severity: toProp.required === true ? PieceCompatibilityIssueSeverity.REAUTH_REQUIRED : PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
                message: toProp.required === true
                    ? `The new version requires the connection field "${name}" that did not exist before. Existing connections must be reauthorized.`
                    : `The new version adds the optional connection field "${name}".`,
            })
        }
        else if (fromProp.type !== toProp.type) {
            issues.push({
                code: PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED,
                severity: PieceCompatibilityIssueSeverity.REAUTH_REQUIRED,
                message: `The connection field "${name}" changed type between versions. Existing connections must be reauthorized.`,
            })
        }
    }
    for (const name of Object.keys(fromProps)) {
        if (!(name in toProps)) {
            issues.push({
                code: PieceCompatibilityIssueCode.AUTH_CONFIG_CHANGED,
                severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
                message: `The connection field "${name}" no longer exists in the new version.`,
            })
        }
    }
    return issues
}

type AssessPropertiesParams = {
    fromDef: ActionOrTriggerDef | undefined
    toDef: ActionOrTriggerDef
    input: Record<string, unknown>
    propertySettings: Record<string, unknown>
    toVersion: string
}

function assessProperties({ fromDef, toDef, input, propertySettings, toVersion }: AssessPropertiesParams): PieceCompatibilityIssue[] {
    const fromProps = asPropMap(fromDef?.props)
    const toProps = asPropMap(toDef.props)
    const issues: PieceCompatibilityIssue[] = []

    for (const [name, fromProp] of Object.entries(fromProps)) {
        const toProp = toProps[name]
        if (isNil(toProp)) {
            const removedWithInput = hasValue(input[name])
            issues.push({
                code: PieceCompatibilityIssueCode.PROPERTY_REMOVED,
                severity: removedWithInput ? PieceCompatibilityIssueSeverity.INCOMPATIBLE : PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
                propertyName: name,
                message: removedWithInput
                    ? `Property "${name}" was removed in version ${toVersion} but the step has a saved value for it. The saved value will be lost.`
                    : `Property "${name}" was removed in version ${toVersion}.`,
            })
            continue
        }
        issues.push(...compareProperty({ name, fromProp, toProp, input, propertySettings, toVersion }))
    }

    for (const [name, toProp] of Object.entries(toProps)) {
        if (name in fromProps) {
            continue
        }
        const blocking = toProp.required === true && !hasDefault(toProp) && !hasValue(input[name])
        issues.push({
            code: PieceCompatibilityIssueCode.PROPERTY_ADDED,
            severity: blocking ? PieceCompatibilityIssueSeverity.INCOMPATIBLE : PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            propertyName: name,
            message: blocking
                ? `Property "${name}" is new and required in version ${toVersion} and has no default value. The step must be reconfigured before it can run.`
                : `Property "${name}" is new in version ${toVersion}.`,
        })
    }
    return issues
}

type ComparePropertyParams = {
    name: string
    fromProp: PropertyShape
    toProp: PropertyShape
    input: Record<string, unknown>
    propertySettings: Record<string, unknown>
    toVersion: string
}

function compareProperty({ name, fromProp, toProp, input, propertySettings, toVersion }: ComparePropertyParams): PieceCompatibilityIssue[] {
    const issues: PieceCompatibilityIssue[] = []
    const inputPresent = hasValue(input[name])

    if (fromProp.type !== toProp.type) {
        issues.push({
            code: PieceCompatibilityIssueCode.PROPERTY_TYPE_CHANGED,
            severity: inputPresent ? PieceCompatibilityIssueSeverity.INCOMPATIBLE : PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            propertyName: name,
            message: inputPresent
                ? `Property "${name}" changed type from ${fromProp.type ?? 'unknown'} to ${toProp.type ?? 'unknown'} in version ${toVersion} and the step has a saved value that may no longer be accepted.`
                : `Property "${name}" changed type from ${fromProp.type ?? 'unknown'} to ${toProp.type ?? 'unknown'} in version ${toVersion}.`,
        })
        // Type changed: saved-value and option checks against the old shape are meaningless.
        return issues
    }

    if (fromProp.required !== true && toProp.required === true && !inputPresent && !hasDefault(toProp)) {
        issues.push({
            code: PieceCompatibilityIssueCode.PROPERTY_BECAME_REQUIRED,
            severity: PieceCompatibilityIssueSeverity.INCOMPATIBLE,
            propertyName: name,
            message: `Property "${name}" is now required in version ${toVersion} and the step has no saved value for it. The step must be reconfigured before it can run.`,
        })
    }

    if (fromProp.displayName !== toProp.displayName || fromProp.description !== toProp.description || fromProp.placeholder !== toProp.placeholder) {
        issues.push({
            code: PieceCompatibilityIssueCode.PROPERTY_DISPLAY_CHANGED,
            severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            propertyName: name,
            message: `Property "${name}" has label, description or placeholder changes in version ${toVersion}.`,
        })
    }

    if (!isEqualJson(fromProp.defaultValue, toProp.defaultValue)) {
        issues.push({
            code: PieceCompatibilityIssueCode.DEFAULT_VALUE_CHANGED,
            severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            propertyName: name,
            message: `Property "${name}" has a different default value in version ${toVersion}.`,
        })
    }

    issues.push(...compareOptions({ name, fromProp, toProp, input, inputPresent }))
    issues.push(...compareDynamicSettings({ name, toProp, inputPresent, propertySettings }))
    const savedValueIssue = validateSavedValueAgainstProperty({ name, toProp, input, inputPresent })
    if (!isNil(savedValueIssue)) {
        issues.push(savedValueIssue)
    }
    return issues
}

/**
 * Validates a saved input value against the property rules of the NEW piece
 * version. Runs for properties whose type did not change (type changes are
 * already reported), so stale values that the new version would reject still
 * surface. Dynamic expressions ({{...}}) are resolved at runtime and skipped.
 * The saved value itself is never copied into the report.
 */
type ValidateSavedValueParams = {
    name: string
    toProp: PropertyShape
    input: Record<string, unknown>
    inputPresent: boolean
}

function validateSavedValueAgainstProperty({ name, toProp, input, inputPresent }: ValidateSavedValueParams): PieceCompatibilityIssue | null {
    if (!inputPresent) {
        return null
    }
    const value = input[name]
    if (typeof value === 'string' && value.includes('{{')) {
        return null
    }
    let valid: boolean
    switch (toProp.type) {
        case PropertyType.NUMBER:
            valid = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)))
            break
        case PropertyType.CHECKBOX:
            valid = typeof value === 'boolean' || value === 'true' || value === 'false'
            break
        case PropertyType.ARRAY:
            valid = Array.isArray(value)
            break
        case PropertyType.OBJECT:
            valid = isRecord(value)
            break
        default:
            return null
    }
    if (valid) {
        return null
    }
    return {
        code: PieceCompatibilityIssueCode.SAVED_VALUE_INVALID_TYPE,
        severity: PieceCompatibilityIssueSeverity.INCOMPATIBLE,
        propertyName: name,
        message: `The saved value for property "${name}" does not match the ${toProp.type ?? 'expected'} type of the new version. The step must be reconfigured.`,
    }
}

type CompareOptionsParams = {
    name: string
    fromProp: PropertyShape
    toProp: PropertyShape
    input: Record<string, unknown>
    inputPresent: boolean
}

function compareOptions({ name, fromProp, toProp, input, inputPresent }: CompareOptionsParams): PieceCompatibilityIssue[] {
    const issues: PieceCompatibilityIssue[] = []
    if (fromProp.type === PropertyType.STATIC_DROPDOWN || fromProp.type === PropertyType.STATIC_MULTI_SELECT_DROPDOWN) {
        const fromValues = (fromProp.options?.options ?? []).map((option) => option.value)
        const toValues = (toProp.options?.options ?? []).map((option) => option.value)
        const removedOptions = fromValues.filter((value) => !toValues.some((candidate) => isEqualJson(candidate, value)))
        const addedOptions = toValues.filter((value) => !fromValues.some((candidate) => isEqualJson(candidate, value)))
        if (inputPresent && !savedValueInOptions(input[name], toValues)) {
            issues.push({
                code: PieceCompatibilityIssueCode.SAVED_VALUE_NOT_IN_OPTIONS,
                severity: PieceCompatibilityIssueSeverity.INCOMPATIBLE,
                propertyName: name,
                message: `The saved value for property "${name}" is no longer an available option in the new version. The step must be reconfigured.`,
            })
        }
        else if (removedOptions.length > 0 || addedOptions.length > 0) {
            issues.push({
                code: PieceCompatibilityIssueCode.STATIC_OPTIONS_CHANGED,
                severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
                propertyName: name,
                message: `The available options for property "${name}" changed (${removedOptions.length} removed, ${addedOptions.length} added). The saved value is still available.`,
            })
        }
    }
    if (fromProp.type === PropertyType.DROPDOWN || fromProp.type === PropertyType.MULTI_SELECT_DROPDOWN || fromProp.type === PropertyType.DYNAMIC) {
        const refreshersChanged = !isEqualStringSet(fromProp.refreshers ?? [], toProp.refreshers ?? [])
        const searchChanged = fromProp.refreshOnSearch !== toProp.refreshOnSearch
        if (refreshersChanged || searchChanged) {
            issues.push({
                code: PieceCompatibilityIssueCode.DYNAMIC_OPTIONS_CHANGED,
                severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
                propertyName: name,
                message: `The dynamic options for property "${name}" are computed differently in the new version. Verify the saved value still resolves.`,
            })
        }
    }
    return issues
}

type CompareDynamicSettingsParams = {
    name: string
    toProp: PropertyShape
    inputPresent: boolean
    propertySettings: Record<string, unknown>
}

function compareDynamicSettings({ name, toProp, inputPresent, propertySettings }: CompareDynamicSettingsParams): PieceCompatibilityIssue[] {
    if (toProp.type !== PropertyType.DYNAMIC || !inputPresent) {
        return []
    }
    const settings = propertySettings[name]
    const settingsType = isRecord(settings) ? settings['type'] : undefined
    if (settingsType !== PropertyExecutionType.DYNAMIC) {
        return [{
            code: PieceCompatibilityIssueCode.DYNAMIC_SETTINGS_MISSING,
            severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            propertyName: name,
            message: `Property "${name}" is dynamic and has a saved value but no resolved dynamic schema stored. The schema will be resolved again when the step is opened.`,
        }]
    }
    return []
}

type AssessTriggerConfigParams = {
    fromDef: ActionOrTriggerDef | undefined
    toDef: ActionOrTriggerDef
}

function assessTriggerConfig({ fromDef, toDef }: AssessTriggerConfigParams): PieceCompatibilityIssue[] {
    if (isNil(fromDef) || !isTriggerDef(fromDef) || !isTriggerDef(toDef)) {
        return []
    }
    const issues: PieceCompatibilityIssue[] = []
    if (fromDef.type !== toDef.type) {
        issues.push({
            code: PieceCompatibilityIssueCode.TRIGGER_STRATEGY_CHANGED,
            severity: PieceCompatibilityIssueSeverity.INCOMPATIBLE,
            message: `The trigger strategy changed from ${fromDef.type} to ${toDef.type}. The trigger must be reconfigured and republished.`,
        })
    }
    const handshakeChanged = !isNil(fromDef.handshakeConfiguration) !== !isNil(toDef.handshakeConfiguration)
    const renewChanged = !isNil(fromDef.renewConfiguration) !== !isNil(toDef.renewConfiguration)
    if (fromDef.testStrategy !== toDef.testStrategy || handshakeChanged || renewChanged) {
        issues.push({
            code: PieceCompatibilityIssueCode.TRIGGER_CONFIG_CHANGED,
            severity: PieceCompatibilityIssueSeverity.DISPLAY_ONLY,
            message: 'Trigger test, handshake or renewal configuration changed between versions.',
        })
    }
    return issues
}

function isTriggerDef(def: ActionOrTriggerDef): def is PieceMetadataModel['triggers'][string] {
    return 'type' in def && 'testStrategy' in def
}

function normalizeAuthList(auth: PieceMetadataModel['auth']): AuthShape[] {
    if (isNil(auth)) {
        return []
    }
    const list = Array.isArray(auth) ? auth : [auth]
    return list.filter(isRecord).map((auth) => auth as AuthShape)
}

function asPropMap(props: unknown): Record<string, PropertyShape> {
    if (!isRecord(props)) {
        return {}
    }
    const result: Record<string, PropertyShape> = {}
    for (const [name, prop] of Object.entries(props)) {
        if (isRecord(prop)) {
            result[name] = prop as PropertyShape
        }
    }
    return result
}

function savedValueInOptions(savedValue: unknown, optionValues: unknown[]): boolean {
    if (Array.isArray(savedValue)) {
        return savedValue.every((value) => optionValues.some((candidate) => isEqualJson(candidate, value)))
    }
    return optionValues.some((candidate) => isEqualJson(candidate, savedValue))
}

function hasDefault(prop: PropertyShape): boolean {
    return !isNil(prop.defaultValue)
}

function hasValue(value: unknown): boolean {
    return !isNil(value) && value !== ''
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEqualStringSet(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value) => b.includes(value))
}

function isEqualJson(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true
    }
    if (isNil(a) || isNil(b) || typeof a !== 'object' || typeof b !== 'object') {
        return false
    }
    try {
        return JSON.stringify(a) === JSON.stringify(b)
    }
    catch {
        return false
    }
}
