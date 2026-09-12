import { describe, expect, it } from 'vitest'
import {
    classifyHeader,
    maskClientIp,
    sanitizeHeaders,
    sanitizeQueryParams,
    summarizeBody,
    truncate,
} from '../../../../src/app/webhooks/inspector/webhook-request-sanitizer'
import { WebhookRequestBodyKind } from '@activepieces/shared'

describe('webhook request sanitizer', () => {
    it('masks credentials and signature headers but keeps plain headers', () => {
        const { headers, maskedHeaders } = sanitizeHeaders({
            authorization: 'Bearer secret-token',
            'x-slack-signature': 'v0=deadbeef',
            'svix-signature': 'whsec_xxx',
            'x-forwarded-for': '203.0.113.5',
            'content-type': 'application/json',
            'x-custom': 'ok',
            cookie: ['session=abc', 'tracking=xyz'],
        } as never)

        expect(headers.authorization).toBeUndefined()
        expect(headers.cookie).toBeUndefined()
        expect(headers['x-slack-signature']).toBeUndefined()
        expect(headers['svix-signature']).toBeUndefined()
        expect(headers['x-forwarded-for']).toBeUndefined()
        expect(headers['content-type']).toEqual(['application/json'])
        expect(headers['x-custom']).toEqual(['ok'])

        // Names survive, values don't — with a mask reason.
        const byName = Object.fromEntries(maskedHeaders.map((header) => [header.name, header.reason]))
        expect(byName.authorization).toBe('SENSITIVE')
        expect(byName['x-slack-signature']).toBe('SENSITIVE')
        expect(byName['svix-signature']).toBe('SENSITIVE')
        expect(byName.cookie).toBe('SENSITIVE')
        expect(byName['x-forwarded-for']).toBe('CONNECTION')
        expect(JSON.stringify(maskedHeaders)).not.toContain('secret-token')
        expect(JSON.stringify(maskedHeaders)).not.toContain('deadbeef')
    })

    it('classifies known webhook signature header names', () => {
        expect(classifyHeader('stripe-signature')).toBe('SENSITIVE')
        expect(classifyHeader('x-hub-signature-256')).toBe('SENSITIVE')
        expect(classifyHeader('webhook-signature')).toBe('SENSITIVE')
        expect(classifyHeader('x-shopify-hmac-sha256')).toBe('SENSITIVE')
        expect(classifyHeader('connection')).toBe('CONNECTION')
        expect(classifyHeader('x-event-type')).toBe('PLAIN')
    })

    it('preserves repeated query keys as arrays and truncates long values', () => {
        const long = 'a'.repeat(2000)
        const result = sanitizeQueryParams({
            id: ['1', '2'],
            search: long,
        })
        expect(result.id).toEqual(['1', '2'])
        expect(result.search[0].endsWith('…')).toBe(true)
        expect(result.search[0].length).toBe(1025)
    })

    it('truncates oversized parsed bodies and flags them', () => {
        const summary = summarizeBody({
            kind: WebhookRequestBodyKind.JSON,
            contentType: 'application/json',
            size: 100,
            maxBodyBytes: 64,
            parsed: { big: 'x'.repeat(1000) },
        })
        expect(summary.truncated).toBe(true)
        expect(summary.size).toBe(100)
    })

    it('never stores bytes for binary bodies', () => {
        const summary = summarizeBody({
            kind: WebhookRequestBodyKind.BINARY,
            contentType: 'image/png',
            size: 5_000_000,
            maxBodyBytes: 16_000,
        })
        expect(summary.preview).toBeUndefined()
        expect(summary.files).toBeUndefined()
        expect(summary.size).toBe(5_000_000)
        expect(summary.truncated).toBe(true)
    })

    it('masks IPv4 and IPv6 client addresses to coarse prefixes', () => {
        expect(maskClientIp('192.168.42.17')).toBe('192.168.0.0/16')
        expect(maskClientIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8::/32')
        expect(maskClientIp(undefined)).toBeNull()
        expect(maskClientIp('1.2.3.4, 5.6.7.8')).toBe('1.2.0.0/16')
    })

    it('truncates strings with an ellipsis marker', () => {
        expect(truncate('short', 10)).toBe('short')
        expect(truncate('abcdefghij', 4)).toBe('abcd…')
    })
})
