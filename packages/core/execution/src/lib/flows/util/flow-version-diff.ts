import { isNil } from '@activepieces/core-utils'
import {
    FlowVersionConnectionChange,
    FlowVersionDiff,
    FlowVersionDiffChangeType,
    FlowVersionDiffSection,
    FlowVersionNoteChange,
    FlowVersionStepChange,
    FlowVersionDiffValueChange,
    MASKED_VALUE,
    StepSection,
} from '../dto/flow-version-diff'
import { Note } from '../note'
import { FlowAction, FlowActionType, RouterAction } from '../actions/action'
import { FlowVersion } from '../flow-version'
import { FlowTriggerType } from '../triggers/trigger'
import { Step } from './flow-structure-util'

type ContainerKey =
    | { kind: 'main' }
    | { kind: 'loop'; stepName: string }
    | { kind: 'routerBranch'; stepName: string; branchIndex: number }
    | { kind: 'cof'; stepName: string; branch: 'onSuccess' | 'onFailure' }

type FlatStep = {
    step: Step
    container: ContainerKey
    dfsIndex: number
    localIndex: number
    isTrigger: boolean
}

const PROPERTY_SCHEMA_SECRET_TYPES = ['SECRET_TEXT']
const PROPERTY_SCHEMA_FILE_TYPES = ['FILE']
const SECRET_NAME_TOKENS = new Set([
    'secret',
    'password',
    'passwd',
    'token',
    'apikey',
    'accesskey',
    'clientsecret',
    'privatekey',
    'credential',
])
const CONNECTION_EXPRESSION_PATTERN =
    /^\s*\{\{\s*connections(?:\[['"][^'"]+['"]\]|\.[A-Za-z0-9_]+)\s*\}\}\s*$/
const DATA_URL_PATTERN = /^\s*data:[^;]*;base64,/

type DiffVersions = {
    fromVersion: FlowVersion
    toVersion: FlowVersion
}

function diffFlowVersions({
    fromVersion,
    toVersion,
}: DiffVersions): FlowVersionDiff {
    const fromSteps = flattenSteps(fromVersion)
    const toSteps = flattenSteps(toVersion)
    const fromActions = fromSteps.filter((item) => !item.isTrigger)
    const toActions = toSteps.filter((item) => !item.isTrigger)

    const fromMap = new Map(fromActions.map((item) => [item.step.name, item]))
    const toMap = new Map(toActions.map((item) => [item.step.name, item]))

    const stepChanges: FlowVersionStepChange[] = []
    const connectionChanges: FlowVersionConnectionChange[] = []

    for (const item of toActions) {
        if (!fromMap.has(item.step.name)) {
            stepChanges.push(buildAddedStepChange(item))
            collectConnectionChanges({
                step: item.step,
                beforeInput: undefined,
                afterInput: getStepInput(item.step),
                push: (change) => connectionChanges.push(change),
                changeType: FlowVersionDiffChangeType.ADDED,
            })
        }
    }

    for (const item of fromActions) {
        if (!toMap.has(item.step.name)) {
            stepChanges.push(buildRemovedStepChange(item))
            collectConnectionChanges({
                step: item.step,
                beforeInput: getStepInput(item.step),
                afterInput: undefined,
                push: (change) => connectionChanges.push(change),
                changeType: FlowVersionDiffChangeType.REMOVED,
            })
        }
    }

    for (const toItem of toActions) {
        const fromItem = fromMap.get(toItem.step.name)
        if (isNil(fromItem)) {
            continue
        }
        const change = diffMatchedStep({
            from: fromItem,
            to: toItem,
            fromSteps: fromActions,
            toSteps: toActions,
        })
        if (change) {
            stepChanges.push(change)
        }
        collectConnectionChanges({
            step: toItem.step,
            beforeInput: getStepInput(fromItem.step),
            afterInput: getStepInput(toItem.step),
            push: (change) => connectionChanges.push(change),
            changeType: FlowVersionDiffChangeType.MODIFIED,
        })
    }

    const triggerChanges = diffTrigger({
        fromTrigger: fromVersion.trigger,
        toTrigger: toVersion.trigger,
        connections: connectionChanges,
    })

    const noteChanges = diffNotes({
        fromNotes: fromVersion.notes,
        toNotes: toVersion.notes,
    })

    stepChanges.sort(
        (a, b) =>
            getSortIndex(fromActions, toActions, a.stepName) -
            getSortIndex(fromActions, toActions, b.stepName),
    )

    const hasChanges =
        triggerChanges.length > 0 ||
        stepChanges.length > 0 ||
        connectionChanges.length > 0 ||
        noteChanges.length > 0

    return {
        flowId: toVersion.flowId,
        fromVersionId: fromVersion.id,
        toVersionId: toVersion.id,
        fromVersion: {
            displayName: fromVersion.displayName,
            created: fromVersion.created,
            state: fromVersion.state,
        },
        toVersion: {
            displayName: toVersion.displayName,
            created: toVersion.created,
            state: toVersion.state,
        },
        trigger: {
            changed: triggerChanges.length > 0,
            changes: triggerChanges,
        },
        steps: stepChanges,
        connections: connectionChanges,
        notes: noteChanges,
        hasChanges,
    }
}

