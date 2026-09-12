import { Readable } from 'node:stream'
import {
    ApplicationEventName,
    AuditLogExportFormat,
    AuditLogExportStatus,
} from '@activepieces/shared'
import { StatusCodes } from 'http-status-codes'
import { auditLogExportService, DownloadTransport } from '../../../../src/app/ee/audit-logs/audit-log-export-service'
import { sleep } from '../../../../src/app/helper/sleep'
import { db } from '../../../helpers/db'
import { createAuditEvent } from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: Awaited<ReturnType<typeof setupTestEnvironment>> | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function consumeStream(stream: Readable): Promise<{ text: string, chunkCount: number, bytes: number }> {
    let text = ''
    let chunkCount = 0
    let bytes = 0
    for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        text += buffer.toString('utf-8')
        chunkCount++
        bytes += buffer.length
    }
    return { text, chunkCount, bytes }
}

describe('Audit Log Export API', () => {
    let ctx: TestContext

    beforeEach(async () => {
        ctx = await createTestContext(app!, {
            plan: {
                auditLogEnabled: true,
            },
        })
        await db.save('audit_event', [
            createAuditEvent({
                platformId: ctx.platform.id,
                userId: ctx.user.id,
                projectId: ctx.project.id,
                action: ApplicationEventName.FLOW_CREATED,
                data: {
                    flow: {
                        id: 'flow-1',
                        externalId: 'flow-ext-1',
                        created: '2026-01-01T00:00:00.000Z',
                        updated: '2026-01-01T00:00:00.000Z',
                    },
                },
            }),
            createAuditEvent({
                platformId: ctx.platform.id,
                userId: ctx.user.id,
                projectId: ctx.project.id,
                action: ApplicationEventName.USER_SIGNED_IN,
                data: {
                    user: {
                        id: ctx.user.id,
                        email: 'auditor@example.com',
                        firstName: 'Aud',
                        lastName: 'Itor',
                    },
                },
            }),
            createAuditEvent({
                platformId: ctx.platform.id,
                userId: ctx.user.id,
                projectId: ctx.project.id,
                action: ApplicationEventName.VARIABLE_UPSERTED,
                data: {
                    variable: {
                        id: 'var-1',
                        name: 'apiToken',
                        created: '2026-01-01T00:00:00.000Z',
                        updated: '2026-01-01T00:00:00.000Z',
                    },
                    project: { displayName: ctx.project.displayName },
                    password: 'super-secret',
                    nested: { clientSecret: 'do-not-leak' },
                } as never,
            }),
        ])
    })

    it('creates a CSV export in the background with headers even when empty', async () => {
        const response = await ctx.post('/v1/audit-events/exports', {
            format: AuditLogExportFormat.CSV,
            projectId: [ctx.project.id],
        })

        expect(response.statusCode).toBe(StatusCodes.CREATED)
        const body = response.json()
        expect(body.status).toBe(AuditLogExportStatus.PENDING)
        expect(body.filters.projectId).toEqual([ctx.project.id])

        const exportRecord = await waitForExportCompletion(body.id)
        expect(exportRecord.status).toBe(AuditLogExportStatus.COMPLETED)
        expect(exportRecord.eventCount).toBe(3)
        expect(exportRecord.fileName).toContain('.csv')

        const token = await issueToken(exportRecord.id)
        const download = await auditLogExportService(app!.log).prepareDownload({ token })
        expect(download.kind).toBe(DownloadTransport.STREAM)
        if (download.kind !== DownloadTransport.STREAM) {
            throw new Error('expected stream transport in local storage tests')
        }
        const { text, chunkCount } = await consumeStream(download.stream)
        expect(chunkCount).toBeGreaterThan(0)
        expect(download.fileName.endsWith('.csv')).toBe(true)
        expect(text).toContain('id,created,action,userId,userEmail,projectId,projectDisplayName,ip,data')
        expect(text).toContain(ApplicationEventName.FLOW_CREATED)
        expect(text).toContain(ApplicationEventName.USER_SIGNED_IN)
        expect(text).toContain('[REDACTED]')
        expect(text).not.toContain('super-secret')
        expect(text).not.toContain('do-not-leak')
        expect(text).toContain('"projectId"')
    })

    it('streams a large export in chunks instead of buffering the whole file', async () => {
        const payloadSize = 1_200_000
        const events = Array.from({ length: 20 }, () => createAuditEvent({
            platformId: ctx.platform.id,
            userId: ctx.user.id,
            projectId: ctx.project.id,
            action: ApplicationEventName.FLOW_CREATED,
            data: {
                flow: {
                    id: 'flow-large',
                    externalId: 'flow-large',
                    created: '2026-01-01T00:00:00.000Z',
                    updated: '2026-01-01T00:00:00.000Z',
                },
                padding: 'x'.repeat(payloadSize / 20),
            } as never,
        }))
        await db.save('audit_event', events)

        const response = await ctx.post('/v1/audit-events/exports', {
            format: AuditLogExportFormat.JSON,
        })
        const exportRecord = await waitForExportCompletion(response.json().id)
        expect(exportRecord.eventCount).toBe(23)

        const token = await issueToken(exportRecord.id)
        const download = await auditLogExportService(app!.log).prepareDownload({ token })
        if (download.kind !== DownloadTransport.STREAM) {
            throw new Error('expected stream transport')
        }
        const { text, chunkCount, bytes } = await consumeStream(download.stream)
        expect(bytes).toBeGreaterThan(payloadSize)
        expect(chunkCount).toBeGreaterThan(1)
        const parsed = JSON.parse(text)
        expect(parsed.events).toHaveLength(23)
    })

    it('creates a JSON export carrying filters metadata and a schema-shaped empty file', async () => {
        const response = await ctx.post('/v1/audit-events/exports', {
            format: AuditLogExportFormat.JSON,
            action: [ApplicationEventName.SIGNING_KEY_CREATED],
        })
        expect(response.statusCode).toBe(StatusCodes.CREATED)
        const body = response.json()

        const exportRecord = await waitForExportCompletion(body.id)
        expect(exportRecord.status).toBe(AuditLogExportStatus.COMPLETED)
        expect(exportRecord.eventCount).toBe(0)

        const token = await issueToken(exportRecord.id)
        const download = await auditLogExportService(app!.log).prepareDownload({ token })
        if (download.kind !== DownloadTransport.STREAM) {
            throw new Error('expected stream transport')
        }
        const { text } = await consumeStream(download.stream)
        const parsed = JSON.parse(text)
        expect(parsed.events).toEqual([])
        expect(parsed.metadata.format).toBe(AuditLogExportFormat.JSON)
        expect(parsed.metadata.filters.action).toEqual([ApplicationEventName.SIGNING_KEY_CREATED])
        expect(parsed.metadata.generatedAt).toBeDefined()
    })

    it('rejects a one-time download link on the second use', async () => {
        const response = await ctx.post('/v1/audit-events/exports', {
            format: AuditLogExportFormat.JSON,
        })
        const exportRecord = await waitForExportCompletion(response.json().id)
        const token = await issueToken(exportRecord.id)

        const first = await auditLogExportService(app!.log).prepareDownload({ token })
        if (first.kind !== DownloadTransport.STREAM) {
            throw new Error('expected stream transport')
        }
        const { bytes } = await consumeStream(first.stream)
        expect(bytes).toBeGreaterThan(0)

        await expect(auditLogExportService(app!.log).prepareDownload({ token })).rejects.toThrow()
    })

    it('downloads over the public HTTP route as a streamed attachment', async () => {
        const response = await ctx.post('/v1/audit-events/exports', {
            format: AuditLogExportFormat.CSV,
        })
        const exportRecord = await waitForExportCompletion(response.json().id)
        const token = await issueToken(exportRecord.id)

        const streamResponse = await app!.inject({
            method: 'GET',
            url: `/api/v1/audit-events/exports/${exportRecord.id}/download?token=${token}`,
            payloadAsStream: true,
        })
        expect(streamResponse.statusCode).toBe(StatusCodes.OK)
        expect(streamResponse.headers['content-disposition']).toContain('attachment')
        const streamed = streamResponse.stream()
        const body = await consumeStream(streamed as unknown as Readable)
        expect(body.text).toContain('id,created,action')
    })

    async function issueToken(id: string): Promise<string> {
        const linkResponse = await ctx.post(`/v1/audit-events/exports/${id}/download-link`, {})
        const url = new URL(linkResponse.json().downloadUrl)
        return url.searchParams.get('token') ?? ''
    }

    async function waitForExportCompletion(id: string) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const record = await auditLogExportService(app!.log).getOneOrThrow({
                id,
                platformId: ctx.platform.id,
            })
            if (record.status === AuditLogExportStatus.COMPLETED || record.status === AuditLogExportStatus.FAILED) {
                if (record.status === AuditLogExportStatus.FAILED) {
                    throw new Error(`Export failed: ${record.errorMessage}`)
                }
                return record
            }
            await sleep(250)
        }
        throw new Error('Export did not complete in time')
    }
})
