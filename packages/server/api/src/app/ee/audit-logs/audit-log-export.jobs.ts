import { apDayjs } from '@activepieces/server-utils'
import { FastifyBaseLogger } from 'fastify'
import { SystemJobData, SystemJobName } from '../../helper/system-jobs/common'
import { systemJobHandlers } from '../../helper/system-jobs/job-handlers'
import { systemJobsSchedule } from '../../helper/system-jobs/system-job'
import { auditLogExportService } from './audit-log-export-service'

const JOB_DELAY_MS = 500

export const auditLogExportJobs = (log: FastifyBaseLogger) => ({
    register(): void {
        systemJobHandlers.registerJobHandler(SystemJobName.AUDIT_LOG_EXPORT, async (data: SystemJobData<SystemJobName.AUDIT_LOG_EXPORT>) => {
            await auditLogExportService(log).runExport(data.exportId)
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
    async enqueue(exportId: string): Promise<void> {
        await systemJobsSchedule(log).upsertJob({
            job: {
                name: SystemJobName.AUDIT_LOG_EXPORT,
                data: { exportId },
                jobId: `audit-log-export-${exportId}`,
            },
            schedule: {
                type: 'one-time',
                date: apDayjs().add(JOB_DELAY_MS, 'millisecond'),
            },
        })
    },
})