function getSortIndex(
    fromSteps: FlatStep[],
    toSteps: FlatStep[],
    stepName: string,
): number {
    const from = fromSteps.find((item) => item.step.name === stepName)
    if (from) {
        return from.dfsIndex
    }
    const to = toSteps.find((item) => item.step.name === stepName)
    return to ? to.dfsIndex : Number.MAX_SAFE_INTEGER
}

function buildAddedStepChange(item: FlatStep): FlowVersionStepChange {
    return {
        changeType: FlowVersionDiffChangeType.ADDED,
        stepName: item.step.name,
        stepDisplayName: item.step.displayName,
        sections: getStepSections(item.step),
        parentStepName: getParentStepName(item.container),
        index: item.dfsIndex,
        changes: [],
    }
}

function buildRemovedStepChange(item: FlatStep): FlowVersionStepChange {
    return {
        changeType: FlowVersionDiffChangeType.REMOVED,
        stepName: item.step.name,
        stepDisplayName: item.step.displayName,
        sections: getStepSections(item.step),
        previousParentStepName: getParentStepName(item.container),
        previousIndex: item.dfsIndex,
        changes: [],
    }
}

function diffMatchedStep({
    from,
    to,
    fromSteps,
    toSteps,
}: {
    from: FlatStep
    to: FlatStep
    fromSteps: FlatStep[]
    toSteps: FlatStep[]
}): FlowVersionStepChange | null {
    const sections = new Set<StepSection>()
    const changes: FlowVersionDiffValueChange[] = []
    const moved = detectMove({ from, to, fromSteps, toSteps })

    if (from.step.type !== to.step.type) {
        sections.add(FlowVersionDiffSection.ACTION)
        changes.push({
            path: 'type',
            label: 'stepType',
            before: from.step.type,
            after: to.step.type,
        })
    }

    if (from.step.displayName !== to.step.displayName) {
        sections.add(FlowVersionDiffSection.ACTION)
        changes.push({
            path: 'displayName',
            label: 'displayName',
            before: from.step.displayName,
            after: to.step.displayName,
        })
    }

    if ('skip' in from.step && 'skip' in to.step &&
        Boolean(from.step.skip) !== Boolean(to.step.skip)) {
        sections.add(FlowVersionDiffSection.ACTION)
        changes.push({
            path: 'skip',
            label: 'skip',
            before: Boolean(from.step.skip),
            after: Boolean(to.step.skip),
        })
    }

    diffPieceMetadata({ from: from.step, to: to.step, sections, changes })
    diffActionSettings({ from: from.step, to: to.step, sections, changes })
    diffInputs({ from: from.step, to: to.step, sections, changes })

    if (moved) {
        sections.add(FlowVersionDiffSection.ACTION)
    }

    if (sections.size === 0 && changes.length === 0 && !moved) {
        return null
    }

    return {
        changeType: moved
            ? FlowVersionDiffChangeType.MOVED
            : FlowVersionDiffChangeType.MODIFIED,
        stepName: to.step.name,
        stepDisplayName: to.step.displayName,
        sections: Array.from(sections),
        parentStepName: moved ? getParentStepName(to.container) : undefined,
        previousParentStepName: moved
            ? getParentStepName(from.container)
            : undefined,
        index: moved ? to.dfsIndex : undefined,
        previousIndex: moved ? from.dfsIndex : undefined,
        changes,
    }
}

