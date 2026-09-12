import {
    BranchExecutionType,
    BranchOperator,
    CodeAction,
    FlowAction,
    FlowActionType,
    FlowOperationRequest,
    flowOperations,
    FlowOperationType,
    flowStructureUtil,
    FlowTriggerType,
    FlowVersion,
    FlowVersionState,
    LoopOnItemsAction,
    PasteLocation,
    PieceAction,
    PropertyExecutionType,
    RouterAction,
    RouterExecutionType,
    StepLocationRelativeToParent,
} from '../../src'
import { _moveAction } from '../../src/lib/flows/operations/move-action'

function createCodeAction(name: string, displayName = 'Code'): CodeAction {
    return {
        name,
        displayName,
        type: FlowActionType.CODE,
        valid: true,
        settings: {
            sourceCode: {
                code: 'test',
                packageJson: '{}',
            },
            input: {},
        },
    }
}

function createStorePieceAction({ name, displayName, keyReference, label }: {
    name: string
    displayName: string
    keyReference: string
    label?: string
}): PieceAction {
    return {
        name,
        displayName,
        type: FlowActionType.PIECE,
        valid: true,
        settings: {
            input: {
                key: keyReference,
                ...(label ? { label } : {}),
                auth: "{{connections['store_connection']}}",
            },
            pieceName: 'store',
            pieceVersion: '0.2.6',
            actionName: 'get',
            propertySettings: {
                key: { type: PropertyExecutionType.MANUAL },
                auth: { type: PropertyExecutionType.MANUAL },
            },
        },
    }
}

function baseFlowVersion(nextAction?: FlowAction): FlowVersion {
    return {
        id: 'copyPasteMoveFlowVersion',
        created: '2023-05-24T00:16:41.353Z',
        updated: '2023-05-24T00:16:41.353Z',
        flowId: 'copyPasteMoveFlow',
        updatedBy: '',
        displayName: 'Copy Paste Move',
        agentIds: [],
        notes: [],
        trigger: {
            name: 'trigger',
            type: FlowTriggerType.PIECE,
            valid: true,
            settings: {
                input: {
                    cronExpression: '25 10 * * 0,1,2,3,4',
                },
                pieceName: 'schedule',
                pieceVersion: '0.0.2',
                propertySettings: {
                    'cronExpression': {
                        type: PropertyExecutionType.MANUAL,
                    },
                },
                triggerName: 'cron_expression',
            },
            displayName: 'Cron Expression',
            nextAction,
        },
        connectionIds: [],
        valid: true,
        state: FlowVersionState.DRAFT,
    }
}

// trigger -> step_1 (code) -> step_2 (piece, references step_1) -> step_3 (code)
function chainFlow(): FlowVersion {
    return baseFlowVersion({
        ...createCodeAction('step_1', 'Lookup'),
        nextAction: {
            ...createStorePieceAction({
                name: 'step_2',
                displayName: 'Save',
                keyReference: "{{ step_1['output'].id }}",
                label: 'step_1',
            }),
            nextAction: createCodeAction('step_3', 'Notify'),
        },
    })
}

// trigger -> step_1 (code) -> step_2 (router) -> step_6 (code)
//   router branch 0 'Branch 1':   step_3 (code) -> step_4 (code)
//   router branch 1 'Branch 2':   <empty>
//   router branch 2 'Otherwise':  step_5 (piece, references step_3)
function routerFlow(): FlowVersion {
    return baseFlowVersion({
        ...createCodeAction('step_1', 'Seed'),
        nextAction: {
            name: 'step_2',
            displayName: 'Router',
            type: FlowActionType.ROUTER,
            valid: true,
            settings: {
                branches: [
                    {
                        branchName: 'Branch 1',
                        branchType: BranchExecutionType.CONDITION,
                        conditions: [
                            [
                                {
                                    operator: BranchOperator.TEXT_CONTAINS,
                                    firstValue: "{{ step_1['output'].value }}",
                                    secondValue: 'x',
                                    caseSensitive: true,
                                },
                            ],
                        ],
                    },
                    {
                        branchName: 'Branch 2',
                        branchType: BranchExecutionType.CONDITION,
                        conditions: [
                            [
                                {
                                    operator: BranchOperator.TEXT_CONTAINS,
                                    firstValue: 'static',
                                    secondValue: 'y',
                                    caseSensitive: true,
                                },
                            ],
                        ],
                    },
                    {
                        branchName: 'Otherwise',
                        branchType: BranchExecutionType.FALLBACK,
                    },
                ],
                executionType: RouterExecutionType.EXECUTE_ALL_MATCH,
            },
            children: [
                {
                    ...createCodeAction('step_3', 'Branch One Head'),
                    nextAction: createCodeAction('step_4', 'Branch One Tail'),
                },
                null,
                createStorePieceAction({
                    name: 'step_5',
                    displayName: 'Branch Three Head',
                    keyReference: "{{ step_3['output'].id }}",
                }),
            ],
            nextAction: createCodeAction('step_6', 'After Router'),
        },
    })
}

