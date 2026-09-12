import { describe, expect, it } from 'vitest'
import {
    CodeAction,
    FlowAction,
    FlowActionType,
    flowVersionDiffUtil,
    FlowTrigger,
    FlowTriggerType,
    FlowVersion,
    FlowVersionDiffChangeType,
    FlowVersionDiffSection,
    FlowVersionState,
    LoopOnItemsAction,
    MASKED_VALUE,
    NoteColorVariant,
    PieceAction,
    RouterAction,
} from '../../src'

function buildVersion(overrides: Partial<FlowVersion> = {}): FlowVersion {
    return {
        id: 'version-1',
        created: '2026-09-01T00:00:00.000Z',
        updated: '2026-09-01T00:00:00.000Z',
        flowId: 'flow-1',
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
            type: FlowTriggerType.EMPTY,
            valid: false,
            displayName: 'Select Trigger',
            lastUpdatedDate: '2026-09-01T00:00:00.000Z',
            settings: {},
        },
        ...overrides,
    }
}

function buildCodeAction(
    name: string,
    overrides: Partial<CodeAction> = {},
): CodeAction {
    return {
        name,
        type: FlowActionType.CODE,
        valid: true,
        displayName: name,
        lastUpdatedDate: '2026-09-01T00:00:00.000Z',
        settings: {
            sourceCode: { code: 'export const code = () => {}', packageJson: '{}' },
            input: {},
            errorHandlingOptions: {
                continueOnFailure: { value: false },
                retryOnFailure: { value: false },
            },
        },
        ...overrides,
    }
}

function buildPieceAction(
    name: string,
    overrides: Partial<PieceAction> = {},
): PieceAction {
    return {
        name,
        type: FlowActionType.PIECE,
        valid: true,
        displayName: name,
        lastUpdatedDate: '2026-09-01T00:00:00.000Z',
        settings: {
            pieceName: '@activepieces/piece-http',
            pieceVersion: '1.0.0',
            actionName: 'send_request',
            propertySettings: {},
            input: {},
            errorHandlingOptions: {
                continueOnFailure: { value: false },
                retryOnFailure: { value: false },
            },
        },
        ...overrides,
    }
}

function buildLoop(name: string, firstLoopAction?: FlowAction): LoopOnItemsAction {
    return {
        name,
        type: FlowActionType.LOOP_ON_ITEMS,
        valid: true,
        displayName: name,
        lastUpdatedDate: '2026-09-01T00:00:00.000Z',
        settings: {
            items: '{{ trigger.body.items }}',
        },
        firstLoopAction,
    }
}

function buildRouter(name: string, children: (FlowAction | null)[]): RouterAction {
    return {
        name,
        type: FlowActionType.ROUTER,
        valid: true,
        displayName: name,
        lastUpdatedDate: '2026-09-01T00:00:00.000Z',
        settings: {
            branches: [
                {
                    branchType: 'CONDITION',
                    branchName: 'Branch 1',
                    conditions: [
                        [
                            {
                                firstValue: '{{ 1 }}',
                                secondValue: '1',
                                operator: 'NUMBER_IS_EQUAL_TO',
                            },
                        ],
                    ],
                },
                { branchType: 'FALLBACK', branchName: 'Otherwise' },
            ],
            executionType: 'EXECUTE_FIRST_MATCH',
        },
        children,
    }
}

function buildNote(id: string, overrides: Partial<FlowVersion['notes'][number]> = {}): FlowVersion['notes'][number] {
    return {
        id,
        content: 'note',
        ownerId: null,
        color: NoteColorVariant.YELLOW,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    }
}

function chain(trigger: FlowTrigger, actions: FlowAction[]): FlowTrigger {
    const clonedActions: FlowAction[] = JSON.parse(JSON.stringify(actions))
    let nextAction: FlowAction | undefined
    for (let i = clonedActions.length - 1; i >= 0; i--) {
        clonedActions[i].nextAction = nextAction
        nextAction = clonedActions[i]
    }
    return { ...JSON.parse(JSON.stringify(trigger)), nextAction }
}