function detectMove({
    from,
    to,
    fromSteps,
    toSteps,
}: {
    from: FlatStep
    to: FlatStep
    fromSteps: FlatStep[]
    toSteps: FlatStep[]
}): boolean {
    const sameContainer =
        containerKey(from.container) === containerKey(to.container)
    if (!sameContainer) {
        return true
    }
    if (from.localIndex === to.localIndex) {
        return false
    }
    const key = containerKey(from.container)
    const orderFrom = getOrderedSiblingNames({
        flatSteps: fromSteps,
        targetContainerKey: key,
    })
    const orderTo = getOrderedSiblingNames({
        flatSteps: toSteps,
        targetContainerKey: key,
    })
    const commonSubsequence = new Set(
        longestCommonSubsequence(orderFrom, orderTo),
    )
    return !commonSubsequence.has(from.step.name)
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
    const table: number[][] = Array.from({ length: a.length + 1 }, () =>
        new Array<number>(b.length + 1).fill(0),
    )
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i][j] =
                a[i] === b[j]
                    ? table[i + 1][j + 1] + 1
                    : Math.max(table[i + 1][j], table[i][j + 1])
        }
    }
    const result: string[] = []
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            result.push(a[i])
            i++
            j++
        }
        else if (table[i + 1][j] >= table[i][j + 1]) {
            i++
        }
        else {
            j++
        }
    }
    return result
}

function getOrderedSiblingNames({
    flatSteps,
    targetContainerKey,
}: {
    flatSteps: FlatStep[]
    targetContainerKey: string
}): string[] {
    return flatSteps
        .filter((item) => containerKey(item.container) === targetContainerKey)
        .sort((a, b) => a.localIndex - b.localIndex)
        .map((item) => item.step.name)
}

function diffPieceMetadata({
    from,
    to,
    sections,
    changes,
}: {
    from: Step
    to: Step
    sections: Set<StepSection>
    changes: FlowVersionDiffValueChange[]
}): void {
    const fromPiece = getPieceMetadata(from)
    const toPiece = getPieceMetadata(to)
    if (isNil(fromPiece) && isNil(toPiece)) {
        return
    }
    const metadataChanges: FlowVersionDiffValueChange[] = []
    for (const path of [
        'pieceName',
        'actionOrTriggerName',
        'pieceVersion',
    ] as const) {
        if (fromPiece?.[path] !== toPiece?.[path]) {
            metadataChanges.push({
                path,
                label: path,
                before: fromPiece?.[path] ?? '',
                after: toPiece?.[path] ?? '',
            })
        }
    }
    if (metadataChanges.length > 0) {
        sections.add(FlowVersionDiffSection.ACTION)
        changes.push(...metadataChanges)
    }
}

function getPieceMetadata(
    step: Step,
):
    | {
          pieceName: string
          actionOrTriggerName: string
          pieceVersion: string
      }
    | undefined {
    if (
        step.type !== FlowActionType.PIECE &&
        step.type !== FlowTriggerType.PIECE
    ) {
        return undefined
    }
    const settings = step.settings
    return {
        pieceName: settings.pieceName,
        actionOrTriggerName:
            ('actionName' in settings ? settings.actionName : undefined) ??
            ('triggerName' in settings ? settings.triggerName : undefined) ??
            '',
        pieceVersion: settings.pieceVersion ?? '',
    }
}

