import { AuditLogExportFormat, AuditLogExportStatus } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveMock = vi.fn()

vi.mock('../../../../src/app/file/file.service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/app/file/file.service')>()
    return {
        ...actual,
        fileService: vi.fn((log) => ({
            ...actual.fileService(log),
            save: (...args: unknown[]) => saveMock(...args),
        })),
    }
})

import { auditLogExportService } from '../../../../src/app/ee/audit-logs/audit-log-export-service'
import { auditLogExportJobs } from '../../../../src/app/ee/audit-logs/audit-log-export.jobs'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: Awaited<ReturnType<typeof setupTestEnvironment>>

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Audit Log Export job retries', () => {
    let ctx: TestContext

    beforeEach(() => {
        saveMock.mockReset()
    })

    it('retries a transient storage failure and completes on the next attempt', async () => {
        ctx = await createTestContext(app, { plan: { auditLogEnabled: true } })
        saveMock
            .mockRejectedValueOnce(new Error('storage temporarily unavailable'))
            .mockResolvedValueOnce({ id: 'file-transient', size: 42 })

        const created = await auditLogExportService(app.log).create({
            platformId: ctx.platform.id,
            requestedById: ctx.user.id,
            format: AuditLogExportFormat.CSV,
            filters: {},
        })
        await auditLogExportJobs(app.log).enqueue(created.id, {
            delayMs: 100,
            attempts: 3,
            backoffDelayMs: 300,
        })

        const completed = await waitForStatus(created.id, ctx.platform.id, AuditLogExportStatus.COMPLETED)
        expect(completed.attempts).toBe(2)
        expect(completed.fileId).toBe('file-transient')
        expect(saveMock).toHaveBeenCalledTimes(2)
    })

    it('marks the export FAILED after all attempts are exhausted', async () => {
        ctx = await createTestContext(app, { plan: { auditLogEnabled: true } })
        saveMock.mockRejectedValue(new Error('storage down'))

        const created = await auditLogExportService(app.log).create({
            platformId: ctx.platform.id,
            format: AuditLogExportFormat.JSON,
            filters: {},
        })
        await auditLogExportJobs(app.log).enqueue(created.id, {
            delayMs: 100,
            attempts: 2,
            backoffDelayMs: 200,
        })

        const failed = await waitForStatus(created.id, ctx.platform.id, AuditLogExportStatus.FAILED)
        expect(failed.attempts).toBe(2)
        expect(failed.errorMessage).toContain('storage down')
        expect(saveMock).toHaveBeenCalledTimes(2)
    })

    it('does not retry when the export exceeds the maximum file size', async () => {
        ctx = await createTestContext(app, { plan: { auditLogEnabled: true } })
        saveMock.mockRejectedValue(Object.assign(new Error('File exceeds the maximum allowed size'), {
            code: 'FILE_TOO_LARGE',
        }))

        const created = await auditLogExportService(app.log).create({
            platformId: ctx.platform.id,
            format: AuditLogExportFormat.JSON,
            filters: {},
        })
        await auditLogExportJobs(app.log).enqueue(created.id, {
            delayMs: 100,
            attempts: 3,
            backoffDelayMs: 200,
        })

        const failed = await waitForStatus(created.id, ctx.platform.id, AuditLogExportStatus.FAILED)
        expect(failed.attempts).toBe(1)
        expect(failed.errorMessage).toContain('maximum file size')
        expect(saveMock).toHaveBeenCalledTimes(1)
    })

    async function waitForStatus(id: string, platformId: string, expected: AuditLogExportStatus) {
        for (let attempt = 0; attempt < 60; attempt++) {
            const record = await auditLogExportService(app.log).getOneOrThrow({ id, platformId })
            if (record.status === expected) {
                return record
            }
            if ((expected === AuditLogExportStatus.COMPLETED && record.status === AuditLogExportStatus.FAILED)
                || (expected === AuditLogExportStatus.FAILED && record.status === AuditLogExportStatus.COMPLETED)) {
                throw new Error(`reached terminal status ${record.status} while waiting for ${expected}: ${record.errorMessage ?? ''}`)
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        throw new Error(`export did not reach ${expected} in time`)
    }
})

