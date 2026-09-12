import { z } from 'zod'
import { OptionalArrayFromQuery } from '@activepieces/core-utils'

/**
 * How the body of a captured webhook request was represented on the wire.
 * Streamed types (multipart, binary) never have their bytes stored — only metadata.
 */
export enum WebhookRequestBodyKind {
    JSON = 'JSON',
    FORM = 'FORM',
    TEXT = 'TEXT',
    MULTIPART = 'MULTIPART',
    BINARY = 'BINARY',
    XML = 'XML',
    EMPTY = 'EMPTY',
    UNKNOWN = 'UNKNOWN',
}

export const WebhookRequestFileMetadata = z.object({
    fieldName: z.string(),
    fileName: z.string().nullable(),
    contentType: z.string().nullable(),
    size: z.number(),
    truncated: z.boolean(),
    // Read URL of the stored upload. Populated after the upload is streamed to storage;
    // the bytes themselves are never duplicated into the capture.
    url: z.string().optional(),
})
export type WebhookRequestFileMetadata = z.infer<typeof WebhookRequestFileMetadata>

export const WebhookRequestBodySummary = z.object({
    kind: z.nativeEnum(WebhookRequestBodyKind),
    contentType: z.string().nullable(),
    // Parsed/truncated preview of the body. Absent for streamed binary bodies.
    preview: z.unknown().optional(),
    // Raw text prefix, only for text-like bodies that fail to parse.
    rawPreview: z.string().optional(),
    // Total body size in bytes as observed on the wire (before truncation).
    size: z.number(),
    truncated: z.boolean(),
    // Present when kind === MULTIPART. Files themselves are never embedded.
    files: z.array(WebhookRequestFileMetadata).optional(),
})
export type WebhookRequestBodySummary = z.infer<typeof WebhookRequestBodySummary>

export const WebhookRequestCapture = z.object({
    id: z.string(),
    created: z.string(),
    updated: z.string(),
    projectId: z.string(),
    platformId: z.string(),
    flowId: z.string(),
    requestId: z.string(),
    method: z.string(),
    path: z.string(),
    // Every value is an array so that repeated keys are preserved exactly as sent.
    headers: z.record(z.string(), z.array(z.string())),
    queryParams: z.record(z.string(), z.array(z.string())),
    body: WebhookRequestBodySummary,
    // Connection info is masked before storage (only a /24-equivalent prefix hint).
    clientIpPrefix: z.string().nullable(),
    responseStatus: z.number().nullable(),
    environment: z.string(),
    // Same shape as a trigger payload (body/headers/queryParams), reconstructed from
    // the masked summary. Safe to seed sample input for a draft test run.
    testInput: z.unknown().optional(),
})
export type WebhookRequestCapture = z.infer<typeof WebhookRequestCapture>

export const ListWebhookRequestCapturesRequestQuery = z.object({
    projectId: z.string(),
    flowId: OptionalArrayFromQuery(z.string()).optional(),
    status: OptionalArrayFromQuery(z.coerce.number()).optional(),
    requestId: z.string().optional(),
    limit: z.coerce.number().optional(),
    cursor: z.string().optional(),
    createdAfter: z.string().optional(),
    createdBefore: z.string().optional(),
})
export type ListWebhookRequestCapturesRequestQuery = z.infer<typeof ListWebhookRequestCapturesRequestQuery>

export const CopyWebhookRequestAsTestInputBody = z.object({
    projectId: z.string(),
})
export type CopyWebhookRequestAsTestInputBody = z.infer<typeof CopyWebhookRequestAsTestInputBody>

export const WebhookRequestRetentionDays = z.object({
    retentionDays: z.number().int().min(1).max(90),
})
export type WebhookRequestRetentionDays = z.infer<typeof WebhookRequestRetentionDays>
