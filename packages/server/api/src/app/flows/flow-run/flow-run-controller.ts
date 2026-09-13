import { ActivepiecesError, ApId, ErrorCode, isNil, omit, Permission, SeekPage } from '@activepieces/core-utils'
import { ApEdition, BulkActionOnRunsRequestBody, BulkArchiveActionOnRunsRequestBody, BulkCancelFlowRequestBody, CompareFlowRunsRequestQuery, CompareFlowRunsResponse, CountFlowRunsByStatusRequest, CountFlowRunsByStatusResponse, FailureRateAggregationRequestQuery, FailureRateAggregationResponse, FlowRun, ListFlowRunsRequestQuery, MAX_COMPARED_RUNS, PlatformRole, PrincipalType, RetryFlowRequestBody, RunEnvironment, RunInternalErrorSource, SERVICE_KEY_SECURITY_OPENAPI } from '@activepieces/shared'
import { FastifyRequest } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../../core/security/authorization/common'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { system } from '../../helper/system/system'
import { userService } from '../../user/user-service'
import { FlowRunEntity } from './flow-run-entity'
import { flowRunComparisonService } from './flow-run-comparison-service'
import { flowRunService } from './flow-run-service'

const DEFAULT_PAGING_LIMIT = 10

export const flowRunController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListRequest, async (request) => {
        return flowRunService(request.log).list({
            projectId: request.query.projectId,
            flowId: request.query.flowId,
            tags: request.query.tags,
            status: request.query.status,
            failedStepName: request.query.failedStepName,
            failedStepMessage: request.query.failedStepMessage,
            cursor: request.query.cursor ?? null,
            limit: Number(request.query.limit ?? DEFAULT_PAGING_LIMIT),
            createdAfter: request.query.createdAfter,
            createdBefore: request.query.createdBefore,
            flowRunIds: request.query.flowRunIds,
            includeArchived: request.query.includeArchived,
            environment: RunEnvironment.PRODUCTION,
        })
    })

    app.get('/count-by-status', CountByStatusRouteConfig, async (request) => {
        const data = await flowRunService(request.log).countByStatus({
            projectId: request.query.projectId,
            createdAfter: request.query.createdAfter,
            createdBefore: request.query.createdBefore,
        })
        return { data }
    })

    app.get('/compare', CompareRequest, async (request) => {
        const flowRunIds = request.query.flowRunIds ?? []
        if (flowRunIds.length === 0 || flowRunIds.length > MAX_COMPARED_RUNS) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'Select between 1 and 10 runs to compare' },
            })
        }
        return flowRunComparisonService(request.log).compare({
            projectId: request.projectId,
            flowRunIds,
        })
    })

    app.get('/failure-rate', FailureRateRouteConfig, async (request) => {
        return flowRunComparisonService(request.log).aggregateFailureRate(request.query)
    })

    app.get(
        '/:id',
        GetRequest,
        async (request, reply) => {
            const flowRun = await flowRunService(request.log).getOnePopulatedOrThrow({
                projectId: request.projectId,
                id: request.params.id,
            })
            const internalErrorEnabled = flowRun.internalError?.source === RunInternalErrorSource.ENGINE || system.getEdition() !== ApEdition.CLOUD
            const canViewInternalError = internalErrorEnabled && await isRequesterPlatformAdmin(request)
            await reply.send(canViewInternalError ? flowRun : omit(flowRun, ['internalError']))
        },
    )

    app.post('/:id/retry', RetryFlowRequest, async (req) => {
        const flowRun = await flowRunService(req.log).retry({
            flowRunId: req.params.id,
            strategy: req.body.strategy,
            projectId: req.body.projectId,
        })

        if (isNil(flowRun)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'flow_run',
                    entityId: req.params.id,
                    message: 'Flow run not found',
                },
            })
        }
        return flowRun
    })

    app.post('/cancel', BulkCancelFlowRequest, async (req) => {
        return flowRunService(req.log).cancel({
            projectId: req.projectId,
            platformId: req.principal.platform.id,
            flowRunIds: req.body.flowRunIds,
            excludeFlowRunIds: req.body.excludeFlowRunIds,
            status: req.body.status,
            flowId: req.body.flowId,
            createdAfter: req.body.createdAfter,
            createdBefore: req.body.createdBefore,
        })
    })

    app.post('/retry', BulkRetryFlowRequest, async (req) => {
        return flowRunService(req.log).bulkRetry({
            projectId: req.projectId,
            flowRunIds: req.body.flowRunIds,
            excludeFlowRunIds: req.body.excludeFlowRunIds,
            strategy: req.body.strategy,
            status: req.body.status,
            flowId: req.body.flowId,
            createdAfter: req.body.createdAfter,
            createdBefore: req.body.createdBefore,
            failedStepName: req.body.failedStepName,
            failedStepMessage: req.body.failedStepMessage,
        })
    })

    app.post('/archive', ArchiveFlowRunRequest, async (req) => {
        return flowRunService(req.log).bulkArchive({
            projectId: req.projectId,
            flowRunIds: req.body.flowRunIds,
            excludeFlowRunIds: req.body.excludeFlowRunIds,
            status: req.body.status,
            flowId: req.body.flowId,
            createdAfter: req.body.createdAfter,
            createdBefore: req.body.createdBefore,
            failedStepName: req.body.failedStepName,
            failedStepMessage: req.body.failedStepMessage,
        })
    })

}