describe('flowVersionDiffUtil', () => {
    it('returns no changes for identical versions', () => {
        const trigger = chain(
            buildVersion().trigger,
            [buildCodeAction('step_1'), buildCodeAction('step_2')],
        )
        const from = buildVersion({ trigger })
        const to = buildVersion({ id: 'version-2', trigger: JSON.parse(JSON.stringify(trigger)) })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        expect(diff.hasChanges).toBe(false)
        expect(diff.steps).toEqual([])
        expect(diff.connections).toEqual([])
        expect(diff.notes).toEqual([])
        expect(diff.trigger.changed).toBe(false)
    })

    it('detects added and removed steps by name', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [buildCodeAction('step_1')]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildCodeAction('step_1'),
                buildCodeAction('step_2'),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const added = diff.steps.filter(
            (change) => change.changeType === FlowVersionDiffChangeType.ADDED,
        )
        expect(added).toHaveLength(1)
        expect(added[0].stepName).toBe('step_2')
        expect(added[0].sections).toContain(FlowVersionDiffSection.ACTION)
    })

    it('detects removed steps', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildCodeAction('step_1'),
                buildCodeAction('step_2'),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [buildCodeAction('step_1')]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        expect(diff.steps).toHaveLength(1)
        expect(diff.steps[0].changeType).toBe(FlowVersionDiffChangeType.REMOVED)
        expect(diff.steps[0].stepName).toBe('step_2')
    })

    it('treats a same-named step at a different position as moved, not add+remove', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildCodeAction('step_1'),
                buildCodeAction('step_2'),
                buildCodeAction('step_3'),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildCodeAction('step_2'),
                buildCodeAction('step_1'),
                buildCodeAction('step_3'),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const stepNames = diff.steps.map((change) => change.stepName)
        const addedOrRemoved = diff.steps.filter(
            (change) =>
                change.changeType === FlowVersionDiffChangeType.ADDED ||
                change.changeType === FlowVersionDiffChangeType.REMOVED,
        )
        expect(addedOrRemoved).toEqual([])
        const moved = diff.steps
            .filter(
                (change) =>
                    change.changeType === FlowVersionDiffChangeType.MOVED,
            )
            .map((change) => change.stepName)
        expect(moved.length).toBeGreaterThan(0)
        expect(stepNames).not.toEqual([])
    })

    it('does not report a move when the positional index only shifts due to an added step', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildCodeAction('step_1'),
                buildCodeAction('step_2'),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildCodeAction('step_1'),
                buildCodeAction('step_3'),
                buildCodeAction('step_2'),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const stepTwo = diff.steps.find((change) => change.stepName === 'step_2')
        expect(stepTwo).toBeUndefined()
        expect(diff.steps.map((change) => change.stepName)).toEqual(['step_3'])
    })

    it('detects input changes and masks secret keyed values', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        input: { url: 'https://a.example', apiKey: 'super-secret-value' },
                    },
                }),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        input: { url: 'https://b.example', apiKey: 'changed-secret' },
                    },
                }),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const stepChange = diff.steps.find((change) => change.stepName === 'step_1')
        expect(stepChange?.sections).toContain(FlowVersionDiffSection.INPUT)
        const urlChange = stepChange?.changes.find(
            (change) => change.label === 'url',
        )
        expect(urlChange?.before).toBe('https://a.example')
        expect(urlChange?.after).toBe('https://b.example')

        const secretChange = stepChange?.changes.find(
            (change) => change.label === 'apiKey',
        )
        expect(secretChange?.before).toBe(MASKED_VALUE)
        expect(secretChange?.after).toBe(MASKED_VALUE)
        expect(secretChange?.beforeMasked).toBe(true)
        expect(JSON.stringify(diff)).not.toContain('super-secret-value')
        expect(JSON.stringify(diff)).not.toContain('changed-secret')
    })

    it('masks camelCase secret keys but not unrelated keys that merely contain the word', () => {
        const buildWithInput = (input: Record<string, unknown>) =>
            buildVersion({
                trigger: chain(buildVersion().trigger, [
                    buildPieceAction('step_1', {
                        settings: {
                            ...buildPieceAction('step_1').settings,
                            input,
                        },
                    }),
                ]),
            })
        const from = buildWithInput({
            accessToken: 'old-access-token',
            clientSecret: 'old-client-secret',
            tokenizedDescription: 'plain text value',
        })
        const to = buildWithInput({
            accessToken: 'new-access-token',
            clientSecret: 'new-client-secret',
            tokenizedDescription: 'another plain text value',
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })
        const serialized = JSON.stringify(diff)

        expect(serialized).not.toContain('old-access-token')
        expect(serialized).not.toContain('new-client-secret')
        expect(serialized).toContain('plain text value')
        expect(serialized).toContain('another plain text value')
    })

    it('masks values declared as SECRET_TEXT or FILE in the property schema', () => {
        const actionFrom = buildPieceAction('step_1', {
            settings: {
                ...buildPieceAction('step_1').settings,
                propertySettings: {
                    token: {
                        type: 'MANUAL',
                        schema: { type: 'SECRET_TEXT' },
                    },
                    document: { type: 'MANUAL', schema: { type: 'FILE' } },
                },
                input: {
                    token: 'plain-keyed-value',
                    document: 'very-long-base64ish-content'.repeat(40),
                },
            },
        })
        const actionTo = buildPieceAction('step_1', {
            settings: {
                ...buildPieceAction('step_1').settings,
                propertySettings: {
                    token: {
                        type: 'MANUAL',
                        schema: { type: 'SECRET_TEXT' },
                    },
                    document: { type: 'MANUAL', schema: { type: 'FILE' } },
                },
                input: {
                    token: 'new-plain-keyed-value',
                    document: 'other-very-long-base64ish-content'.repeat(40),
                },
            },
        })
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [actionFrom]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [actionTo]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const serialized = JSON.stringify(diff)
        expect(serialized).not.toContain('plain-keyed-value')
        expect(serialized).not.toContain('very-long-base64ish-content')
        const stepChange = diff.steps.find((change) => change.stepName === 'step_1')
        const labels = (stepChange?.changes ?? []).map((change) => change.label)
        expect(labels).toContain('token')
        expect(labels).toContain('document')
    })

    it('masks short FILE values even when they do not look like base64', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        propertySettings: {
                            attachment: {
                                type: 'MANUAL',
                                schema: { type: 'FILE' },
                            },
                        },
                        input: { attachment: 'a' },
                    },
                }),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        propertySettings: {
                            attachment: {
                                type: 'MANUAL',
                                schema: { type: 'FILE' },
                            },
                        },
                        input: { attachment: 'b' },
                    },
                }),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })
        const serialized = JSON.stringify(diff)
        expect(serialized).not.toContain('"a"')
        expect(serialized).not.toContain('"b"')
        const change = diff.steps
            .find((step) => step.stepName === 'step_1')
            ?.changes.find((entry) => entry.label === 'attachment')
        expect(change?.beforeMasked).toBe(true)
        expect(change?.afterMasked).toBe(true)
        expect(change?.before).toBe(MASKED_VALUE)
        expect(change?.after).toBe(MASKED_VALUE)
    })

    it('masks nested FILE objects as a whole without leaking their inner fields', () => {
        const fileObjectFrom = {
            filename: 'invoice.pdf',
            extension: 'pdf',
            base64: 'SENSITIVE-INNER-CONTENT',
            size: 42,
        }
        const fileObjectTo = {
            filename: 'contract.pdf',
            extension: 'pdf',
            base64: 'OTHER-SENSITIVE-INNER-CONTENT',
            size: 99,
        }
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        propertySettings: {
                            attachment: {
                                type: 'MANUAL',
                                schema: { type: 'FILE' },
                            },
                        },
                        input: { attachment: fileObjectFrom },
                    },
                }),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        propertySettings: {
                            attachment: {
                                type: 'MANUAL',
                                schema: { type: 'FILE' },
                            },
                        },
                        input: { attachment: fileObjectTo },
                    },
                }),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })
        const serialized = JSON.stringify(diff)
        expect(serialized).not.toContain('invoice.pdf')
        expect(serialized).not.toContain('contract.pdf')
        expect(serialized).not.toContain('SENSITIVE-INNER-CONTENT')
        expect(serialized).not.toContain('OTHER-SENSITIVE-INNER-CONTENT')
        const changes = diff.steps
            .find((step) => step.stepName === 'step_1')
            ?.changes ?? []
        const attachmentChanges = changes.filter(
            (entry) => entry.label === 'attachment',
        )
        expect(attachmentChanges).toHaveLength(1)
        expect(attachmentChanges[0].beforeMasked).toBe(true)
        expect(attachmentChanges[0].afterMasked).toBe(true)
    })

    it('masks FILE values nested inside arrays and plain objects', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        propertySettings: {
                            files: { type: 'MANUAL', schema: { type: 'FILE' } },
                        },
                        input: {
                            files: [
                                { filename: 'a.png', data: 'SECRET-A' },
                                { filename: 'b.png', data: 'SECRET-B' },
                            ],
                        },
                    },
                }),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        propertySettings: {
                            files: { type: 'MANUAL', schema: { type: 'FILE' } },
                        },
                        input: {
                            files: [
                                { filename: 'c.png', data: 'SECRET-C' },
                                { filename: 'd.png', data: 'SECRET-D' },
                            ],
                        },
                    },
                }),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })
        const serialized = JSON.stringify(diff)
        for (const leaked of [
            'SECRET-A',
            'SECRET-B',
            'SECRET-C',
            'SECRET-D',
            'a.png',
        ]) {
            expect(serialized).not.toContain(leaked)
        }
    })

    it('masks Buffer and serialized Buffer file content', () => {
        const linkActions = (actions: FlowAction[]): FlowTrigger => {
            let nextAction: FlowAction | undefined
            const trigger = buildVersion().trigger
            for (let i = actions.length - 1; i >= 0; i--) {
                actions[i].nextAction = nextAction
                nextAction = actions[i]
            }
            trigger.nextAction = nextAction
            return trigger
        }
        const buildWithBinaries = (
            bytes: Uint8Array,
            serializedData: number[],
        ): FlowVersion =>
            buildVersion({
                trigger: linkActions([
                    buildPieceAction('step_1', {
                        settings: {
                            ...buildPieceAction('step_1').settings,
                            input: { binary: bytes },
                        },
                    }),
                    buildPieceAction('step_2', {
                        settings: {
                            ...buildPieceAction('step_2').settings,
                            input: {
                                binary: { type: 'Buffer', data: serializedData },
                            },
                        },
                    }),
                ]),
            })
        const from = buildWithBinaries(new Uint8Array([104, 105]), [104, 105, 10])
        const to = buildVersion({
            id: 'version-2',
            ...buildWithBinaries(new Uint8Array([105]), [105, 10]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })
        for (const stepName of ['step_1', 'step_2']) {
            const change = diff.steps
                .find((step) => step.stepName === stepName)
                ?.changes.find((entry) => entry.label === 'binary')
            expect(change?.beforeMasked).toBe(true)
            expect(change?.afterMasked).toBe(true)
            expect(change?.before).toBe(MASKED_VALUE)
            expect(change?.after).toBe(MASKED_VALUE)
        }
    })

    it('reports connection reference changes separately and never includes the connection id as an input change', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        input: { auth: "{{connections['conn-A']}}" },
                    },
                }),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildPieceAction('step_1', {
                    settings: {
                        ...buildPieceAction('step_1').settings,
                        input: { auth: "{{connections['conn-B']}}" },
                    },
                }),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        expect(diff.connections).toHaveLength(1)
        expect(diff.connections[0]).toMatchObject({
            changeType: FlowVersionDiffChangeType.MODIFIED,
            stepName: 'step_1',
            inputKey: 'auth',
            before: "{{connections['conn-A']}}",
            after: "{{connections['conn-B']}}",
        })
        const stepChange = diff.steps.find((change) => change.stepName === 'step_1')
        expect(
            (stepChange?.changes ?? []).some((change) => change.label === 'auth'),
        ).toBe(false)
    })

    it('detects router branch and loop structure changes', () => {
        const fromRouter = buildRouter('router_1', [buildCodeAction('step_1'), null])
        const toRouter = buildRouter('router_1', [buildCodeAction('step_1'), null])
        toRouter.settings = {
            ...toRouter.settings,
            executionType: 'EXECUTE_ALL_MATCH',
        }
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [fromRouter]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [toRouter]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const routerChange = diff.steps.find(
            (change) => change.stepName === 'router_1',
        )
        expect(routerChange?.sections).toContain(FlowVersionDiffSection.ROUTER)
        expect(
            routerChange?.changes.some(
                (change) => change.label === 'routerExecutionType',
            ),
        ).toBe(true)

        const fromLoop = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildLoop('loop_1', buildCodeAction('inner_1')),
            ]),
        })
        const toLoop = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildLoop('loop_1', buildCodeAction('inner_1')),
            ]),
        })
        ;(toLoop.trigger.nextAction as LoopOnItemsAction).settings.items =
            '{{ trigger.body.other }}'

        const loopDiff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: fromLoop,
            toVersion: toLoop,
        })
        const loopChange = loopDiff.steps.find(
            (change) => change.stepName === 'loop_1',
        )
        expect(loopChange?.sections).toContain(FlowVersionDiffSection.LOOP)
        expect(
            loopChange?.changes.some((change) => change.label === 'loopItems'),
        ).toBe(true)
    })

    it('detects a step moving into a loop container', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildLoop('loop_1'),
                buildCodeAction('step_1'),
            ]),
        })
        const loop = buildLoop('loop_1', buildCodeAction('step_1'))
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [loop]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const moved = diff.steps.find((change) => change.stepName === 'step_1')
        expect(moved?.changeType).toBe(FlowVersionDiffChangeType.MOVED)
        expect(moved?.parentStepName).toBe('loop_1')
        expect(moved?.previousParentStepName).toBeNull()
    })

    it('detects trigger changes', () => {
        const pieceTrigger: FlowTrigger = {
            name: 'trigger',
            type: FlowTriggerType.PIECE,
            valid: true,
            displayName: 'Webhook',
            lastUpdatedDate: '2026-09-01T00:00:00.000Z',
            settings: {
                pieceName: '@activepieces/piece-webhook',
                pieceVersion: '1.0.0',
                triggerName: 'new_request',
                propertySettings: {},
                input: {},
            },
        }
        const from = buildVersion({ trigger: pieceTrigger })
        const changedTrigger: FlowTrigger = JSON.parse(JSON.stringify(pieceTrigger))
        ;(changedTrigger.settings as { input: Record<string, unknown> }).input = {
            path: '/new',
        }
        const to = buildVersion({ id: 'version-2', trigger: changedTrigger })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        expect(diff.trigger.changed).toBe(true)
        expect(
            diff.trigger.changes.some((change) => change.label === 'path'),
        ).toBe(true)
    })

    it('reports trigger changes only under trigger and never as a step, and counts trigger connections once', () => {
        const triggerWithAuth = (connection: string): FlowTrigger => ({
            name: 'trigger',
            type: FlowTriggerType.PIECE,
            valid: true,
            displayName: 'Webhook',
            lastUpdatedDate: '2026-09-01T00:00:00.000Z',
            settings: {
                pieceName: '@activepieces/piece-webhook',
                pieceVersion: '1.0.0',
                triggerName: 'new_request',
                propertySettings: {},
                input: { auth: connection },
            },
        })
        const from = buildVersion({
            trigger: triggerWithAuth("{{connections['conn-A']}}"),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: triggerWithAuth("{{connections['conn-B']}}"),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        expect(
            diff.steps.some((step) => step.stepName === 'trigger'),
        ).toBe(false)
        const triggerConnections = diff.connections.filter(
            (connection) => connection.stepName === 'trigger',
        )
        expect(triggerConnections).toHaveLength(1)
        expect(triggerConnections[0]).toMatchObject({
            before: "{{connections['conn-A']}}",
            after: "{{connections['conn-B']}}",
        })
    })

    it('detects note add, remove, modify and move', () => {
        const from = buildVersion({
            notes: [
                buildNote('note-1', { content: 'hello' }),
                buildNote('note-2'),
            ],
        })
        const to = buildVersion({
            id: 'version-2',
            notes: [
                buildNote('note-1', { content: 'hello edited' }),
                buildNote('note-3'),
                buildNote('note-2', { position: { x: 50, y: 60 } }),
            ],
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const byId = new Map(diff.notes.map((change) => [change.noteId, change]))
        expect(byId.get('note-1')?.changeType).toBe(
            FlowVersionDiffChangeType.MODIFIED,
        )
        expect(byId.get('note-3')?.changeType).toBe(
            FlowVersionDiffChangeType.ADDED,
        )
        expect(byId.get('note-2')?.changeType).toBe(
            FlowVersionDiffChangeType.MOVED,
        )
    })

    it('masks code step source content but still flags the change', () => {
        const from = buildVersion({
            trigger: chain(buildVersion().trigger, [
                buildCodeAction('step_1', {
                    settings: {
                        ...buildCodeAction('step_1').settings,
                        sourceCode: { code: 'const a = 1', packageJson: '{}' },
                    },
                }),
            ]),
        })
        const to = buildVersion({
            id: 'version-2',
            trigger: chain(buildVersion().trigger, [
                buildCodeAction('step_1', {
                    settings: {
                        ...buildCodeAction('step_1').settings,
                        sourceCode: { code: 'const a = 2', packageJson: '{}' },
                    },
                }),
            ]),
        })

        const diff = flowVersionDiffUtil.diffFlowVersions({
            fromVersion: from,
            toVersion: to,
        })

        const serialized = JSON.stringify(diff)
        expect(serialized).not.toContain('const a = 1')
        expect(serialized).not.toContain('const a = 2')
        const change = diff.steps.find(
            (step) => step.stepName === 'step_1',
        )
        expect(
            change?.changes.some((entry) => entry.label === 'sourceCode'),
        ).toBe(true)
    })
})
