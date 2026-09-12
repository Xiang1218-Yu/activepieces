import { isNil } from '@activepieces/core-utils'
import {
    ApplicationEventName,
    AuditLogExportFormat,
    AuditLogExportStatus,
} from '@activepieces/shared'

const MAX_FILE_SIZE_MB = '1'
process.env.AP_MAX_FILE_SIZE_MB = MAX_FILE_SIZE_MB

import { auditLogExportService } from '../../../../src/app/ee/audit-logs/audit-log-export-service'
import { auditLogExportJobs } from '../../../../src/app/ee/audit-logs/audit-log-export.jobs'
import { sleep } from '../../../../src/app/helper/sleep'
import { system } from '../../../../src/app/helper/system/system'
import { AppSystemProp } from '../../../../src/app/helper/system/system-props'
import { db } from '../../../helpers/db'
import { createAuditEvent } from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: Awaited<ReturnType<typeof setupTestEnvironment>>

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Audit Log Export oversize handling', () => {
    it('fails without retry when the generated export exceeds the maximum file size', async () => {
        expect(system.getNumberOrThrow(AppSystemProp.MAX_FILE_SIZE_MB)).toBe(1)
        const ctx: TestContext = await createTestContext(app, { plan: { auditLogEnabled: true } })

        const events = Array.from({ length: 12 }, () => createAuditEvent({
            platformId: ctx.platform.id,
            userId: ctx.user.id,
            projectId: ctx.project.id,
            action: ApplicationEventName.FLOW_CREATED,
            data: {
                flow: {
                    id: 'oversize-flow',
                    externalId: 'oversize-flow',
                    created: '2026-01-01T00:00:00.000Z',
                    updated: '2026-01-01T00:00:00.000Z',
                },
                padding: 'z'.repeat(100_000),
            } as never,
        }))
        await db.save('audit_event', events)

        const created = await auditLogExportService(app.log).create({
            platformId: ctx.platform.id,
            requestedById: ctx.user.id,
            format: AuditLogExportFormat.JSON,
            filters: { projectId: [ctx.project.id] },
        })
        await auditLogExportJobs(app.log).enqueue(created.id, {
            delayMs: 100,
            attempts: 3,
            backoffDelayMs: 200,
        })

        const record = await waitForStatus(created.id, ctx.platform.id, AuditLogExportStatus.FAILED)
        expect(record.attempts).toBe(1)
        expect(record.errorMessage).toContain('maximum file size')
        expect(isNil(record.fileId)).toBe(true)
    })

    async function waitForStatus(id: string, platformId: string, expected: AuditLogExportStatus) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const record = await auditLogExportService(app.log).getOneOrThrow({ id, platformId })
            if (record.status === expected) {
                return record
            }
            if (record.status === AuditLogExportStatus.COMPLETED) {
                throw new Error('unexpectedly completed an oversize export')
            }
            await sleep(250)
        }
        throw new Error(`export did not reach ${expected} in time`)
    }
})
