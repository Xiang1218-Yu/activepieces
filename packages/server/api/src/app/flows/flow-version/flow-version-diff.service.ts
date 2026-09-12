import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import {
    FlowVersionDiff,
    FlowVersionDiffRequest,
    flowVersionDiffUtil,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowVersionService } from './flow-version.service'

export const flowVersionDiffService = (log: FastifyBaseLogger) => ({
    async getDiff({
        flowId,
        request,
    }: {
        flowId: string
        request: FlowVersionDiffRequest
    }): Promise<FlowVersionDiff> {
        const [fromVersion, toVersion] = await Promise.all([
            flowVersionService(log).getFlowVersionOrThrow({
                flowId,
                versionId: request.fromVersionId,
            }),
            flowVersionService(log).getFlowVersionOrThrow({
                flowId,
                versionId: request.toVersionId,
            }),
        ])

        if (
            fromVersion.flowId !== flowId ||
            toVersion.flowId !== flowId ||
            fromVersion.flowId !== toVersion.flowId
        ) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: 'flowVersionDiff_crossFlow',
                },
            })
        }

        return flowVersionDiffUtil.diffFlowVersions({
            fromVersion,
            toVersion,
        })
    },
})