function diffActionSettings({
    from,
    to,
    sections,
    changes,
}: {
    from: Step
    to: Step
    sections: Set<StepSection>
    changes: FlowVersionDiffValueChange[]
}): void {
    if (
        from.type === FlowActionType.ROUTER &&
        to.type === FlowActionType.ROUTER
    ) {
        diffRouterSettings({ from, to, sections, changes })
    }
    if (
        from.type === FlowActionType.LOOP_ON_ITEMS &&
        to.type === FlowActionType.LOOP_ON_ITEMS
    ) {
        if (from.settings.items !== to.settings.items) {
            sections.add(FlowVersionDiffSection.LOOP)
            changes.push({
                path: 'settings.items',
                label: 'loopItems',
                before: from.settings.items,
                after: to.settings.items,
            })
        }
    }
    if (from.type === FlowActionType.CODE && to.type === FlowActionType.CODE) {
        const codeChanges: FlowVersionDiffValueChange[] = []
        if (from.settings.sourceCode.code !== to.settings.sourceCode.code) {
            codeChanges.push({
                path: 'settings.sourceCode.code',
                label: 'sourceCode',
                before: MASKED_VALUE,
                after: MASKED_VALUE,
                beforeMasked: true,
                afterMasked: true,
            })
        }
        if (
            from.settings.sourceCode.packageJson !==
            to.settings.sourceCode.packageJson
        ) {
            codeChanges.push({
                path: 'settings.sourceCode.packageJson',
                label: 'packageJson',
                before: from.settings.sourceCode.packageJson,
                after: to.settings.sourceCode.packageJson,
            })
        }
        if (codeChanges.length > 0) {
            sections.add(FlowVersionDiffSection.ACTION)
            changes.push(...codeChanges)
        }
    }
    diffErrorHandling({ from, to, sections, changes })
}

function diffRouterSettings({
    from,
    to,
    sections,
    changes,
}: {
    from: RouterAction
    to: RouterAction
    sections: Set<StepSection>
    changes: FlowVersionDiffValueChange[]
}): void {
    const routerChanges: FlowVersionDiffValueChange[] = []

    if (from.settings.executionType !== to.settings.executionType) {
        routerChanges.push({
            path: 'settings.executionType',
            label: 'routerExecutionType',
            before: from.settings.executionType,
            after: to.settings.executionType,
        })
    }

    const branchCount = Math.max(
        from.settings.branches.length,
        to.settings.branches.length,
    )
    for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
        const fromBranch = from.settings.branches[branchIndex]
        const toBranch = to.settings.branches[branchIndex]
        const branchLabel = `branch_${branchIndex + 1}`
        if (isNil(fromBranch) || isNil(toBranch)) {
            routerChanges.push({
                path: `settings.branches[${branchIndex}]`,
                label: branchLabel,
                before: fromBranch?.branchName,
                after: toBranch?.branchName,
            })
            continue
        }
        if (fromBranch.branchName !== toBranch.branchName) {
            routerChanges.push({
                path: `settings.branches[${branchIndex}].branchName`,
                label: `${branchLabel}_name`,
                before: fromBranch.branchName,
                after: toBranch.branchName,
            })
        }
        if (fromBranch.branchType !== toBranch.branchType) {
            routerChanges.push({
                path: `settings.branches[${branchIndex}].branchType`,
                label: `${branchLabel}_type`,
                before: fromBranch.branchType,
                after: toBranch.branchType,
            })
        }
        if ('conditions' in fromBranch && 'conditions' in toBranch) {
            const fromConditions = JSON.stringify(fromBranch.conditions)
            const toConditions = JSON.stringify(toBranch.conditions)
            if (fromConditions !== toConditions) {
                routerChanges.push({
                    path: `settings.branches[${branchIndex}].conditions`,
                    label: `${branchLabel}_conditions`,
                    before: fromBranch.conditions,
                    after: toBranch.conditions,
                })
            }
        }
    }

    if (routerChanges.length > 0) {
        sections.add(FlowVersionDiffSection.ROUTER)
        changes.push(...routerChanges)
    }
}

