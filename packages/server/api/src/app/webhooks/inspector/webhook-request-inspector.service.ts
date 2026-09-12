import { ActivepiecesError, apId, ErrorCode, isNil, SeekPage } from '@activepieces/core-utils'
import {
    FlowOperationType,
    FlowVersionState,
    RunEnvironment,
    SampleDataFileType,
    WebhookRequestCapture,
    WebhookMaskedHeader,
    WebhookRequestBodyKind,
    WebhookStatusClass,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { LessThan, In } from 'typeorm'
import { repoFactory } from '../../core/db/repo-factory'
import { Order } from '../../helper/pagination/paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { rejectedPromiseHandler } from '../../helper/promise-handler'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { flowVersionService } from '../../flows/flow-version/flow-version.service'
import { WebhookRequestCaptureEntity } from './webhook-request-capture-entity'

const captureRepo = repoFactory(WebhookRequestCaptureEntity)

const MAX_LIST_LIMIT = 100

export type SaveCaptureParams = {
    projectId: string
    platformId: string
    flowId: string
    requestId: string
    method: string
    path: string
    headers: Record<string, string[]>
    maskedHeaders: WebhookMaskedHeader[]
    queryParams: Record<string, string[]>
    body: WebhookRequestCapture['body']
    clientIpPrefix: string | null
    responseStatus: number | null
    environment: RunEnvironment
    testInput?: unknown
}

export type ListCapturesParams = {
    projectId: string
    flowId?: string[]
    status?: number[]
    statusClass?: WebhookStatusClass[]
    requestId?: string
    createdAfter?: string
    createdBefore?: string
    cursor?: string
    limit: number
}

export const webhookRequestInspectorService = (log: FastifyBaseLogger) => ({
    async save(params: SaveCaptureParams): Promise<void> {
        try {
            const capture: Omit<WebhookRequestCapture, 'created' | 'updated'> = {
                id: apId(),
                projectId: params.projectId,
                platformId: params.platformId,
                flowId: params.flowId,
                requestId: params.requestId,
                method: params.method,
                path: params.path,
                headers: params.headers,
                maskedHeaders: params.maskedHeaders,
                queryParams: params.queryParams,
                body: params.body,
                clientIpPrefix: params.clientIpPrefix,
                responseStatus: params.responseStatus,
                environment: params.environment,
                testInput: params.testInput,
            }
            await captureRepo().save(capture)
        }
        catch (error) {
            // Inspection must never break webhook delivery.
            log.error({ error }, 'Failed to persist webhook request capture')
        }
    },

    async list(params: ListCapturesParams): Promise<SeekPage<WebhookRequestCapture>> {
        const decodedCursor = paginationHelper.decodeCursor(params.cursor ?? null)
        const paginator = buildPaginator<WebhookRequestCapture>({
            entity: WebhookRequestCaptureEntity,
            query: {
                limit: Math.min(params.limit, MAX_LIST_LIMIT),
                orderBy: [
                    { field: 'created', order: Order.DESC },
                    { field: 'id', order: Order.DESC },
                ],
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })

        let query = captureRepo().createQueryBuilder('capture').where({
            projectId: params.projectId,
        })
        if (!isNil(params.flowId) && params.flowId.length > 0) {
            query = query.andWhere({ flowId: In(params.flowId) })
        }
        if (!isNil(params.status) && params.status.length > 0) {
            query = query.andWhere({ responseStatus: In(params.status) })
        }
        if (!isNil(params.statusClass) && params.statusClass.length > 0) {
            const clauses: string[] = []
            const parameters: Record<string, number> = {}
            params.statusClass.forEach((statusClass, index) => {
                const [lower, upper] = statusClassRange(statusClass)
                clauses.push(`(capture."responseStatus" >= :lower${index} AND capture."responseStatus" <= :upper${index})`)
                parameters[`lower${index}`] = lower
                parameters[`upper${index}`] = upper
            })
            query = query.andWhere(`(${clauses.join(' OR ')})`, parameters)
        }
        if (!isNil(params.requestId) && params.requestId.length > 0) {
            query = query.andWhere({ requestId: params.requestId })
        }
        if (params.createdAfter) {
            query = query.andWhere('capture.created >= :createdAfter', { createdAfter: params.createdAfter })
        }
        if (params.createdBefore) {
            query = query.andWhere('capture.created <= :createdBefore', { createdBefore: params.createdBefore })
        }
        const { data, cursor } = await paginator.paginate(query)
        return paginationHelper.createPage<WebhookRequestCapture>(data, cursor)
    },

    /**
     * Loads a capture. Project scoping is mandatory — knowing a request id or capture id must
     * never grant access to another project's data.
     */
    async getOneOrThrow(params: { projectId: string; id: string }): Promise<WebhookRequestCapture> {
        const capture = await captureRepo().findOne({
            where: {
                id: params.id,
                projectId: params.projectId,
            },
        })
        if (isNil(capture)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'webhook_request_capture',
                    entityId: params.id,
                },
            })
        }
        return capture
    },

    /**
     * Seeds the flow's draft trigger with the captured request as sample INPUT. This writes a
     * sample-data file only — no flow run is created and the published production flow is never
     * touched. The user then opens the builder and runs the test step manually.
     */
    async copyAsTestInput(params: { projectId: string; captureId: string }): Promise<{ copied: boolean; flowId: string }> {
        const capture = await this.getOneOrThrow(params)
        const draftVersion = await flowVersionService(log).getLatestVersion(capture.flowId, FlowVersionState.DRAFT)
        if (isNil(draftVersion)) {
            return { copied: false, flowId: capture.flowId }
        }
        await flowVersionService(log).applyOperation({
            flowVersion: draftVersion,
            projectId: params.projectId,
            platformId: capture.platformId,
            userOperation: {
                type: FlowOperationType.SAVE_SAMPLE_DATA,
                request: {
                    stepName: draftVersion.trigger.name,
                    payload: buildTriggerPayload(capture),
                    type: SampleDataFileType.INPUT,
                },
            },
        })
        return { copied: true, flowId: capture.flowId }
    },
})