async function isRequesterPlatformAdmin(request: FastifyRequest): Promise<boolean> {
    if (request.principal.type !== PrincipalType.USER) {
        return false
    }
    const user = await userService(request.log).getOneOrFail({ id: request.principal.id })
    return user.platformRole === PlatformRole.ADMIN
}

const FlowRunFilteredWithNoSteps = FlowRun.omit({ steps: true })

const ListRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE], 
            Permission.READ_RUN, {
                type: ProjectResourceType.QUERY,
            }),
    },
    schema: {
        tags: ['flow-runs'],
        description: 'List Flow Runs',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: ListFlowRunsRequestQuery,
        response: {
            [StatusCodes.OK]: SeekPage(FlowRunFilteredWithNoSteps),
        },
    },
}

const GetRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE], 
            Permission.READ_RUN, {
                type: ProjectResourceType.TABLE,
                tableName: FlowRunEntity,
            }),
    },
    schema: {
        tags: ['flow-runs'],
        description: 'Get Flow Run',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.OK]: FlowRun,
        },
    },
}

const RetryFlowRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE], 
            Permission.WRITE_RUN, {
                type: ProjectResourceType.TABLE,
                tableName: FlowRunEntity,
            }),
    },
    schema: {
        params: z.object({
            id: ApId,
        }),
        body: RetryFlowRequestBody,
    },
}

const BulkCancelFlowRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE], 
            Permission.WRITE_RUN, {
                type: ProjectResourceType.BODY,
            }),
    },
    schema: {
        tags: ['flow-runs'],
        description: 'Cancel multiple paused/queued flow runs',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        body: BulkCancelFlowRequestBody,
    },
}

const ArchiveFlowRunRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE], 
            Permission.WRITE_RUN, {
                type: ProjectResourceType.BODY,
            }),
    },
    schema: {
        body: BulkArchiveActionOnRunsRequestBody,
    },
}

const CountByStatusRouteConfig = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_RUN, {
                type: ProjectResourceType.QUERY,
            }),
    },
    schema: {
        tags: ['flow-runs'],
        description: 'Count Flow Runs by Status',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: CountFlowRunsByStatusRequest,
        response: {
            [StatusCodes.OK]: CountFlowRunsByStatusResponse,
        },
    },
}

const CompareRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_RUN, {
                type: ProjectResourceType.QUERY,
            }),
    },
    schema: {
        tags: ['flow-runs'],
        description: 'Compare multiple Flow Runs aligned by trigger, step duration, output and error category',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: CompareFlowRunsRequestQuery,
        response: {
            [StatusCodes.OK]: CompareFlowRunsResponse,
        },
    },
}

const FailureRateRouteConfig = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_RUN, {
                type: ProjectResourceType.QUERY,
            }),
    },
    schema: {
        tags: ['flow-runs'],
        description: 'Aggregate failure rate of Flow Runs into time buckets (cursor paginated)',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: FailureRateAggregationRequestQuery,
        response: {
            [StatusCodes.OK]: FailureRateAggregationResponse,
        },
    },
}

const BulkRetryFlowRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.WRITE_RUN, {
                type: ProjectResourceType.BODY,
            }),
    },
    schema: {
        body: BulkActionOnRunsRequestBody,
    },
}


