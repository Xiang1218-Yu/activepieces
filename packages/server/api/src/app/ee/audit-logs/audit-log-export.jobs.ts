import { apDayjs } from '@activepieces/server-utils'
import { FastifyBaseLogger } from 'fastify'
import { SystemJobContext, SystemJobData, SystemJobName } from '../../helper/system-jobs/common'
import { systemJobHandlers } from '../../helper/system-jobs/job-handlers'
import { systemJobsSchedule } from '../../helper/system-jobs/system-job'
import { auditLogExportService } from './audit-log-export-service'

const JOB_DELAY_MS = 500
const MAX_ATTEMPTS = 3

export const auditLogExportJobs = (log: FastifyBaseLogger) => ({
    register(): void {
        systemJobHandlers.registerJobHandler(SystemJobName.AUDIT_LOG_EXPORT, async (data: SystemJobData<SystemJobName.AUDIT_LOG_EXPORT>, job: SystemJobContext | undefined) => {
            await auditLogExportService(log).runExport({
                exportId: data.exportId,
                maxAttempts: data.maxAttempts ?? MAX_ATTEMPTS,
                attemptNumber: (job?.attemptsMade ?? 0) + 1,
            })
        })
        systemJobHandlers.registerJobHandler(SystemJobName.AUDIT_LOG_EXPORT_CLEANUP, async () => {
            await auditLogExportService(log).deleteStaleExports()
        })
        void systemJobsSchedule(log).upsertJob({
            job: {
                name: SystemJobName.AUDIT_LOG_EXPORT_CLEANUP,
                data: {},
                jobId: SystemJobName.AUDIT_LOG_EXPORT_CLEANUP,
            },
            schedule: {
                type: 'repeated',
                cron: '0 3 * * *',
            },
        })
    },
    async enqueue(exportId: string, options?: EnqueueOptions): Promise<void> {
        const attempts = options?.attempts ?? MAX_ATTEMPTS
        await systemJobsSchedule(log).upsertJob({
            job: {
                name: SystemJobName.AUDIT_LOG_EXPORT,
                data: { exportId, maxAttempts: attempts },
                jobId: `audit-log-export-${exportId}`,
            },
            schedule: {
                type: 'one-time',
                date: apDayjs().add(options?.delayMs ?? JOB_DELAY_MS, 'millisecond'),
            },
            customConfig: {
                attempts,
                backoff: {
                    type: 'exponential',
                    delay: options?.backoffDelayMs ?? 30_000,
                },
                removeOnComplete: true,
            },
        })
    },
})

type EnqueueOptions = {
    delayMs?: number
    attempts?: number
    backoffDelayMs?: number
}