// trigger -> step_1 (loop) -> step_4 (code)
//   loop body: step_2 (code) -> step_3 (piece, references step_2)
function loopFlow(): FlowVersion {
    return baseFlowVersion({
        name: 'step_1',
        displayName: 'Loop',
        type: FlowActionType.LOOP_ON_ITEMS,
        valid: true,
        settings: {
            items: "{{ trigger['output'].items }}",
        },
        firstLoopAction: {
            ...createCodeAction('step_2', 'Loop Head'),
            nextAction: createStorePieceAction({
                name: 'step_3',
                displayName: 'Loop Tail',
                keyReference: "{{ step_2['output'].id }}",
            }),
        },
        nextAction: createCodeAction('step_4', 'After Loop'),
    })
}

function applyOperations(flowVersion: FlowVersion, operations: FlowOperationRequest[]): FlowVersion {
    return operations.reduce((flow, operation) => flowOperations.apply(flow, operation), flowVersion)
}

function paste(flowVersion: FlowVersion, actions: FlowAction[], pastingDetails: PasteLocation): {
    operations: FlowOperationRequest[]
    result: FlowVersion
} {
    const operations = flowOperations.getOperationsForPaste(actions, flowVersion, pastingDetails)
    return {
        operations,
        result: applyOperations(flowVersion, operations),
    }
}

function summarize(operations: FlowOperationRequest[]): unknown[] {
    return operations.map((operation) => {
        switch (operation.type) {
            case FlowOperationType.ADD_ACTION:
                return {
                    type: operation.type,
                    name: operation.request.action.name,
                    parentStep: operation.request.parentStep,
                    location: operation.request.stepLocationRelativeToParent,
                    branchIndex: operation.request.branchIndex,
                }
            case FlowOperationType.DELETE_ACTION:
                return {
                    type: operation.type,
                    names: operation.request.names,
                }
            default:
                return { type: operation.type }
        }
    })
}

function getAction(flowVersion: FlowVersion, name: string): FlowAction {
    return flowStructureUtil.getStepOrThrow(name, flowVersion.trigger) as FlowAction
}

function nextActionName(flowVersion: FlowVersion, name: string): string | undefined {
    return getAction(flowVersion, name).nextAction?.name
}

