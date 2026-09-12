import {
    ApplicationEventName,
    AuditLogExportFormat,
    AuditLogExportStatus,
} from '@activepieces/shared'
import { StatusCodes } from 'http-status-codes'
import { auditLogExportService } from '../../../../src/app/ee/audit-logs/audit-log-export-service'
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

async function createExport(ctx: TestContext, overrides?: Record<string, unknown>) {
    const response = await ctx.post('/v1/audit-events/exports', {
        format: AuditLogExportFormat.JSON,
        ...overrides,
    })
    expect(response.statusCode).toBe(StatusCodes.CREATED)
    const body = response.json()
    for (let attempt = 0; attempt < 40; attempt++) {
        const record = await auditLogExportService(app!.log).getOneOrThrow({
            id: body.id,
            platformId: ctx.platform.id,
        })
        if (record.status === AuditLogExportStatus.COMPLETED) {
            return record
        }
        if (record.status === AuditLogExportStatus.FAILED) {
            throw new Error(`Export failed: ${record.errorMessage}`)
        }
        await sleep(100)
    }
    throw new Error('Export did not complete in time')
}

async function issueToken(ctx: TestContext, id: string): Promise<string> {
    const linkResponse = await ctx.post(`/v1/audit-events/exports/${id}/download-link`, {})
    return new URL(linkResponse.json().downloadUrl).searchParams.get('token') ?? ''
}

describe('Audit Log Export permission isolation', () => {
    it('isolates exports between platforms and refuses tokens across platforms', async () => {
        const platformA = await createTestContext(app!, { plan: { auditLogEnabled: true } })
        const platformB = await createTestContext(app!, { plan: { auditLogEnabled: true } })

        await db.save('audit_event', [
            createAuditEvent({
                platformId: platformA.platform.id,
                userId: platformA.user.id,
                projectId: platformA.project.id,
                action: ApplicationEventName.FLOW_CREATED,
                data: { flow: { id: 'a-flow', externalId: 'a', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' } },
            }),
            createAuditEvent({
                platformId: platformB.platform.id,
                userId: platformB.user.id,
                projectId: platformB.project.id,
                action: ApplicationEventName.FLOW_CREATED,
                data: { flow: { id: 'b-flow', externalId: 'b', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' } },
            }),
        ])

        const exportA = await createExport(platformA)
        const exportB = await createExport(platformB)
        expect(exportA.eventCount).toBe(1)
        expect(exportB.eventCount).toBe(1)

        const listA = await platformA.get('/v1/audit-events/exports')
        expect(listA.json().data.map((row: { id: string }) => row.id)).toContain(exportA.id)
        expect(listA.json().data.map((row: { id: string }) => row.id)).not.toContain(exportB.id)

        const foreignRead = await platformB.get(`/v1/audit-events/exports/${exportA.id}`)
        expect(foreignRead.statusCode).toBe(StatusCodes.NOT_FOUND)

        const foreignLink = await platformB.post(`/v1/audit-events/exports/${exportA.id}/download-link`, {})
        expect(foreignLink.statusCode).toBe(StatusCodes.NOT_FOUND)

        const tokenA = await issueToken(platformA, exportA.id)
        await expect(
            auditLogExportService(app!.log).prepareDownload({ token: tokenA }),
        ).resolves.toBeDefined()
        const reusedToken = tokenA
        await expect(
            auditLogExportService(app!.log).prepareDownload({ token: reusedToken }),
        ).rejects.toThrow()

        const tokenA2 = await issueToken(platformA, exportA.id)
        const parts = tokenA2.split('.')
        const tamperedPayload = Buffer.from(JSON.stringify({
            exportId: exportA.id,
            platformId: platformB.platform.id,
            fileId: exportA.fileId,
        })).toString('base64url')
        const tamperedToken = [parts[0], tamperedPayload, parts[2]].join('.')
        await expect(
            auditLogExportService(app!.log).prepareDownload({ token: tamperedToken }),
        ).rejects.toThrow()
    })

    it('requires the audit log feature flag for management routes', async () => {
        const gated = await createTestContext(app!, { plan: { auditLogEnabled: false } })

        const create = await gated.post('/v1/audit-events/exports', {
            format: AuditLogExportFormat.CSV,
        })
        expect(create.statusCode).toBe(StatusCodes.PAYMENT_REQUIRED)

        const list = await gated.get('/v1/audit-events/exports')
        expect(list.statusCode).toBe(StatusCodes.PAYMENT_REQUIRED)
    })

    it('refuses download without a valid token', async () => {
        const ctx = await createTestContext(app!, { plan: { auditLogEnabled: true } })
        const record = await createExport(ctx)

        const noToken = await app!.inject({
            method: 'GET',
            url: `/api/v1/audit-events/exports/${record.id}/download`,
        })
        expect([StatusCodes.BAD_REQUEST, StatusCodes.UNAUTHORIZED]).toContain(noToken.statusCode)

        const badToken = await app!.inject({
            method: 'GET',
            url: `/api/v1/audit-events/exports/${record.id}/download?token=not-a-jwt`,
        })
        expect(badToken.statusCode).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('allows only one of two concurrent requests using the same one-time token', async () => {
        const ctx = await createTestContext(app!, { plan: { auditLogEnabled: true } })
        const record = await createExport(ctx)
        const token = await issueToken(ctx, record.id)

        const [first, second] = await Promise.all([
            auditLogExportService(app!.log).prepareDownload({ token }).then(
                () => 'ok',
                () => 'rejected',
            ),
            auditLogExportService(app!.log).prepareDownload({ token }).then(
                () => 'ok',
                () => 'rejected',
            ),
        ])
        const outcomes = [first, second].sort()
        expect(outcomes).toEqual(['ok', 'rejected'])
    })

    it('rejects an export row whose stored file is not an AUDIT_LOG_EXPORT file', async () => {
        const ctx = await createTestContext(app!, { plan: { auditLogEnabled: true } })
        const record = await createExport(ctx)
        const token = await issueToken(ctx, record.id)
        if (record.fileId === undefined || record.fileId === null) {
            throw new Error('expected completed export to have a fileId')
        }

        await db.update('file', record.fileId, { type: 'FLOW_STEP_FILE' })

        await expect(
            auditLogExportService(app!.log).prepareDownload({ token }),
        ).rejects.toThrow()
    })
})
