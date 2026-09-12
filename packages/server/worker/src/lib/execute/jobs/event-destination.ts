import { tryCatch } from '@activepieces/core-utils'
import { safeHttp } from '@activepieces/server-utils'
import { EngineResponseStatus, EventDestinationJobData, WorkerJobType } from '@activepieces/shared'
import { workerSettings } from '../../config/worker-settings'
import { FireAndForgetJobResult, JobContext, JobHandler, JobResultKind } from '../types'

export const eventDestinationJob: JobHandler<EventDestinationJobData, FireAndForgetJobResult> = {
    jobType: WorkerJobType.EVENT_DESTINATION,
    async execute(ctx: JobContext, data: EventDestinationJobData): Promise<FireAndForgetJobResult> {
        const timeoutInSeconds = workerSettings.getSettings().EVENT_DESTINATION_TIMEOUT_SECONDS

        let success = true
        let httpStatus: number | undefined
        let errorMessage: string | undefined

        const { data: response, error } = await tryCatch(() => safeHttp.axios.request({
            url: data.webhookUrl,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            data: data.payload,
            timeout: timeoutInSeconds * 1000,
            validateStatus: () => true,
        }))

        if (error !== null) {
            success = false
            errorMessage = error.message
            ctx.log.error({
                webhookUrl: data.webhookUrl,
                webhook: { id: data.webhookId },
                error: error.message,
            }, 'Event destination delivery failed before reaching the destination')
        }
        else if (response.status >= MIN_FAILURE_HTTP_STATUS) {
            success = false
            httpStatus = response.status
            ctx.log.error({
                webhookUrl: data.webhookUrl,
                webhook: { id: data.webhookId },
                response: { status: response.status },
            }, 'Event destination responded with a failure status')
        }

        // Failure-routing deliveries carry an id; report the outcome so it leaves PENDING.
        // The RPC itself is fire-and-forget: a reporting failure never fails the job or
        // blocks the run — the delivery simply stays PENDING and remains queryable.
        if (data.failureDeliveryId && data.platformId && data.projectId) {
            const failureDeliveryId = data.failureDeliveryId
            const { error: reportError } = await tryCatch(() => ctx.apiClient.reportFailureDeliveryResult({
                deliveryId: failureDeliveryId,
                platformId: data.platformId,
                projectId: data.projectId,
                success,
                httpStatus,
                errorMessage,
            }))
            if (reportError !== null) {
                ctx.log.error({
                    delivery: { id: failureDeliveryId },
                    error: reportError.message,
                }, 'Failed to report failure delivery result back to the API')
            }
        }

        return { kind: JobResultKind.FIRE_AND_FORGET, status: EngineResponseStatus.OK }
    },
}

const MIN_FAILURE_HTTP_STATUS = 400