function diffErrorHandling({
    from,
    to,
    sections,
    changes,
}: {
    from: Step
    to: Step
    sections: Set<StepSection>
    changes: FlowVersionDiffValueChange[]
}): void {
    const fromOptions =
        'errorHandlingOptions' in from.settings
            ? from.settings.errorHandlingOptions
            : undefined
    const toOptions =
        'errorHandlingOptions' in to.settings
            ? to.settings.errorHandlingOptions
            : undefined
    if (isNil(fromOptions) && isNil(toOptions)) {
        return
    }
    const fromContinue = fromOptions?.continueOnFailure?.value ?? false
    const toContinue = toOptions?.continueOnFailure?.value ?? false
    const fromRetry = fromOptions?.retryOnFailure?.value ?? false
    const toRetry = toOptions?.retryOnFailure?.value ?? false
    if (fromContinue !== toContinue) {
        sections.add(FlowVersionDiffSection.ACTION)
        changes.push({
            path: 'settings.errorHandlingOptions.continueOnFailure',
            label: 'continueOnFailure',
            before: fromContinue,
            after: toContinue,
        })
    }
    if (fromRetry !== toRetry) {
        sections.add(FlowVersionDiffSection.ACTION)
        changes.push({
            path: 'settings.errorHandlingOptions.retryOnFailure',
            label: 'retryOnFailure',
            before: fromRetry,
            after: toRetry,
        })
    }
}

function getStepInput(
    step: Step,
): Record<string, unknown> | undefined {
    const settings = step.settings as { input?: unknown }
    if (isNil(settings.input) || typeof settings.input !== 'object') {
        return undefined
    }
    return settings.input as Record<string, unknown>
}

function diffInputs({
    from,
    to,
    sections,
    changes,
}: {
    from: Step
    to: Step
    sections: Set<StepSection>
    changes: FlowVersionDiffValueChange[]
}): void {
    const fromInput = getStepInput(from)
    const toInput = getStepInput(to)
    if (isNil(fromInput) && isNil(toInput)) {
        return
    }
    const inputChanges = diffInputValues({
        fromInput: fromInput ?? {},
        toInput: toInput ?? {},
        path: 'settings.input',
        labelPrefix: '',
        secretResolver: createSecretResolver(from, to),
    })
    if (inputChanges.length > 0) {
        sections.add(FlowVersionDiffSection.INPUT)
        changes.push(...inputChanges)
    }
}

type SecretResolver = (path: string, key: string, value: unknown) => boolean

function createSecretResolver(from: Step, to: Step): SecretResolver {
    const schemaByKey = new Map<string, unknown>()
    for (const step of [from, to]) {
        const propertySettings = (
            step.settings as { propertySettings?: Record<string, unknown> }
        ).propertySettings
        if (propertySettings) {
            for (const [key, value] of Object.entries(propertySettings)) {
                schemaByKey.set(key, value)
            }
        }
    }
    return (path: string, key: string, value: unknown): boolean => {
        if (key === 'auth') {
            return false
        }
        const propertySetting = schemaByKey.get(key) as
            | { schema?: { type?: string } }
            | undefined
        const schemaType = propertySetting?.schema?.type
        if (
            typeof schemaType === 'string' &&
            (PROPERTY_SCHEMA_SECRET_TYPES.includes(schemaType) ||
                PROPERTY_SCHEMA_FILE_TYPES.includes(schemaType))
        ) {
            return true
        }
        if (looksLikeSecretKey(key)) {
            return true
        }
        if (
            typeof value === 'string' &&
            (DATA_URL_PATTERN.test(value) || looksLikeInlineFile(value))
        ) {
            return true
        }
        return false
    }
}

function looksLikeSecretKey(key: string): boolean {
    const splitOnCaseAndSeparators = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter((token) => token.length > 0)
        .map((token) => token.toLowerCase())
        .join(' ')
    const compact = splitOnCaseAndSeparators.replace(/\s+/g, '')
    const tokens = new Set(splitOnCaseAndSeparators.split(' '))
    if (
        tokens.has('api') &&
        tokens.has('key') ||
        tokens.has('access') && tokens.has('key') ||
        tokens.has('client') && tokens.has('secret') ||
        tokens.has('private') && tokens.has('key')
    ) {
        return true
    }
    return Array.from(SECRET_NAME_TOKENS).some(
        (token) => token === compact || tokens.has(token),
    )
}