const STATUS_CLASS_RANGES: Record<WebhookStatusClass, [number, number]> = {
    '2xx': [200, 299],
    '3xx': [300, 399],
    '4xx': [400, 499],
    '5xx': [500, 599],
}

function statusClassRange(statusClass: WebhookStatusClass): [number, number] {
    return STATUS_CLASS_RANGES[statusClass]
}

function buildTriggerPayload(capture: WebhookRequestCapture): unknown {
    // testInput is assembled at capture time (masked headers, truncated preview, file URLs).
    if (!isNil(capture.testInput)) {
        return capture.testInput
    }
    const body = capture.body.kind === WebhookRequestBodyKind.BINARY
        ? undefined
        : capture.body.preview ?? capture.body.rawPreview ?? {}
    return {
        method: capture.method,
        headers: collapseLastValue(capture.headers),
        queryParams: collapseLastValue(capture.queryParams),
        body,
    }
}

function collapseLastValue(record: Record<string, string[]>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, values] of Object.entries(record)) {
        result[key] = Array.isArray(values) ? values[values.length - 1] ?? '' : String(values)
    }
    return result
}

let cleanupScheduled = false

/**
 * Deletes captures older than the configurable retention window. Runs on a daily interval and
 * opportunistically at boot. Failures are swallowed so they can't affect startup.
 */
export function startWebhookCaptureCleanup(log: FastifyBaseLogger): void {
    if (cleanupScheduled) {
        return
    }
    cleanupScheduled = true
    const run = (): void => {
        rejectedPromiseHandler(deleteExpiredCaptures(log), log)
    }
    run()
    const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000
    setInterval(run, ONE_DAY_IN_MS).unref()
}

async function deleteExpiredCaptures(log: FastifyBaseLogger): Promise<void> {
    const retentionDays = system.getNumberOrThrow(AppSystemProp.WEBHOOK_INSPECTOR_RETENTION_DAYS)
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const result = await captureRepo().delete({
        created: LessThan(cutoff),
    })
    log.info({ retentionDays, deleted: result.affected ?? 0 }, 'Cleaned up expired webhook request captures')
}
