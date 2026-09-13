import { isNil } from '@activepieces/core-utils'
import { FlowActionType, RouterAction } from '../actions/action'
import { FlowVersion } from '../flow-version'
import { flowStructureUtil } from '../util/flow-structure-util'
import { DeleteBranchRequest } from '.'
import { notesOperations } from './notes-operations'

function _deleteBranch(flowVersion: FlowVersion, request: DeleteBranchRequest): FlowVersion {
    const removedStepNames = getBranchChildStepNames(flowVersion, request)
    const newFlowVersion = flowStructureUtil.transferFlow(flowVersion, (parentStep) => {
        if (parentStep.name !== request.stepName || parentStep.type !== FlowActionType.ROUTER) {
            return parentStep
        }
        const routerAction = parentStep as RouterAction
        return {
            ...routerAction,
            settings: {
                ...routerAction.settings,
                branches: routerAction.settings.branches.filter((_, index) => index !== request.branchIndex),
            },
            children: routerAction.children.filter((_, index) => index !== request.branchIndex),
        }
    })
    return notesOperations.detachNotesFromSteps(newFlowVersion, removedStepNames)
}

function getBranchChildStepNames(flowVersion: FlowVersion, request: DeleteBranchRequest): string[] {
    const router = flowStructureUtil.getStep(request.stepName, flowVersion.trigger)
    if (isNil(router) || router.type !== FlowActionType.ROUTER) {
        return []
    }
    const branchChild = (router as RouterAction).children[request.branchIndex]
    if (isNil(branchChild)) {
        return []
    }
    return flowStructureUtil.getAllSteps(branchChild).map((step) => step.name)
}

export { _deleteBranch }