function looksLikeInlineFile(value: string): boolean {
    if (value.length < 256 || value.includes('{{')) {
        return false
    }
    const compact = value.replace(/\s/g, '')
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(compact)) {
        return false
    }
    return compact.length % 4 === 0
}

function diffInputValues({
    fromInput,
    toInput,
    path,
    labelPrefix,
    secretResolver,
}: {
    fromInput: Record<string, unknown>
    toInput: Record<string, unknown>
    path: string
    labelPrefix: string
    secretResolver: SecretResolver
}): FlowVersionDiffValueChange[] {
    const changes: FlowVersionDiffValueChange[] = []
    const keys = Array.from(
        new Set([...Object.keys(fromInput), ...Object.keys(toInput)]),
    )
    for (const key of keys) {
        const keyPath = `${path}.${key}`
        const label = labelPrefix ? `${labelPrefix}.${key}` : key
        const fromValue = fromInput[key]
        const toValue = toInput[key]
        if (key === 'auth') {
            continue
        }
        if (isConnectionReference(fromValue) || isConnectionReference(toValue)) {
            continue
        }
        if (isPlainObject(fromValue) || isPlainObject(toValue)) {
            changes.push(
                ...diffInputValues({
                    fromInput: (fromValue as Record<string, unknown>) ?? {},
                    toInput: (toValue as Record<string, unknown>) ?? {},
                    path: keyPath,
                    labelPrefix: label,
                    secretResolver,
                }),
            )
            continue
        }
        if (deepEqualValues(fromValue, toValue)) {
            continue
        }
        const isSecret =
            secretResolver(keyPath, key, toValue) ||
            secretResolver(keyPath, key, fromValue)
        changes.push({
            path: keyPath,
            label,
            before: isSecret && !isNil(fromValue) ? MASKED_VALUE : fromValue,
            after: isSecret && !isNil(toValue) ? MASKED_VALUE : toValue,
            beforeMasked:
                isSecret && !isNil(fromValue) ? true : undefined,
            afterMasked: isSecret && !isNil(toValue) ? true : undefined,
        })
    }
    return changes
}

function collectConnectionChanges({
    step,
    beforeInput,
    afterInput,
    push,
    changeType,
}: {
    step: Step
    beforeInput?: Record<string, unknown>
    afterInput?: Record<string, unknown>
    push: (change: FlowVersionConnectionChange) => void
    changeType: 'ADDED' | 'REMOVED' | 'MODIFIED'
}): void {
    const before = extractConnectionReferences(beforeInput)
    const after = extractConnectionReferences(afterInput)
    const paths = Array.from(new Set([...before.keys(), ...after.keys()]))
    for (const inputKey of paths) {
        const beforeValue = before.get(inputKey)
        const afterValue = after.get(inputKey)
        const normalizedBefore = beforeValue === '' ? undefined : beforeValue
        const normalizedAfter = afterValue === '' ? undefined : afterValue
        if (normalizedBefore === normalizedAfter) {
            continue
        }
        const resolvedChangeType =
            changeType === FlowVersionDiffChangeType.MODIFIED
                ? isNil(normalizedBefore)
                    ? FlowVersionDiffChangeType.ADDED
                    : isNil(normalizedAfter)
                      ? FlowVersionDiffChangeType.REMOVED
                      : FlowVersionDiffChangeType.MODIFIED
                : changeType
        push({
            changeType: resolvedChangeType,
            stepName: step.name,
            stepDisplayName: step.displayName,
            inputKey,
            before: normalizedBefore,
            after: normalizedAfter,
        })
    }
}

function extractConnectionReferences(
    input: Record<string, unknown> | undefined,
): Map<string, string> {
    const references = new Map<string, string>()
    if (isNil(input)) {
        return references
    }
    walkInput(input, '', (path, value) => {
        references.set(path, value ?? '')
    })
    return references
}

