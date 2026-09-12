import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { SystemJobName } from '../helper/system-jobs/common'
import { systemJobHandlers } from '../helper/system-jobs/job-handlers'
import { systemJobsSchedule } from '../helper/system-jobs/system-job'
import { runRetentionCleanupService } from './run-retention-cleanup-service'
import { runRetentionController } from './run-retention.controller'

export const runRetentionModule: FastifyPluginAsyncZod = async (app) => {
    systemJobHandlers.registerJobHandler(SystemJobName.RUN_RETENTION_CLEANUP, async () => {
        await runRetentionCleanupService(app.log).cleanup()
    })
    await systemJobsSchedule(app.log).upsertJob({
        job: {
            name: SystemJobName.RUN_RETENTION_CLEANUP,
            data: {},
            jobId: SystemJobName.RUN_RETENTION_CLEANUP,
        },
        schedule: {
            type: 'repeated',
            cron: '45 */1 * * *',
        },
    })
    await app.register(runRetentionController, { prefix: '/v1/run-retention-policies' })
}
