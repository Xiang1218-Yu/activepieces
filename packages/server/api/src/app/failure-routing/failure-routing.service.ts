import { apId, Cursor, isNil, SeekPage, tryCatch } from '@activepieces/core-utils'
import {
    ApplicationEventName,
    CreateFailureRoutingRuleRequestBody,
    FailureCategory,
    FailureDelivery,
    FailureDeliveryStatus,
    FailureRoutingRule,
    FailureRoutingTargetType,
    FlowRunFinishedEvent,
    FlowRunStatus,
    LATEST_JOB_DATA_SCHEMA_VERSION,
    ListFailureDeliveriesRequest,
    UpdateFailureRoutingRuleRequestBody,
    WorkerJobType,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { redisConnections } from '../database/redis-connections'
import { emailService } from '../ee/helper/email/email-service'
import { flowVersionService } from '../flows/flow-version/flow-version.service'
import { domainHelper } from '../helper/domain-helper'
import { buildPaginator } from '../helper/pagination/build-paginator'
import { Order } from '../helper/pagination/paginator'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { rejectedPromiseHandler } from '../helper/promise-handler'
import { projectService } from '../project/project-service'
import { jobQueue, JobType } from '../workers/job-queue/job-queue'
import {
    FailureDeliveryEntity,
    FailureDeliverySchema,
    FailureRoutingRuleEntity,
    FailureRoutingRuleSchema,
} from './failure-routing.entity'
import { categorizeRunStatus, matchesFailureRule } from './rule-matcher'

const ruleRepo = repoFactory<FailureRoutingRuleSchema>(FailureRoutingRuleEntity)
const deliveryRepo = repoFactory<FailureDeliverySchema>(FailureDeliveryEntity)

const RETRY_TTL_IN_SECONDS = 90 * 24 * 60 * 60
const DEDUP_TTL_IN_SECONDS = 24 * 60 * 60
const MAX_TRANSPORT_ERROR_LENGTH = 1000

const retryCountKey = (flowRunId: string) => `failure_routing:retry_count:${flowRunId}`
const dedupKey = (flowRunId: string, ruleId: string) => `failure_routing:dedup:${flowRunId}:${ruleId}`

// Increments the per-run attempt counter. Redis failures degrade to "first attempt"
// semantics; the rule filter still works correctly for minRetryCount = 0.
const readRetryCount = async ({ log, flowRunId }: { log: FastifyBaseLogger, flowRunId: string }): Promise<number> => {
    const { data: count, error } = await tryCatch(async () => {
        const redis = await redisConnections.useExisting()
        const key = retryCountKey(flowRunId)
        const value = await redis.incr(key)
        await redis.expire(key, RETRY_TTL_IN_SECONDS)
        return Math.max(0, value - 1)
    })
    if (error) {
        log.warn({ error: error.message, flowRun: { id: flowRunId } }, '[failureRouting] retry counter unavailable, treating as first attempt')
        return 0
    }
    return count
}

const acquireDedupClaim = async ({ log, flowRunId, ruleId }: { log: FastifyBaseLogger, flowRunId: string, ruleId: string }): Promise<boolean> => {
    const { data: claimed, error } = await tryCatch(async () => {
        const redis = await redisConnections.useExisting()
        const result = await redis.set(dedupKey(flowRunId, ruleId), '1', 'EX', DEDUP_TTL_IN_SECONDS, 'NX')
        return result === 'OK'
    })
    if (error) {
        // Let the insert go through; the unique (flowRunId, ruleId) index is authoritative.
        log.warn({ error: error.message }, '[failureRouting] dedup claim unavailable, relying on database uniqueness')
        return true
    }
    return claimed
}

export const failureRoutingService = (log: FastifyBaseLogger) => ({
    async handleRunFinished(event: FlowRunFinishedEvent): Promise<void> {
        try {
            await handleRunFinishedUnsafe({ log, event })
        }
        catch (error) {
            // Failure routing must never block or fail a flow run; everything is
            // observable through the failure_delivery table instead.
            log.error({ error, action: event.action }, '[failureRouting] unexpected error while handling run event')
        }
    },

    async createRule({ projectId, platformId, request }: CreateRuleParams): Promise<FailureRoutingRule> {
        const rule: FailureRoutingRuleSchema = {
            id: apId(),
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            platformId,
            projectId,
            displayName: request.displayName,
            enabled: request.enabled,
            priority: request.priority,
            stopOnMatch: request.stopOnMatch,
            filter: request.filter,
            target: request.target,
            lastDelivery: null,
        }
        return ruleRepo().save(rule)
    },

    async updateRule({ id, projectId, request }: UpdateRuleParams): Promise<FailureRoutingRule | null> {
        await ruleRepo().update({ id, projectId }, request)
        return ruleRepo().findOneBy({ id, projectId })
    },

    async deleteRule({ id, projectId }: DeleteRuleParams): Promise<void> {
        await ruleRepo().delete({ id, projectId })
    },

    async listRules({ projectId, cursorRequest, limit }: ListRulesParams): Promise<SeekPage<FailureRoutingRule>> {
        const decodedCursor = paginationHelper.decodeCursor(cursorRequest)
        const paginator = buildPaginator({
            entity: FailureRoutingRuleEntity,
            query: {
                limit,
                order: 'ASC',
                orderBy: [
                    { field: 'priority', order: Order.ASC },
                    { field: 'created', order: Order.ASC },
                ],
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        const queryBuilder = ruleRepo()
            .createQueryBuilder('failure_routing_rule')
            .where({ projectId })
        const { data, cursor } = await paginator.paginate(queryBuilder)
        return paginationHelper.createPage<FailureRoutingRule>(data, cursor)
    },

    async listDeliveries(params: ListFailureDeliveriesRequest): Promise<SeekPage<FailureDelivery>> {
        const decodedCursor = paginationHelper.decodeCursor(params.cursor ?? null)
        const paginator = buildPaginator({
            entity: FailureDeliveryEntity,
            query: {
                limit: params.limit ?? 20,
                order: 'DESC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        const queryBuilder = deliveryRepo()
            .createQueryBuilder('failure_delivery')
            .where({ projectId: params.projectId })
        if (params.ruleId) {
            queryBuilder.andWhere({ ruleId: params.ruleId })
        }
        if (params.flowRunId) {
            queryBuilder.andWhere({ flowRunId: params.flowRunId })
        }
        if (params.status) {
            queryBuilder.andWhere({ status: params.status })
        }
        const { data, cursor } = await paginator.paginate(queryBuilder)
        return paginationHelper.createPage<FailureDelivery>(data, cursor)
    },

    // Called by the worker over RPC after the webhook transport finishes.
    async reportDeliveryResult({ deliveryId, platformId, success, httpStatus, errorMessage }: ReportResultParams): Promise<void> {
        const delivery = await deliveryRepo().findOneBy({ id: deliveryId, platformId })
        if (isNil(delivery)) {
            return
        }
        const status = success ? FailureDeliveryStatus.SUCCEEDED : FailureDeliveryStatus.FAILED
        const reportedError = success ? null : truncateError(buildTransportError(httpStatus, errorMessage))
        const now = new Date().toISOString()
        await deliveryRepo().increment({ id: deliveryId }, 'attempts', 1)
        await deliveryRepo().update({ id: deliveryId }, {
            status,
            errorMessage: reportedError,
            deliveredAt: success ? now : null,
        })
        await snapshotLastDelivery(delivery.ruleId, deliveryId, status, reportedError, now)
    },
})

const handleRunFinishedUnsafe = async ({ log, event }: HandleRunFinishedParams): Promise<void> => {
    if (event.action !== ApplicationEventName.FLOW_RUN_FINISHED) {
        return
    }
    const flowRun = event.data.flowRun
    const category = categorizeRunStatus(flowRun.status as FlowRunStatus)
    if (isNil(category) || isNil(event.projectId)) {
        return
    }

    // The counter tracks how many times this run has been reported as finished
    // (first failure = 0, each retried failure increments). It is computed once
    // even if no rule matches the retry range.
    const retryCount = await readRetryCount({ log, flowRunId: flowRun.id })

    const rules = await ruleRepo().find({
        where: { projectId: event.projectId, enabled: true },
        order: { priority: 'ASC', created: 'ASC' },
    })

    // Display names are resolved once for all rules. This never reads
    // connections, step outputs or error messages.
    const displayInfo = await resolveDisplayInfo({ log, event })

    for (const rule of rules) {
        if (!matchesFailureRule(rule.filter, { flowId: flowRun.flowId, category, retryCount })) {
            continue
        }
        rejectedPromiseHandler(
            routeToRule({ log, rule, event, category, retryCount, displayInfo }),
            log,
        )
        if (rule.stopOnMatch) {
            break
        }
    }
}

const resolveDisplayInfo = async ({ log, event }: { log: FastifyBaseLogger, event: FlowRunFinishedEvent }): Promise<DisplayInfo> => {
    const [flowVersion, project] = await Promise.all([
        flowVersionService(log).getOne(event.data.flowRun.flowVersionId),
        projectService(log).getOne(event.projectId!),
    ])
    return {
        flowDisplayName: flowVersion?.displayName ?? event.data.flowRun.flowDisplayName,
        projectDisplayName: project?.displayName ?? event.projectId!,
    }
}

const routeToRule = async ({ log, rule, event, category, retryCount, displayInfo }: RouteToRuleParams): Promise<void> => {
    const flowRun = event.data.flowRun

    // Redis is only the fast-path dedup; the unique index on (flowRunId, ruleId)
    // is the durable guarantee, so an unavailable Redis must not stop routing.
    const claimed = await acquireDedupClaim({ log, flowRunId: flowRun.id, ruleId: rule.id })
    if (!claimed) {
        log.debug({ rule: { id: rule.id }, flowRun: { id: flowRun.id } }, '[failureRouting] duplicate run report skipped')
        return
    }

    const delivery: FailureDeliverySchema = {
        id: apId(),
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        platformId: rule.platformId,
        projectId: rule.projectId,
        ruleId: rule.id,
        flowRunId: flowRun.id,
        flowId: flowRun.flowId,
        retryCount,
        category,
        targetType: rule.target.type,
        status: FailureDeliveryStatus.PENDING,
        errorMessage: null,
        attempts: 0,
        deliveredAt: null,
    }

    try {
        await deliveryRepo().insert(delivery)
    }
    catch (error) {
        // Unique violation => a delivery already exists for this run/rule (duplicate report).
        if (isUniqueViolation(error)) {
            log.debug({ rule: { id: rule.id }, flowRun: { id: flowRun.id } }, '[failureRouting] duplicate delivery insert ignored')
            return
        }
        throw error
    }

    if (rule.target.type === FailureRoutingTargetType.EMAIL) {
        await deliverEmail({ log, rule, event, delivery, displayInfo })
        return
    }
    await deliverWebhook({ log, rule, event, delivery, displayInfo })
}

const deliverEmail = async ({ log, rule, event, delivery, displayInfo }: DeliverParams): Promise<void> => {
    const flowRun = event.data.flowRun
    const runUrl = await domainHelper.getInternalUrl({
        path: `projects/${rule.projectId}/runs/${flowRun.id}`,
    })
    const recipients = rule.target.type === FailureRoutingTargetType.EMAIL
        ? rule.target.emails
        : []
    const { data: sent, error } = await tryCatch(() => emailService(log).sendFailureRoutingNotification({
        platformId: rule.platformId,
        recipients,
        projectName: displayInfo.projectDisplayName,
        flowName: displayInfo.flowDisplayName ?? flowRun.flowId,
        runUrl,
        createdAt: flowRun.finishTime ?? flowRun.startTime ?? new Date().toISOString(),
        category: delivery.category,
        retryCount: delivery.retryCount,
    }))
    const failed = !isNil(error)
    // On editions without email support the sender reports "not sent" without throwing.
    const skipped = !failed && sent === false
    const status = failed
        ? FailureDeliveryStatus.FAILED
        : skipped
            ? FailureDeliveryStatus.SKIPPED
            : FailureDeliveryStatus.SUCCEEDED
    const errorMessage: string | null = failed
        ? truncateError(error!.message)
        : skipped
            ? 'Email delivery is not supported on this edition'
            : null
    await deliveryRepo().update({ id: delivery.id }, {
        status,
        attempts: 1,
        errorMessage,
        deliveredAt: !failed && !skipped ? new Date().toISOString() : null,
    })
    await snapshotLastDelivery(rule.id, delivery.id, status, errorMessage)
    if (failed) {
        log.error({ error: error!.message, delivery: { id: delivery.id }, rule: { id: rule.id } }, '[failureRouting] email delivery failed')
    }
}

const deliverWebhook = async ({ log, rule, event, delivery, displayInfo }: DeliverParams): Promise<void> => {
    // Reuse the existing event-destination worker job; only the delivery id is added
    // so the worker can report the transport outcome back to the API.
    // The payload is a redacted failure summary: no step outputs, error messages,
    // connections or other run context leaves the API.
    const { error } = await tryCatch(() => jobQueue(log).add({
        type: JobType.ONE_TIME,
        id: apId(),
        data: {
            schemaVersion: LATEST_JOB_DATA_SCHEMA_VERSION,
            platformId: rule.platformId,
            projectId: rule.projectId,
            webhookId: rule.id,
            webhookUrl: rule.target.type === FailureRoutingTargetType.EVENT_DESTINATION ? rule.target.url : '',
            payload: buildDeliveryPayload({ event, rule, delivery, displayInfo }),
            failureDeliveryId: delivery.id,
            jobType: WorkerJobType.EVENT_DESTINATION,
        },
    }))
    if (!isNil(error)) {
        const message = truncateError(error.message)
        await deliveryRepo().update({ id: delivery.id }, {
            status: FailureDeliveryStatus.FAILED,
            errorMessage: message,
        })
        await snapshotLastDelivery(rule.id, delivery.id, FailureDeliveryStatus.FAILED, message)
        log.error({ error: error.message, delivery: { id: delivery.id } }, '[failureRouting] failed to enqueue webhook delivery')
    }
}

const buildDeliveryPayload = ({ event, rule, delivery, displayInfo }: Pick<DeliverParams, 'event' | 'rule' | 'delivery' | 'displayInfo'>): Record<string, unknown> => {
    const flowRun = event.data.flowRun
    return {
        type: 'flow_run.failure_routed',
        created: new Date().toISOString(),
        platformId: rule.platformId,
        projectId: rule.projectId,
        rule: {
            id: rule.id,
            name: rule.displayName,
            priority: rule.priority,
        },
        flowRun: {
            id: flowRun.id,
            flowId: flowRun.flowId,
            flowVersionId: flowRun.flowVersionId,
            flowDisplayName: displayInfo.flowDisplayName,
            projectDisplayName: displayInfo.projectDisplayName,
            environment: flowRun.environment,
            status: flowRun.status,
            startTime: flowRun.startTime ?? null,
            finishTime: flowRun.finishTime ?? null,
        },
        failure: {
            category: delivery.category,
            retryCount: delivery.retryCount,
        },
    }
}

const snapshotLastDelivery = async (ruleId: string, deliveryId: string, status: FailureDeliveryStatus, errorMessage: string | null, updated = new Date().toISOString()): Promise<void> => {
    const delivery = await deliveryRepo().findOneBy({ id: deliveryId })
    if (isNil(delivery)) {
        return
    }
    await ruleRepo().update({ id: ruleId }, {
        lastDelivery: {
            status,
            flowRunId: delivery.flowRunId,
            errorMessage,
            updated,
        },
    })
}

const isUniqueViolation = (error: unknown): boolean => {
    const code = (error as { code?: string, driverError?: { code?: string } })?.code
        ?? (error as { driverError?: { code?: string } })?.driverError?.code
    return code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE'
}

const truncateError = (message?: string | null): string | null => {
    if (isNil(message)) {
        return null
    }
    return message.length > MAX_TRANSPORT_ERROR_LENGTH
        ? message.slice(0, MAX_TRANSPORT_ERROR_LENGTH)
        : message
}

const buildTransportError = (httpStatus?: number, errorMessage?: string): string | undefined => {
    if (!isNil(httpStatus) && httpStatus >= 400) {
        return `Destination responded with HTTP ${httpStatus}`
    }
    return errorMessage
}

type CreateRuleParams = {
    projectId: string
    platformId: string
    request: CreateFailureRoutingRuleRequestBody
}

type UpdateRuleParams = {
    id: string
    projectId: string
    request: UpdateFailureRoutingRuleRequestBody
}

type DeleteRuleParams = {
    id: string
    projectId: string
}

type ListRulesParams = {
    projectId: string
    cursorRequest: Cursor
    limit: number
}

type ReportResultParams = {
    deliveryId: string
    platformId: string
    success: boolean
    httpStatus?: number
    errorMessage?: string
}

type HandleRunFinishedParams = {
    log: FastifyBaseLogger
    event: FlowRunFinishedEvent
}

type DisplayInfo = {
    flowDisplayName?: string
    projectDisplayName: string
}

type RouteToRuleParams = {
    log: FastifyBaseLogger
    rule: FailureRoutingRuleSchema
    event: FlowRunFinishedEvent
    category: FailureCategory
    retryCount: number
    displayInfo: DisplayInfo
}

type DeliverParams = {
    log: FastifyBaseLogger
    rule: FailureRoutingRuleSchema
    event: FlowRunFinishedEvent
    delivery: FailureDeliverySchema
    displayInfo: DisplayInfo
}
