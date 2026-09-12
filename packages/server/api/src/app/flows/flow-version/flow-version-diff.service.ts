import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import {
    FlowId,
    FlowVersionDiff,
    FlowVersionDiffRequest,
    flowVersionDiffUtil,
    ProjectId,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowVersionService } from './flow-version.service'

const CROSS_FLOW_MESSAGE = 'flowVersionDiff_crossFlow'
const VERSION_NOT_FOUND_MESSAGE = 'flowVersionDiff_versionNotFound'

export const flowVersionDiffService = (log: FastifyBaseLogger) => ({
    async getDiff({
        flowId,
        projectId,
        request,
    }: GetDiffParams): Promise<FlowVersionDiff> {
        const [fromFlowId, toFlowId] = await Promise.all([
            flowVersionService(log).getFlowIdForVersion({
                versionId: request.fromVersionId,
                projectId,
            }),
            flowVersionService(log).getFlowIdForVersion({
                versionId: request.toVersionId,
                projectId,
            }),
        ])

        if (fromFlowId === null || toFlowId === null) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'FlowVersion',
                    entityId: fromFlowId === null ? request.fromVersionId : request.toVersionId,
                    message: VERSION_NOT_FOUND_MESSAGE,
                },
            })
        }

        if (fromFlowId !== flowId || toFlowId !== flowId) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: CROSS_FLOW_MESSAGE,
                },
            })
        }

        const [fromVersion, toVersion] = await Promise.all([
            flowVersionService(log).getFlowVersionOrThrow({
                flowId,
                versionId: request.fromVersionId,
                projectId,
            }),
            flowVersionService(log).getFlowVersionOrThrow({
                flowId,
                versionId: request.toVersionId,
                projectId,
            }),
        ])

        return flowVersionDiffUtil.diffFlowVersions({
            fromVersion,
            toVersion,
        })
    },
})

type GetDiffParams = {
    flowId: FlowId
    projectId: ProjectId
    request: FlowVersionDiffRequest
}