function walkInput(
    value: unknown,
    path: string,
    visit: (path: string, value: string | undefined) => void,
    leafKey?: string,
): void {
    if (leafKey === 'auth' && (isNil(value) || typeof value === 'string')) {
        visit(path || 'auth', value ?? undefined)
        return
    }
    if (typeof value === 'string') {
        if (isConnectionReference(value)) {
            visit(path || 'value', value)
        }
        return
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            const itemPath = path ? `${path}[${index}]` : `[${index}]`
            if (isPlainObject(item)) {
                walkInput(
                    item as Record<string, unknown>,
                    itemPath,
                    visit,
                )
            }
            else if (typeof item === 'string' && isConnectionReference(item)) {
                visit(itemPath, item)
            }
        })
        return
    }
    if (isPlainObject(value)) {
        for (const [key, nested] of Object.entries(
            value as Record<string, unknown>,
        )) {
            const nestedPath = path ? `${path}.${key}` : key
            walkInput(nested, nestedPath, visit, key)
        }
    }
}

function isConnectionReference(value: unknown): value is string {
    return typeof value === 'string' && CONNECTION_EXPRESSION_PATTERN.test(value)
}

function diffTrigger({
    fromTrigger,
    toTrigger,
    connections,
}: {
    fromTrigger: FlowVersion['trigger']
    toTrigger: FlowVersion['trigger']
    connections: FlowVersionConnectionChange[]
}): FlowVersionDiffValueChange[] {
    const changes: FlowVersionDiffValueChange[] = []
    if (fromTrigger.type !== toTrigger.type) {
        changes.push({
            path: 'type',
            label: 'triggerType',
            before: fromTrigger.type,
            after: toTrigger.type,
        })
    }
    const fromPiece = getPieceMetadata(fromTrigger)
    const toPiece = getPieceMetadata(toTrigger)
    if (fromPiece || toPiece) {
        for (const path of [
            'pieceName',
            'actionOrTriggerName',
            'pieceVersion',
        ] as const) {
            if (fromPiece?.[path] !== toPiece?.[path]) {
                changes.push({
                    path,
                    label: path,
                    before: fromPiece?.[path] ?? '',
                    after: toPiece?.[path] ?? '',
                })
            }
        }
    }
    if (fromTrigger.displayName !== toTrigger.displayName) {
        changes.push({
            path: 'displayName',
            label: 'displayName',
            before: fromTrigger.displayName,
            after: toTrigger.displayName,
        })
    }
    const inputChanges = diffInputValues({
        fromInput: getStepInput(fromTrigger) ?? {},
        toInput: getStepInput(toTrigger) ?? {},
        path: 'settings.input',
        labelPrefix: '',
        secretResolver: createSecretResolver(fromTrigger, toTrigger),
    })
    changes.push(...inputChanges)
    collectConnectionChanges({
        step: toTrigger,
        beforeInput: getStepInput(fromTrigger),
        afterInput: getStepInput(toTrigger),
        push: (change) => connections.push(change),
        changeType: FlowVersionDiffChangeType.MODIFIED,
    })
    return changes
}

function diffNotes({
    fromNotes,
    toNotes,
}: {
    fromNotes: Note[]
    toNotes: Note[]
}): FlowVersionNoteChange[] {
    const changes: FlowVersionNoteChange[] = []
    const fromMap = new Map(fromNotes.map((note) => [note.id, note]))
    const toMap = new Map(toNotes.map((note) => [note.id, note]))

    for (const note of toNotes) {
        if (!fromMap.has(note.id)) {
            changes.push({
                changeType: FlowVersionDiffChangeType.ADDED,
                noteId: note.id,
                changes: [
                    {
                        path: 'content',
                        label: 'content',
                        after: note.content,
                    },
                ],
            })
        }
    }
    for (const note of fromNotes) {
        if (!toMap.has(note.id)) {
            changes.push({
                changeType: FlowVersionDiffChangeType.REMOVED,
                noteId: note.id,
                changes: [
                    {
                        path: 'content',
                        label: 'content',
                        before: note.content,
                    },
                ],
            })
        }
    }
    for (const toNote of toNotes) {
        const fromNote = fromMap.get(toNote.id)
        if (isNil(fromNote)) {
            continue
        }
        const noteChanges: FlowVersionDiffValueChange[] = []
        if (fromNote.content !== toNote.content) {
            noteChanges.push({
                path: 'content',
                label: 'content',
                before: fromNote.content,
                after: toNote.content,
            })
        }
        const moved =
            fromNote.position.x !== toNote.position.x ||
            fromNote.position.y !== toNote.position.y
        if (moved) {
            noteChanges.push({
                path: 'position',
                label: 'position',
                before: fromNote.position,
                after: toNote.position,
            })
        }
        if (fromNote.color !== toNote.color) {
            noteChanges.push({
                path: 'color',
                label: 'color',
                before: fromNote.color,
                after: toNote.color,
            })
        }
        if (noteChanges.length > 0) {
            changes.push({
                changeType: moved
                    ? FlowVersionDiffChangeType.MOVED
                    : FlowVersionDiffChangeType.MODIFIED,
                noteId: toNote.id,
                changes: noteChanges,
            })
        }
    }
    return changes
}

