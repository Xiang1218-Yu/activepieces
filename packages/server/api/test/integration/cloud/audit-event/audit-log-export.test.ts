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

        const { data, fileName } = await auditLogExportService(app!.log).downloadByToken(
            await issueToken(exportRecord.id),
        )
        const text = data.toString('utf-8')
        expect(fileName.endsWith('.csv')).toBe(true)
        expect(text).toContain('id,created,action,userId,userEmail,projectId,projectDisplayName,ip,data')
        expect(text).toContain(ApplicationEventName.FLOW_CREATED)
        expect(text).toContain(ApplicationEventName.USER_SIGNED_IN)
        expect(text).toContain('[REDACTED]')
        expect(text).not.toContain('super-secret')
        expect(text).not.toContain('do-not-leak')
        expect(text).toContain('"projectId"')
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

        const { data } = await auditLogExportService(app!.log).downloadByToken(
            await issueToken(exportRecord.id),
        )
        const parsed = JSON.parse(data.toString('utf-8'))
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

        const first = await auditLogExportService(app!.log).downloadByToken(token)
        expect(first.data.length).toBeGreaterThan(0)

        await expect(auditLogExportService(app!.log).downloadByToken(token)).rejects.toThrow()
    })

    async function issueToken(id: string): Promise<string> {
        const linkResponse = await ctx.post(`/v1/audit-events/exports/${id}/download-link`, {})
        const url = new URL(linkResponse.json().downloadUrl)
        return url.searchParams.get('token')!
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
