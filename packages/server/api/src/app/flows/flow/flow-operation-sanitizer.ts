import { FlowOperationRequest, FlowOperationType, flowStructureUtil } from '@activepieces/shared'

export const flowOperationSanitizer = {
    sanitizeForExternalRequest(operation: FlowOperationRequest): FlowOperationRequest {
        if (operation.type !== FlowOperationType.IMPORT_FLOW) {
            return operation
        }
        const sanitizedTrigger = flowStructureUtil.transferStep(operation.request.trigger, (step) => ({
            ...step,
            settings: {
                ...step.settings,
                sampleData: undefined,
            },
        }))
        if (!flowStructureUtil.isTrigger(sanitizedTrigger.type)) {
            return operation
        }
        return {
            ...operation,
            request: {
                ...operation.request,
                trigger: sanitizedTrigger,
            },
        }
    },
}