function getStepSections(step: Step): StepSection[] {
    if (step.type === FlowActionType.ROUTER) {
        return [FlowVersionDiffSection.ROUTER]
    }
    if (step.type === FlowActionType.LOOP_ON_ITEMS) {
        return [FlowVersionDiffSection.LOOP]
    }
    return [FlowVersionDiffSection.ACTION]
}

function getParentStepName(container: ContainerKey): string | null {
    if (container.kind === 'main') {
        return null
    }
    return container.stepName
}

function containerKey(container: ContainerKey): string {
    switch (container.kind) {
        case 'main':
            return 'main'
        case 'loop':
            return `loop:${container.stepName}`
        case 'routerBranch':
            return `router:${container.stepName}:${container.branchIndex}`
        case 'cof':
            return `cof:${container.stepName}:${container.branch}`
    }
}

function flattenSteps(version: FlowVersion): FlatStep[] {
    const flat: FlatStep[] = []
    let dfsIndex = 0

    const walkChain = (
        action: FlowAction | undefined,
        container: ContainerKey,
    ): void => {
        let localIndex = 0
        let current: FlowAction | undefined = action
        while (!isNil(current)) {
            const step = current
            flat.push({
                step,
                container,
                dfsIndex,
                localIndex,
                isTrigger: false,
            })
            dfsIndex++
            localIndex++
            visitContainers(step)
            current = step.nextAction
        }
    }

    const visitContainers = (action: FlowAction): void => {
        if (action.type === FlowActionType.LOOP_ON_ITEMS) {
            walkChain(action.firstLoopAction, {
                kind: 'loop',
                stepName: action.name,
            })
        }
        if (action.type === FlowActionType.ROUTER) {
            action.children.forEach((child, branchIndex) => {
                walkChain(child ?? undefined, {
                    kind: 'routerBranch',
                    stepName: action.name,
                    branchIndex,
                })
            })
        }
        if (
            action.type === FlowActionType.PIECE ||
            action.type === FlowActionType.CODE
        ) {
            const branches = action.continueOnFailureBranches
            if (branches?.onSuccess) {
                walkChain(branches.onSuccess, {
                    kind: 'cof',
                    stepName: action.name,
                    branch: 'onSuccess',
                })
            }
            if (branches?.onFailure) {
                walkChain(branches.onFailure, {
                    kind: 'cof',
                    stepName: action.name,
                    branch: 'onFailure',
                })
            }
        }
    }

    flat.push({
        step: version.trigger,
        container: { kind: 'main' },
        dfsIndex,
        localIndex: 0,
        isTrigger: true,
    })
    dfsIndex++
    walkChain(version.trigger.nextAction as FlowAction | undefined, {
        kind: 'main',
    })

    return flat
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepEqualValues(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true
    }
    if (typeof a !== typeof b) {
        return false
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false
        }
        return a.every((item, index) => deepEqualValues(item, b[index]))
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const aKeys = Object.keys(a)
        const bKeys = Object.keys(b)
        if (aKeys.length !== bKeys.length) {
            return false
        }
        return aKeys.every((key) => deepEqualValues(a[key], b[key]))
    }
    return false
}

export const flowVersionDiffUtil = {
    diffFlowVersions,
}