describe('Flow Builder copy/paste and move behavior', () => {
    describe('copy (getActionsForCopy)', () => {
        it('detaches the copied action from its nextAction and from the flow', () => {
            const flowVersion = chainFlow()

            const copied = flowOperations.getActionsForCopy(['step_1'], flowVersion)

            expect(copied).toHaveLength(1)
            expect(copied[0].name).toBe('step_1')
            expect(copied[0].nextAction).toBeUndefined()

            copied[0].displayName = 'Mutated'
            expect(getAction(flowVersion, 'step_1').displayName).toBe('Lookup')
        })

        it('copies a selected parent only once when its child is also selected', () => {
            const flowVersion = routerFlow()

            const copied = flowOperations.getActionsForCopy(['step_2', 'step_3'], flowVersion)

            expect(copied).toHaveLength(1)
            expect(copied[0].name).toBe('step_2')
            const copiedRouter = copied[0] as RouterAction
            expect(copiedRouter.children.map(child => child?.name ?? null)).toEqual(['step_3', null, 'step_5'])
        })

        it('ignores the trigger when it is part of the selection', () => {
            const copied = flowOperations.getActionsForCopy(['trigger', 'step_1'], chainFlow())

            expect(copied.map(action => action.name)).toEqual(['step_1'])
        })

        it('returns no actions for an empty selection', () => {
            expect(flowOperations.getActionsForCopy([], chainFlow())).toEqual([])
        })

        it('throws when a selected step does not exist', () => {
            expect(() => flowOperations.getActionsForCopy(['missing_step'], chainFlow())).toThrow('ENTITY_NOT_FOUND')
        })

        // DEFECT: _getActionsForCopy sorts the cloned actions with allSteps.indexOf(clone),
        // which is always -1 (the clones are not in allSteps), so the intended flow-order
        // sort is a no-op and the clipboard keeps the arbitrary selection order.
        // Failing evidence kept; the fix is handled separately from these tests.
        it('returns the copied actions in flow order regardless of selection order', () => {
            const copied = flowOperations.getActionsForCopy(['step_3', 'step_1'], chainFlow())

            expect(copied.map(action => action.name)).toEqual(['step_1', 'step_3'])
        })
    })

    describe('paste (getOperationsForPaste + apply)', () => {
        it('pastes a single action after the target step', () => {
            const flowVersion = chainFlow()
            const actions = flowOperations.getActionsForCopy(['step_1'], flowVersion)

            const { operations, result } = paste(flowVersion, actions, {
                parentStepName: 'step_2',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
            })

            expect(summarize(operations)).toEqual([
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_4',
                    parentStep: 'step_2',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
            ])
            expect(nextActionName(result, 'step_2')).toBe('step_4')
            expect(nextActionName(result, 'step_4')).toBe('step_3')
            expect(getAction(result, 'step_4').displayName).toBe('Lookup Copy')
            expect(result.valid).toBe(true)
        })

        it('chains multiple pasted actions after the target and remaps their references', () => {
            const flowVersion = chainFlow()
            const actions = flowOperations.getActionsForCopy(['step_1', 'step_2'], flowVersion)

            const { operations, result } = paste(flowVersion, actions, {
                parentStepName: 'step_3',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
            })

            expect(summarize(operations)).toEqual([
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_4',
                    parentStep: 'step_3',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_5',
                    parentStep: 'step_4',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
            ])
            expect(nextActionName(result, 'step_3')).toBe('step_4')
            expect(nextActionName(result, 'step_4')).toBe('step_5')
            expect(nextActionName(result, 'step_5')).toBeUndefined()

            const pastedPiece = getAction(result, 'step_5') as PieceAction
            expect(pastedPiece.settings.input.key).toBe("{{ step_4['output'].id }}")
            expect(pastedPiece.settings.input.auth).toBe("{{connections['store_connection']}}")
            expect(pastedPiece.settings.input.label).toBe('step_1')

            const originalPiece = getAction(result, 'step_2') as PieceAction
            expect(originalPiece.settings.input.key).toBe("{{ step_1['output'].id }}")
        })

        it('pastes a router with its branch children in their original branch slots', () => {
            const flowVersion = routerFlow()
            const actions = flowOperations.getActionsForCopy(['step_2'], flowVersion)

            const { operations, result } = paste(flowVersion, actions, {
                parentStepName: 'step_6',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
            })

            expect(summarize(operations)).toEqual([
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_7',
                    parentStep: 'step_6',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_8',
                    parentStep: 'step_7',
                    location: StepLocationRelativeToParent.INSIDE_BRANCH,
                    branchIndex: 0,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_9',
                    parentStep: 'step_8',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_10',
                    parentStep: 'step_7',
                    location: StepLocationRelativeToParent.INSIDE_BRANCH,
                    branchIndex: 2,
                },
            ])

            expect(nextActionName(result, 'step_6')).toBe('step_7')
            const pastedRouter = getAction(result, 'step_7') as RouterAction
            expect(pastedRouter.children.map(child => child?.name ?? null)).toEqual(['step_8', null, 'step_10'])
            expect((pastedRouter.children[0] as FlowAction).nextAction?.name).toBe('step_9')
            expect(pastedRouter.settings.branches.map(branch => branch.branchName)).toEqual(['Branch 1', 'Branch 2', 'Otherwise'])
            expect(pastedRouter.settings.branches.map(branch => branch.branchType)).toEqual([
                BranchExecutionType.CONDITION,
                BranchExecutionType.CONDITION,
                BranchExecutionType.FALLBACK,
            ])

            const firstBranch = pastedRouter.settings.branches[0]
            if (firstBranch.branchType !== BranchExecutionType.CONDITION) {
                throw new Error('expected a condition branch')
            }
            expect(firstBranch.conditions[0][0].firstValue).toBe("{{ step_1['output'].value }}")

            const pastedBranchThreeHead = pastedRouter.children[2] as PieceAction
            expect(pastedBranchThreeHead.settings.input.key).toBe("{{ step_8['output'].id }}")
            expect(pastedBranchThreeHead.settings.input.auth).toBe("{{connections['store_connection']}}")
            expect(result.valid).toBe(true)
        })

        it('pastes a loop together with the steps inside it', () => {
            const flowVersion = loopFlow()
            const actions = flowOperations.getActionsForCopy(['step_1'], flowVersion)

            const { operations, result } = paste(flowVersion, actions, {
                parentStepName: 'step_4',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
            })

            expect(summarize(operations)).toEqual([
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_5',
                    parentStep: 'step_4',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_6',
                    parentStep: 'step_5',
                    location: StepLocationRelativeToParent.INSIDE_LOOP,
                    branchIndex: undefined,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_7',
                    parentStep: 'step_6',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
            ])

            expect(nextActionName(result, 'step_4')).toBe('step_5')
            const pastedLoop = getAction(result, 'step_5') as LoopOnItemsAction
            expect(pastedLoop.firstLoopAction?.name).toBe('step_6')
            expect(pastedLoop.firstLoopAction?.nextAction?.name).toBe('step_7')
            expect(pastedLoop.settings.items).toBe("{{ trigger['output'].items }}")

            const pastedTail = pastedLoop.firstLoopAction?.nextAction as PieceAction
            expect(pastedTail.settings.input.key).toBe("{{ step_6['output'].id }}")
            expect(pastedTail.settings.input.auth).toBe("{{connections['store_connection']}}")
            expect(result.valid).toBe(true)
        })

        it('pastes into a loop as the first loop action', () => {
            const flowVersion = loopFlow()
            const actions = flowOperations.getActionsForCopy(['step_4'], flowVersion)

            const { operations, result } = paste(flowVersion, actions, {
                parentStepName: 'step_1',
                stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_LOOP,
            })

            expect(summarize(operations)).toEqual([
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_5',
                    parentStep: 'step_1',
                    location: StepLocationRelativeToParent.INSIDE_LOOP,
                    branchIndex: undefined,
                },
            ])
            const loop = getAction(result, 'step_1') as LoopOnItemsAction
            expect(loop.firstLoopAction?.name).toBe('step_5')
            expect(loop.firstLoopAction?.nextAction?.name).toBe('step_2')
        })

        it('pastes into the requested router branch only', () => {
            const flowVersion = routerFlow()
            const actions = flowOperations.getActionsForCopy(['step_6'], flowVersion)

            const { operations, result } = paste(flowVersion, actions, {
                parentStepName: 'step_2',
                stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_BRANCH,
                branchIndex: 1,
            })

            expect(summarize(operations)).toEqual([
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_7',
                    parentStep: 'step_2',
                    location: StepLocationRelativeToParent.INSIDE_BRANCH,
                    branchIndex: 1,
                },
            ])
            const router = getAction(result, 'step_2') as RouterAction
            expect(router.children.map(child => child?.name ?? null)).toEqual(['step_3', 'step_7', 'step_5'])
        })

        it('gives every paste of the same clipboard a fresh set of names', () => {
            const flowVersion = chainFlow()
            const clipboard = JSON.parse(JSON.stringify(
                flowOperations.getActionsForCopy(['step_1', 'step_2'], flowVersion),
            )) as FlowAction[]

            const afterFirstPaste = paste(flowVersion, JSON.parse(JSON.stringify(clipboard)), {
                parentStepName: 'step_3',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
            }).result
            const afterSecondPaste = paste(afterFirstPaste, JSON.parse(JSON.stringify(clipboard)), {
                parentStepName: 'step_3',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
            }).result

            const names = flowStructureUtil.getAllSteps(afterSecondPaste.trigger).map(step => step.name)
            expect(new Set(names).size).toBe(names.length)
            expect(names).toHaveLength(8)

            expect(nextActionName(afterSecondPaste, 'step_3')).toBe('step_6')
            expect(nextActionName(afterSecondPaste, 'step_6')).toBe('step_7')
            expect(nextActionName(afterSecondPaste, 'step_7')).toBe('step_4')
            expect(nextActionName(afterSecondPaste, 'step_4')).toBe('step_5')

            const firstPastePiece = getAction(afterSecondPaste, 'step_5') as PieceAction
            const secondPastePiece = getAction(afterSecondPaste, 'step_7') as PieceAction
            expect(firstPastePiece.settings.input.key).toBe("{{ step_4['output'].id }}")
            expect(secondPastePiece.settings.input.key).toBe("{{ step_6['output'].id }}")
        })

        it('returns no operations when the clipboard is empty', () => {
            const operations = flowOperations.getOperationsForPaste([], chainFlow(), {
                parentStepName: 'step_1',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
            })

            expect(operations).toEqual([])
        })

        // DEFECT: pasting to a missing parent silently produces operations that no-op
        // when applied — the copied steps vanish without any error, and the builder
        // shows no "No Steps Pasted" toast because the operation list is not empty.
        // Failing evidence kept; the fix is handled separately from these tests.
        it('rejects a paste location whose parent step does not exist', () => {
            const flowVersion = chainFlow()
            const actions = flowOperations.getActionsForCopy(['step_1'], flowVersion)

            expect(() => paste(flowVersion, actions, {
                parentStepName: 'missing_step',
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
            })).toThrow()
        })

        // DEFECT: an out-of-range branchIndex is not rejected — the router ends up with
        // more children than branches (children.length 8 vs 3 branches), corrupting the
        // flow. Failing evidence kept; the fix is handled separately from these tests.
        it('rejects a branch index outside the router branches', () => {
            const flowVersion = routerFlow()
            const actions = flowOperations.getActionsForCopy(['step_6'], flowVersion)

            expect(() => paste(flowVersion, actions, {
                parentStepName: 'step_2',
                stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_BRANCH,
                branchIndex: 7,
            })).toThrow()
        })
    })

    describe('move (MOVE_ACTION)', () => {
        it('moves a step after another step and re-links the chain', () => {
            const flowVersion = chainFlow()
            const request = {
                name: 'step_2',
                newParentStep: 'step_3',
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
            }

            const operations = _moveAction(flowVersion, request)
            expect(summarize(operations)).toEqual([
                {
                    type: FlowOperationType.DELETE_ACTION,
                    names: ['step_2'],
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_2',
                    parentStep: 'step_3',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
            ])

            const result = flowOperations.apply(flowVersion, {
                type: FlowOperationType.MOVE_ACTION,
                request,
            })
            expect(nextActionName(result, 'step_1')).toBe('step_3')
            expect(nextActionName(result, 'step_3')).toBe('step_2')
            expect(nextActionName(result, 'step_2')).toBeUndefined()

            const movedPiece = getAction(result, 'step_2') as PieceAction
            expect(movedPiece.displayName).toBe('Save')
            expect(movedPiece.settings.input.key).toBe("{{ step_1['output'].id }}")
            expect(movedPiece.settings.input.auth).toBe("{{connections['store_connection']}}")
            expect(result.valid).toBe(true)
        })

        it('moves a router with its branch children and keeps branch order', () => {
            const flowVersion = routerFlow()
            const request = {
                name: 'step_2',
                newParentStep: 'step_6',
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
            }

            const operations = _moveAction(flowVersion, request)
            expect(summarize(operations)).toEqual([
                {
                    type: FlowOperationType.DELETE_ACTION,
                    names: ['step_2'],
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_2',
                    parentStep: 'step_6',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_3',
                    parentStep: 'step_2',
                    location: StepLocationRelativeToParent.INSIDE_BRANCH,
                    branchIndex: 0,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_4',
                    parentStep: 'step_3',
                    location: StepLocationRelativeToParent.AFTER,
                    branchIndex: undefined,
                },
                {
                    type: FlowOperationType.ADD_ACTION,
                    name: 'step_5',
                    parentStep: 'step_2',
                    location: StepLocationRelativeToParent.INSIDE_BRANCH,
                    branchIndex: 2,
                },
            ])

            const result = flowOperations.apply(flowVersion, {
                type: FlowOperationType.MOVE_ACTION,
                request,
            })
            expect(nextActionName(result, 'step_1')).toBe('step_6')
            expect(nextActionName(result, 'step_6')).toBe('step_2')
            expect(nextActionName(result, 'step_2')).toBeUndefined()

            const movedRouter = getAction(result, 'step_2') as RouterAction
            expect(movedRouter.children.map(child => child?.name ?? null)).toEqual(['step_3', null, 'step_5'])
            expect((movedRouter.children[0] as FlowAction).nextAction?.name).toBe('step_4')
            expect(movedRouter.settings.branches.map(branch => branch.branchName)).toEqual(['Branch 1', 'Branch 2', 'Otherwise'])

            const movedBranchThreeHead = movedRouter.children[2] as PieceAction
            expect(movedBranchThreeHead.settings.input.key).toBe("{{ step_3['output'].id }}")
            expect(result.valid).toBe(true)
        })

        it('moves a loop with the steps inside it', () => {
            const flowVersion = loopFlow()

            const result = flowOperations.apply(flowVersion, {
                type: FlowOperationType.MOVE_ACTION,
                request: {
                    name: 'step_1',
                    newParentStep: 'step_4',
                    stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
                },
            })

            expect(nextActionName(result, 'trigger')).toBe('step_4')
            expect(nextActionName(result, 'step_4')).toBe('step_1')
            const movedLoop = getAction(result, 'step_1') as LoopOnItemsAction
            expect(movedLoop.nextAction).toBeUndefined()
            expect(movedLoop.firstLoopAction?.name).toBe('step_2')
            expect(movedLoop.firstLoopAction?.nextAction?.name).toBe('step_3')
            expect(movedLoop.settings.items).toBe("{{ trigger['output'].items }}")
            expect(result.valid).toBe(true)
        })

        it('moves a step into a loop as the first loop action', () => {
            const flowVersion = loopFlow()

            const result = flowOperations.apply(flowVersion, {
                type: FlowOperationType.MOVE_ACTION,
                request: {
                    name: 'step_4',
                    newParentStep: 'step_1',
                    stepLocationRelativeToNewParent: StepLocationRelativeToParent.INSIDE_LOOP,
                },
            })

            const loop = getAction(result, 'step_1') as LoopOnItemsAction
            expect(loop.firstLoopAction?.name).toBe('step_4')
            expect(loop.firstLoopAction?.nextAction?.name).toBe('step_2')
            expect(loop.nextAction).toBeUndefined()
            expect(flowStructureUtil.getAllSteps(result.trigger).map(step => step.name)).toEqual([
                'trigger',
                'step_1',
                'step_4',
                'step_2',
                'step_3',
            ])
        })

        it('moves a step into a router branch', () => {
            const flowVersion = routerFlow()

            const result = flowOperations.apply(flowVersion, {
                type: FlowOperationType.MOVE_ACTION,
                request: {
                    name: 'step_6',
                    newParentStep: 'step_2',
                    stepLocationRelativeToNewParent: StepLocationRelativeToParent.INSIDE_BRANCH,
                    branchIndex: 1,
                },
            })

            const router = getAction(result, 'step_2') as RouterAction
            expect(router.children.map(child => child?.name ?? null)).toEqual(['step_3', 'step_6', 'step_5'])
            expect(router.nextAction).toBeUndefined()
            expect(flowStructureUtil.getAllSteps(result.trigger).map(step => step.name)).toEqual([
                'trigger',
                'step_1',
                'step_2',
                'step_3',
                'step_4',
                'step_6',
                'step_5',
            ])
        })

        it('rejects a move to a parent step that does not exist', () => {
            expect(() => flowOperations.apply(chainFlow(), {
                type: FlowOperationType.MOVE_ACTION,
                request: {
                    name: 'step_1',
                    newParentStep: 'missing_step',
                    stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
                },
            })).toThrow('ENTITY_NOT_FOUND')
        })

        it('rejects moving a step that does not exist', () => {
            expect(() => flowOperations.apply(chainFlow(), {
                type: FlowOperationType.MOVE_ACTION,
                request: {
                    name: 'missing_step',
                    newParentStep: 'step_1',
                    stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
                },
            })).toThrow('ENTITY_NOT_FOUND')
        })

        // DEFECT: moving a step relative to itself deletes it from the flow — the delete
        // succeeds and the re-add finds no parent, so it no-ops. Failing evidence kept;
        // the fix is handled separately from these tests.
        it('rejects moving a step relative to itself', () => {
            expect(() => flowOperations.apply(chainFlow(), {
                type: FlowOperationType.MOVE_ACTION,
                request: {
                    name: 'step_1',
                    newParentStep: 'step_1',
                    stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
                },
            })).toThrow()
        })

        // DEFECT: moving a router into its own branch deletes the router and its whole
        // subtree from the flow instead of rejecting the move. Failing evidence kept;
        // the fix is handled separately from these tests.
        it('rejects moving a router into its own branch', () => {
            expect(() => flowOperations.apply(routerFlow(), {
                type: FlowOperationType.MOVE_ACTION,
                request: {
                    name: 'step_2',
                    newParentStep: 'step_3',
                    stepLocationRelativeToNewParent: StepLocationRelativeToParent.AFTER,
                },
            })).toThrow()
        })
    })
})
