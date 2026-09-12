
import { wideEvent } from '@activepieces/server-utils'
import {
    RAW_PAYLOAD_HEADER,
    WebhookUrlParams,
    WebsocketClientEvent,
} from '@activepieces/shared'
import { FastifyRequest } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { triggerSourceService } from '../trigger/trigger-source/trigger-source-service'
import { createWebhookRequestCapturer } from './inspector/webhook-request-capturer'
import { convertRequest, extractHeaderFromRequest } from './webhook-request-converter'
import { WebhookFlowVersionToRun, webhookService } from './webhook.service'

export const webhookController: FastifyPluginAsyncZod = async (app) => {

    app.all(
        '/:flowId/sync',
        WEBHOOK_PARAMS,
        async (request: FastifyRequest<{ Params: WebhookUrlParams }>, reply) => {
            wideEvent.set({
                flow: { id: request.params.flowId },
                webhook: {
                    method: request.method,
                    async: false,
                },
            })
            const inspector = createWebhookRequestCapturer(request, request.params.flowId)
            const rawPayload = extractRawPayload(request)
            // The raw-payload shortcut skips convertRequest(), so feed the parsed body to the
            // inspector explicitly; owner binding still happens once the flow resolves.
            if (rawPayload.payload) {
                inspector.recordParsedBody(rawPayload.payload, request.rawBody)
            }
            const response = await withInspection(request, inspector, StatusCodes.INTERNAL_SERVER_ERROR, () => webhookService.handleWebhook({
                data: (projectId: string) => convertRequest(request, projectId, request.params.flowId, inspector),
                logger: request.log,
                flowId: request.params.flowId,
                async: false,
                flowVersionToRun: WebhookFlowVersionToRun.LOCKED_FALL_BACK_TO_LATEST,
                saveSampleData: await triggerSourceService(request.log).existsByFlowId({
                    flowId: request.params.flowId,
                    simulate: true,
                }),
                execute: true,
                ...rawPayload,
                ...extractHeaderFromRequest(request),
                inspector,
            }))
            wideEvent.set({ webhook: { responseStatus: response.status } })
            await reply
                .status(response.status)
                .headers(response.headers)
                .send(response.body)
        },
    )

    app.all(
        '/:flowId',
        WEBHOOK_PARAMS,
        async (request: FastifyRequest<{ Params: WebhookUrlParams }>, reply) => {
            wideEvent.set({
                flow: { id: request.params.flowId },
                webhook: {
                    method: request.method,
                    async: true,
                },
            })
            const inspector = createWebhookRequestCapturer(request, request.params.flowId)
            const rawPayload = extractRawPayload(request)
            if (rawPayload.payload) {
                inspector.recordParsedBody(rawPayload.payload, request.rawBody)
            }
            const response = await withInspection(request, inspector, StatusCodes.INTERNAL_SERVER_ERROR, () => webhookService.handleWebhook({
                data: (projectId: string) => convertRequest(request, projectId, request.params.flowId, inspector),
                logger: request.log,
                flowId: request.params.flowId,
                async: true,
                saveSampleData: await triggerSourceService(request.log).existsByFlowId({
                    flowId: request.params.flowId,
                    simulate: true,
                }),
                flowVersionToRun: WebhookFlowVersionToRun.LOCKED_FALL_BACK_TO_LATEST,
                execute: true,
                ...rawPayload,
                ...extractHeaderFromRequest(request),
                inspector,
            }))
            wideEvent.set({ webhook: { responseStatus: response.status } })
            await reply
                .status(response.status)
                .headers(response.headers)
                .send(response.body)
        },
    )

    app.all('/:flowId/draft/sync', WEBHOOK_PARAMS, async (request, reply) => {
        const inspector = createWebhookRequestCapturer(request, request.params.flowId)
        const response = await withInspection(request, inspector, StatusCodes.INTERNAL_SERVER_ERROR, () => webhookService.handleWebhook({
            data: (projectId: string) => convertRequest(request, projectId, request.params.flowId, inspector),
            logger: request.log,
            flowId: request.params.flowId,
            async: false,
            saveSampleData: true,
            flowVersionToRun: WebhookFlowVersionToRun.LATEST,
            execute: true,
            onRunCreated: (run) => {
                app.io.to(run.projectId).emit(WebsocketClientEvent.TEST_FLOW_RUN_STARTED, run)
            },
            ...extractHeaderFromRequest(request),
            inspector,
        }))
        await reply
            .status(response.status)
            .headers(response.headers)
            .send(response.body)
    })

    app.all('/:flowId/draft', WEBHOOK_PARAMS, async (request, reply) => {
        const inspector = createWebhookRequestCapturer(request, request.params.flowId)
        const response = await withInspection(request, inspector, StatusCodes.INTERNAL_SERVER_ERROR, () => webhookService.handleWebhook({
            data: (projectId: string) => convertRequest(request, projectId, request.params.flowId, inspector),
            logger: request.log,
            flowId: request.params.flowId,
            async: true,
            saveSampleData: true,
            flowVersionToRun: WebhookFlowVersionToRun.LATEST,
            execute: true,
            ...extractHeaderFromRequest(request),
            inspector,
        }))
        await reply
            .status(response.status)
            .headers(response.headers)
            .send(response.body)
    })

    app.all('/:flowId/test', WEBHOOK_PARAMS, async (request, reply) => {
        const inspector = createWebhookRequestCapturer(request, request.params.flowId)
        const response = await withInspection(request, inspector, StatusCodes.INTERNAL_SERVER_ERROR, () => webhookService.handleWebhook({
            data: (projectId: string) => convertRequest(request, projectId, request.params.flowId, inspector),
            logger: request.log,
            flowId: request.params.flowId,
            async: true,
            saveSampleData: true,
            flowVersionToRun: WebhookFlowVersionToRun.LATEST,
            execute: false,
            ...extractHeaderFromRequest(request),
            inspector,
        }))
        await reply
            .status(response.status)
            .headers(response.headers)
            .send(response.body)
    })

}

const WEBHOOK_PARAMS = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        params: WebhookUrlParams,
    },
}

/**
 * Persists the redacted capture when handling throws (e.g. file too large, JSON parse error),
 * then rethrows so Fastify's error handler produces the real response.
 */
async function withInspection<T extends { status: number }>(
    request: FastifyRequest,
    inspector: ReturnType<typeof createWebhookRequestCapturer>,
    errorStatus: number,
    handler: () => Promise<T>,
): Promise<T> {
    try {
        return await handler()
    }
    catch (error) {
        const status = (typeof error === 'object' && error !== null && 'statusCode' in error && typeof (error as { statusCode: unknown }).statusCode === 'number')
            ? (error as { statusCode: number }).statusCode
            : errorStatus
        try {
            await inspector.fail({ logger: request.log, responseStatus: status })
        }
        catch {
            // Inspection failures must never mask the original error.
        }
        throw error
    }
}


function extractRawPayload(request: FastifyRequest): { payload?: Record<string, unknown> } {
    const isRawPayload = request.headers[RAW_PAYLOAD_HEADER] === 'true'
        && request.headers.authorization
        && request.body != null
        && !Array.isArray(request.body)
        && !Buffer.isBuffer(request.body)
    if (isRawPayload) {
        return { payload: request.body as Record<string, unknown> }
    }
    return {}
}
