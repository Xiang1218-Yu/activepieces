import { WebhookMaskedHeaderReason, WebhookRequestBodyKind, WebhookRequestBodySummary, WebhookRequestFileMetadata, WebhookMaskedHeader } from '@activepieces/shared'
import { FastifyRequest } from 'fastify'

const MASKED_VALUE = '***MASKED***'

// Headers that carry credentials or secrets. Values are never stored, only their presence.
const SENSITIVE_HEADER_PATTERNS = [
    /^authorization$/i,
    /^proxy-authorization$/i,
    /^cookie$/i,
    /^set-cookie$/i,
    /^x-api-key$/i,
    /^api-key$/i,
    /^x-auth-token$/i,
    /^x-access-token$/i,
    /^x-webhook-secret$/i,
    /^x-webhook-signature$/i,
    // Generic webhook signatures (svix, slack, stripe, github, clerk, standard webhooks, ...)
    /^svix-[a-z0-9-]+$/i,
    /^x-slack-signature$/i,
    /^x-slack-request-timestamp$/i,
    /^stripe-signature$/i,
    /^x-hub-signature(-256)?$/i,
    /^x-wp-webhook-signature$/i,
    /^x-cc-webhook-signature$/i,
    /^webhook-id$/i,
    /^webhook-signature$/i,
    /^webhook-timestamp$/i,
    /^x-shopify-hmac-sha256$/i,
    /^x-signature$/i,
    /^x-signing-key$/i,
    /^x-secret$/i,
    // Connection hop headers — not meaningful to the integration and expose infrastructure.
    /^x-forwarded-for$/i,
    /^x-forwarded-host$/i,
    /^x-forwarded-port$/i,
    /^x-forwarded-proto$/i,
    /^x-forwarded-server$/i,
    /^x-real-ip$/i,
    /^x-request-id$/i,
    /^forwarded$/i,
    /^via$/i,
    /^true-client-ip$/i,
    /^cf-connecting-ip$/i,
]

// Hop-by-hop / transport headers that describe the connection rather than the payload.
const CONNECTION_HEADER_PATTERNS = [
    /^host$/i,
    /^connection$/i,
    /^content-length$/i,
    /^keep-alive$/i,
    /^transfer-encoding$/i,
    /^te$/i,
    /^upgrade$/i,
    /^proxy-authenticate$/i,
    /^proxy-connection$/i,
]

const MAX_HEADER_VALUE_LENGTH = 512
const MAX_QUERY_VALUE_LENGTH = 1024
const MAX_FORM_FIELD_VALUE_LENGTH = 2048
const MAX_RAW_PREVIEW_LENGTH = 2048

export type HeaderSensitivity = 'SENSITIVE' | 'CONNECTION' | 'PLAIN'

export function classifyHeader(name: string): HeaderSensitivity {
    if (SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(name))) {
        return 'SENSITIVE'
    }
    if (CONNECTION_HEADER_PATTERNS.some((pattern) => pattern.test(name))) {
        return 'CONNECTION'
    }
    return 'PLAIN'
}

function normalizeHeaderValues(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((entry) => stringifyHeaderValue(entry))
    }
    return [stringifyHeaderValue(value)]
}

function stringifyHeaderValue(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (Buffer.isBuffer(value)) {
        return value.toString('utf8')
    }
    return String(value ?? '')
}

export type SanitizedHeaders = {
    headers: Record<string, string[]>
    // Names of headers whose values were dropped, kept so operators can verify what the
    // sender actually included (e.g. an Authorization or x-forwarded-for header was present).
    maskedHeaders: WebhookMaskedHeader[]
}

/**
 * Redacts sensitive header values entirely and truncates anything abnormally long.
 * Repeated headers are preserved as arrays; masked names are recorded (without values).
 */
export function sanitizeHeaders(rawHeaders: FastifyRequest['headers']): SanitizedHeaders {
    const headers: Record<string, string[]> = {}
    const maskedHeaders: WebhookMaskedHeader[] = []
    for (const [name, value] of Object.entries(rawHeaders ?? {})) {
        const classification = classifyHeader(name)
        if (classification === 'SENSITIVE' || classification === 'CONNECTION') {
            maskedHeaders.push({
                name,
                reason: classification as WebhookMaskedHeaderReason,
            })
            continue
        }
        headers[name] = normalizeHeaderValues(value).map((entry) => truncate(entry, MAX_HEADER_VALUE_LENGTH))
    }
    return { headers, maskedHeaders }
}

/**
 * Preserves repeated query keys (each key maps to an array) and truncates long values.
 */
export function sanitizeQueryParams(query: unknown): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    if (isPlainRecord(query)) {
        for (const [key, value] of Object.entries(query)) {
            const values = Array.isArray(value) ? value : [value]
            result[key] = values.map((entry) => truncate(stringifyHeaderValue(entry), MAX_QUERY_VALUE_LENGTH))
        }
    }
    return result
}

export type MultipartPartSummary =
    | { kind: 'field'; fieldName: string; value: string }
    | { kind: 'file'; file: WebhookRequestFileMetadata }

