import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { rejectedPromiseHandler } from '../../../helper/promise-handler'
import { SystemJobName } from '../../../helper/system-jobs/common'
import { systemJobHandlers } from '../../../helper/system-jobs/job-handlers'
import { systemJobsSchedule } from '../../../helper/system-jobs/system-job'
import { platformMustHaveFeatureEnabled } from '../../authentication/ee-authorization'
import { approvalSlaPolicyController } from './approval-sla-policy.controller'
import { approvalSlaSweepService } from './approval-sla-sweep.service'
import { flowApprovalRequestController } from './flow-approval-request.controller'

export const flowApprovalModule: FastifyPluginAsyncZod = async (app) => {
    app.addHook('preHandler', platformMustHaveFeatureEnabled((platform) => platform.plan.environmentsEnabled))
    await app.register(flowApprovalRequestController, { prefix: '/v1/flow-approval-requests' })
    await app.register(approvalSlaPolicyController, { prefix: '/v1/approval-sla-policies' })

    systemJobHandlers.registerJobHandler(SystemJobName.APPROVAL_SLA_SWEEP, async () => {
        const { escalated, breached } = await approvalSlaSweepService(app.log).run()
        if (escalated > 0 || breached > 0) {
            app.log.info({ escalated, breached }, '[APPROVAL_SLA_SWEEP] processed due approvals')
        }
    })
    rejectedPromiseHandler(systemJobsSchedule(app.log).upsertJob({
        job: {
            name: SystemJobName.APPROVAL_SLA_SWEEP,
            data: {},
            jobId: SystemJobName.APPROVAL_SLA_SWEEP,
        },
        schedule: {
            type: 'repeated',
            cron: '* * * * *',
        },
    }), app.log)
}
