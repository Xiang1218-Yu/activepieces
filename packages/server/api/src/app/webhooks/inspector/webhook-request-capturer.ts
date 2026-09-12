import { PassThrough, Readable } from 'node:stream'
import { isNil } from '@activepieces/core-utils'
import { RunEnvironment, WebhookRequestBodyKind, WebhookRequestFileMetadata } from '@activepieces/shared'
import { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import {
    maskClientIp,
    sanitizeHeaders,
    sanitizeMultipartPart,
    sanitizeQueryParams,
    summarizeBody,
    truncate,
} from './webhook-request-sanitizer'
import { webhookRequestInspectorService } from './webhook-request-inspector.service'

type ResolvedOwner = {
    projectId: string
    platformId: string
}

type MultipartFieldSummary = {
    kind: 'field'
    fieldName: string
    value: string
}

type MultipartFileAccumulator = WebhookRequestFileMetadata & {
    kind: 'file'
}

export type WebhookRequestCapturer = {
    /** Called once the owning flow resolves, so parsed (non-streamed) bodies get scoped too. */
    bindOwner(owner: ResolvedOwner): void
    recordMultipartField(part: { type?: 'field'; fieldname: string; value: unknown }): void
    /** Wraps a multipart file stream with a byte counter; the wrapped stream is what gets stored. */
    countMultipartFile(part: {
        type?: 'file'
        fieldname: string
        filename?: string
        mimetype?: string
        truncated?: boolean
    }, stream: Readable): Readable
    /** Attaches the storage URL of an uploaded multipart file to its metadata, in arrival order. */
    recordMultipartFileUrl(url: string): void
    /** Attaches the storage URL of a streamed binary body. */
    recordBinaryFileUrl(url: string): void
    /** Wraps a binary body stream with a byte counter. */
    countBinaryStream(contentType: string | undefined, stream: Readable): Readable
    /** Records a parsed (non-streamed) request body. */
    recordParsedBody(body: unknown, rawBody: string | Buffer | undefined): void
    complete(params: {
        logger: FastifyBaseLogger
        requestId: string
        responseStatus: number | null
        environment: RunEnvironment
    }): Promise<void>
    /** Persists whatever summary is available when handling failed before producing a response. */
    fail(params: {
        logger: FastifyBaseLogger
        responseStatus: number
    }): Promise<void>
}

/**
 * Buffers the redacted request summary while the webhook is being processed. Everything collected
 * here is masked/truncated by the time it reaches the database; the raw request never leaves memory.
 */
export function createWebhookRequestCapturer(request: FastifyRequest, flowId: string, requestId?: string): WebhookRequestCapturer {
    const { headers: sanitizedHeaders, maskedHeaders } = sanitizeHeaders(request.headers)
    const queryParams = sanitizeQueryParams(request.query)
    const clientIpPrefix = maskClientIp(extractClientIp(request))
    const path = truncate(request.url.split('?')[0] ?? request.url, 500)

    let owner: ResolvedOwner | undefined
    const multipartFields: MultipartFieldSummary[] = []
    const multipartFiles: MultipartFileAccumulator[] = []
    // Byte count of multipart text field payloads, so the reported size covers the whole
    // multipart body, not just uploaded files.
    let multipartFieldBytes = 0
    const pendingStreams = new Set<Promise<void>>()
    let bodyRecorded = false
    let bodySummaryBuilder: (() => ReturnType<typeof summarizeBody>) | undefined
    let binaryFileUrl: string | undefined

    const buildMultipartTestBody = (): Record<string, unknown> => {
        const body: Record<string, unknown> = {}
        for (const field of multipartFields) {
            const existing = body[field.fieldName]
            body[field.fieldName] = appendMultiValue(existing, field.value)
        }
        for (const file of multipartFiles) {
            // Mirror the converted trigger payload: repeated field names collect into arrays and
            // file parts are represented by their storage read URL.
            const existing = body[file.fieldName]
            body[file.fieldName] = appendMultiValue(existing, file.url ?? null)
        }
        return body
    }

    const buildMultipartPreview = (): Record<string, unknown> => {
        const preview: Record<string, unknown> = {}
        for (const field of multipartFields) {
            const existing = preview[field.fieldName]
            preview[field.fieldName] = appendMultiValue(existing, field.value)
        }
        for (const file of multipartFiles) {
            const descriptor = {
                __file: true,
                fileName: file.fileName,
                contentType: file.contentType,
                size: file.size,
                truncated: file.truncated,
                url: file.url,
            }
            const existing = preview[file.fieldName]
            preview[file.fieldName] = appendMultiValue(existing, descriptor)
        }
        return preview
    }

    const maxBodyBytes = system.getNumberOrThrow(AppSystemProp.WEBHOOK_INSPECTOR_MAX_BODY_KB) * 1024

    // Registers a promise that resolves once a counted stream finishes accounting, so persist()
    // can wait briefly for in-flight uploads on synchronous webhooks.
    const trackStream = (stream: Readable): void => {
        const done = new Promise<void>((resolve) => {
            stream.on('end', () => resolve())
            stream.on('error', () => resolve())
            stream.on('aborted', () => resolve())
            stream.on('close', () => resolve())
        })
        pendingStreams.add(done)
        done.finally(() => pendingStreams.delete(done))
    }

    const capturer: WebhookRequestCapturer = {
        bindOwner(resolvedOwner) {
            owner ??= resolvedOwner
        },

        recordMultipartField(part) {
            const rawValue = typeof part.value === 'string' ? part.value : String(part.value ?? '')
            multipartFieldBytes += Buffer.byteLength(rawValue)
            multipartFields.push(
                sanitizeMultipartPart({
                    type: 'field',
                    fieldname: part.fieldname,
                    value: rawValue,
                }) as MultipartFieldSummary,
            )
        },

        countMultipartFile(part, stream) {
            const summary = sanitizeMultipartPart({
                type: 'file',
                fieldname: part.fieldname,
                filename: part.filename,
                mimetype: part.mimetype,
            })
            const file: MultipartFileAccumulator = { ...summary.file, kind: 'file' }
            multipartFiles.push(file)
            trackStream(stream)
            return countBytes(stream, (bytes, aborted) => {
                file.size = bytes
                // @fastify/multipart flags the part when it hits its own fileSize limit;
                // an aborted stream also means the stored bytes are incomplete.
                if (aborted || (part as { truncated?: boolean }).truncated === true) {
                    file.truncated = true
                }
            })
        },

        recordMultipartFileUrl(url) {
            const target = [...multipartFiles].reverse().find((file) => isNil(file.url))
            if (target) {
                target.url = url
            }
        },

        recordBinaryFileUrl(url) {
            binaryFileUrl = url
        },

        countBinaryStream(contentType, stream) {
            let size = 0
            bodySummaryBuilder = () => summarizeBody({
                kind: WebhookRequestBodyKind.BINARY,
                contentType,
                size,
                maxBodyBytes,
            })
            bodyRecorded = true
            trackStream(stream)
            return countBytes(stream, (bytes) => {
                size = bytes
            })
        },

        recordParsedBody(body, rawBody) {
            const rawText = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody
            const contentType = headerValue(request.headers['content-type'])
            const kind = classifyBody(contentType, body, rawText)
            const serializedSize = rawText?.length
                ?? (body === undefined ? 0 : Buffer.byteLength(safeStringify(body) ?? ''))
            bodySummaryBuilder = () => summarizeBody({
                kind,
                contentType,
                size: serializedSize,
                maxBodyBytes,
                parsed: body,
                rawText,
            })
            bodyRecorded = true
        },

        async complete({ logger, requestId, responseStatus, environment }) {
            await persist({ logger, requestId, responseStatus, environment })
        },

        async fail({ logger, responseStatus }) {
            // Errors can happen before the flow resolves (bad JSON, upload over the size limit);
            // in that case there is no project to scope the record against — skip.
            await persist({
                logger,
                requestId: requestId ?? 'failed',
                responseStatus,
                environment: RunEnvironment.TESTING,
            })
        },
    }

    let persisted = false
    async function persist(params: {
        logger: FastifyBaseLogger
        requestId: string
        responseStatus: number | null
        environment: RunEnvironment
    }): Promise<void> {
        if (persisted || !owner) {
            return
        }
        // Give still-flowing uploads up to 2s to finish accounting for their byte count.
        await Promise.race([
            Promise.allSettled(pendingStreams),
            new Promise((resolve) => setTimeout(resolve, 2000)),
        ])
        persisted = true
        let body
        if (bodyRecorded && bodySummaryBuilder) {
            body = bodySummaryBuilder()
            if (body.kind === WebhookRequestBodyKind.BINARY && binaryFileUrl) {
                body = { ...body, files: [{
                    fieldName: 'body',
                    fileName: null,
                    contentType: body.contentType,
                    size: body.size,
                    truncated: body.truncated,
                    url: binaryFileUrl,
                }] }
            }
        }
        else if (multipartFiles.length > 0 || multipartFields.length > 0) {
            body = summarizeBody({
                kind: WebhookRequestBodyKind.MULTIPART,
                contentType: headerValue(request.headers['content-type']),
                size: multipartFiles.reduce((total, file) => total + file.size, 0) + multipartFieldBytes,
                maxBodyBytes,
                files: multipartFiles.map(stripKind),
                multipartPreview: buildMultipartPreview(),
            })
        }
        else {
            body = summarizeBody({
                kind: WebhookRequestBodyKind.EMPTY,
                contentType: headerValue(request.headers['content-type']),
                size: 0,
                maxBodyBytes,
            })
        }

        await webhookRequestInspectorService(params.logger).save({
            projectId: owner.projectId,
            platformId: owner.platformId,
            flowId,
            requestId: params.requestId,
            method: request.method,
            path,
            headers: sanitizedHeaders,
            maskedHeaders,
            queryParams,
            body,
            clientIpPrefix,
            responseStatus: params.responseStatus,
            environment: params.environment,
            // Reconstruct a trigger-shaped payload used only when an operator copies the
            // request into a draft test run. Multipart files are referenced by storage URL only.
            testInput: {
                method: request.method,
                headers: collapseLastValue(sanitizedHeaders),
                queryParams: collapseLastValue(queryParams),
                body: body.kind === WebhookRequestBodyKind.MULTIPART
                    ? buildMultipartTestBody()
                    : body.kind === WebhookRequestBodyKind.BINARY
                        ? (binaryFileUrl ? { fileUrl: binaryFileUrl } : undefined)
                        : body.preview ?? body.rawPreview ?? {},
            },
        })
    }

    return capturer
}

function stripKind(file: MultipartFileAccumulator): WebhookRequestFileMetadata {
    return {
        fieldName: file.fieldName,
        fileName: file.fileName,
        contentType: file.contentType,
        size: file.size,
        truncated: file.truncated,
        url: file.url,
    }
}

function countBytes(stream: Readable, onEnd: (totalBytes: number, aborted: boolean) => void): Readable {
    let total = 0
    let settled = false
    const counter = new PassThrough()
    // Swallow re-emitted errors on the counter so inspection plumbing can never crash the request;
    // the original stream's error still propagates through the storage pipeline.
    counter.on('error', () => undefined)
    stream.on('data', (chunk: Buffer | string) => {
        total += Buffer.byteLength(chunk)
    })
    const settle = (aborted: boolean) => {
        if (settled) {
            return
        }
        settled = true
        onEnd(total, aborted)
    }
    stream.on('end', () => settle(false))
    stream.on('error', () => settle(true))
    stream.on('aborted', () => settle(true))
    stream.pipe(counter)
    return counter
}

function appendMultiValue(existing: unknown, value: unknown): unknown {
    if (existing === undefined) {
        return value
    }
    return Array.isArray(existing) ? [...existing, value] : [existing, value]
}

function collapseLastValue(record: Record<string, string[]>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, values] of Object.entries(record)) {
        result[key] = values[values.length - 1] ?? ''
    }
    return result
}

function headerValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value
}

function classifyBody(contentType: string | undefined, body: unknown, rawBody: string | undefined): WebhookRequestBodyKind {
    const base = contentType?.split(';')[0]?.trim().toLowerCase()
    if (body === undefined || rawBody === '') {
        return WebhookRequestBodyKind.EMPTY
    }
    if (!base) {
        return WebhookRequestBodyKind.UNKNOWN
    }
    if (base === 'application/json') {
        return WebhookRequestBodyKind.JSON
    }
    if (base === 'application/x-www-form-urlencoded') {
        return WebhookRequestBodyKind.FORM
    }
    if (base === 'text/xml' || base === 'application/xml' || base === 'application/rss+xml') {
        return WebhookRequestBodyKind.XML
    }
    if (base.startsWith('text/')) {
        return WebhookRequestBodyKind.TEXT
    }
    return WebhookRequestBodyKind.UNKNOWN
}

function safeStringify(value: unknown): string | undefined {
    try {
        return JSON.stringify(value)
    }
    catch {
        return undefined
    }
}

function extractClientIp(request: FastifyRequest): string | undefined {
    const configuredHeader = system.get(AppSystemProp.CLIENT_REAL_IP_HEADER)
    if (configuredHeader) {
        const headerValue = request.headers[configuredHeader.toLowerCase()]
        if (typeof headerValue === 'string') {
            return headerValue
        }
    }
    return request.ip
}