/**
 * Truncates multipart text field values; file parts carry metadata only, never bytes.
 */
export function sanitizeMultipartPart(part: {
    type: 'file' | 'field'
    fieldname: string
    value?: string
    filename?: string
    mimetype?: string
}): MultipartPartSummary {
    if (part.type === 'file') {
        return {
            kind: 'file',
            file: {
                fieldName: part.fieldname,
                fileName: part.filename ? truncate(part.filename, MAX_FORM_FIELD_VALUE_LENGTH) : null,
                contentType: part.mimetype ?? null,
                // Size is accumulated by the caller while the stream flows to storage.
                size: 0,
                truncated: false,
            },
        }
    }
    return {
        kind: 'field',
        fieldName: part.fieldname,
        value: truncate(part.value ?? '', MAX_FORM_FIELD_VALUE_LENGTH),
    }
}

export function summarizeBody(params: SummarizeBodyParams): WebhookRequestBodySummary {
    const { kind, contentType, size } = params
    const maxBytes = params.maxBodyBytes
    const truncated = size > maxBytes
    switch (kind) {
        case WebhookRequestBodyKind.EMPTY:
            return { kind, contentType: contentType ?? null, size, truncated: false }
        case WebhookRequestBodyKind.MULTIPART: {
            const cappedPreview = capDeep(params.multipartPreview ?? {}, maxBytes)
            return {
                kind,
                contentType: contentType ?? null,
                size,
                truncated: truncated || cappedPreview.truncated,
                files: params.files ?? [],
                preview: cappedPreview.value,
            }
        }
        case WebhookRequestBodyKind.BINARY:
            return { kind, contentType: contentType ?? null, size, truncated }
        case WebhookRequestBodyKind.TEXT:
            return {
                kind,
                contentType: contentType ?? null,
                size,
                truncated,
                rawPreview: truncate(params.rawText ?? '', MAX_RAW_PREVIEW_LENGTH),
            }
        default: {
            const capped = capDeep(params.parsed ?? {}, maxBytes)
            return {
                kind,
                contentType: contentType ?? null,
                size,
                truncated: truncated || capped.truncated,
                preview: capped.value,
            }
        }
    }
}

/**
 * Masks an IPv4/IPv6 address down to a coarse prefix hint so individual clients can't be tracked.
 */
export function maskClientIp(ip: string | undefined): string | null {
    if (!ip) {
        return null
    }
    const trimmed = ip.split(',')[0]?.trim()
    if (!trimmed) {
        return null
    }
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
    const v4Match = trimmed.match(ipv4)
    if (v4Match) {
        return `${v4Match[1]}.${v4Match[2]}.0.0/16`
    }
    // IPv6: keep the first two hextets (/32 hint).
    const hextets = trimmed.split(':')
    if (hextets.length >= 2 && /^[0-9a-f]+$/i.test(hextets[0] ?? '') && /^[0-9a-f]+$/i.test(hextets[1] ?? '')) {
        return `${hextets[0]}:${hextets[1]}::/32`
    }
    return MASKED_VALUE
}

export function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value
    }
    return `${value.slice(0, maxLength)}…`
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively caps the serialized size of a parsed body preview. Long strings are truncated and
 * over-deep/oversized arrays/objects are trimmed, so a pathological JSON body can't blow the budget.
 */
function capDeep(value: unknown, maxBytes: number): { value: unknown; truncated: boolean } {
    let truncated = false
    const budget = { bytes: 0 }

    const walk = (input: unknown, depth: number): unknown => {
        if (budget.bytes >= maxBytes || depth > 20) {
            truncated = true
            return null
        }
        if (typeof input === 'string') {
            const remaining = maxBytes - budget.bytes
            budget.bytes += Buffer.byteLength(input)
            if (input.length > remaining) {
                truncated = true
                return truncate(input, Math.max(32, remaining))
            }
            return input
        }
        if (typeof input === 'number' || typeof input === 'boolean' || input === null) {
            budget.bytes += 8
            return input
        }
        if (Array.isArray(input)) {
            const out: unknown[] = []
            for (const entry of input) {
                if (budget.bytes >= maxBytes) {
                    truncated = true
                    break
                }
                out.push(walk(entry, depth + 1))
            }
            return out
        }
        if (isPlainRecord(input)) {
            const out: Record<string, unknown> = {}
            for (const [key, entry] of Object.entries(input)) {
                if (budget.bytes >= maxBytes) {
                    truncated = true
                    break
                }
                budget.bytes += Buffer.byteLength(key)
                out[key] = walk(entry, depth + 1)
            }
            return out
        }
        return String(input)
    }

    return { value: walk(value, 0), truncated }
}

type SummarizeBodyParams = {
    kind: WebhookRequestBodyKind
    contentType: string | undefined
    size: number
    maxBodyBytes: number
    parsed?: unknown
    rawText?: string
    files?: WebhookRequestFileMetadata[]
    multipartPreview?: Record<string, unknown>
}
