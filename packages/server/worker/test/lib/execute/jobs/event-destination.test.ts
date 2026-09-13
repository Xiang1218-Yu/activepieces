import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EngineResponseStatus, EventDestinationJobData, WorkerJobType } from '@activepieces/shared'

const requestMock = vi.fn()

vi.mock('@activepieces/server-utils', () => ({
    safeHttp: {
        axios: {
            request: (...args: unknown[]) => requestMock(...args),
        },
    },
}))

vi.mock('../../../../src/lib/config/worker-settings', () => ({
    workerSettings: {
        getSettings: vi.fn().mockReturnValue({ EVENT_DESTINATION_TIMEOUT_SECONDS: 10 }),
    },
}))

import { eventDestinationJob } from '../../../../src/lib/execute/jobs/event-destination'
import { JobContext, JobResultKind } from '../../../../src/lib/execute/types'

const baseData = (overrides: Partial<EventDestinationJobData> = {}): EventDestinationJobData => ({
    schemaVersion: 1,
    platformId: 'platform-1',
    projectId: 'project-1',
    webhookId: 'webhook-1',
    webhookUrl: 'https://example.com/hook',
    payload: { hello: 'world' },
    jobType: WorkerJobType.EVENT_DESTINATION,
    ...overrides,
})

const makeContext = (): JobContext => ({
    apiClient: {
        reportFailureDeliveryResult: vi.fn(),
    } as never,
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as never,
} as never)

beforeEach(() => {
    vi.clearAllMocks()
})

describe('eventDestinationJob', () => {
    it('reports a failed delivery (HTTP 500) back to the API so it does not stay PENDING', async () => {
        requestMock.mockResolvedValue({ status: 500 })
        const ctx = makeContext()
        const data = baseData({ failureDeliveryId: 'delivery-1' })

        const result = await eventDestinationJob.execute(ctx, data)

        expect(result).toEqual({ kind: JobResultKind.FIRE_AND_FORGET, status: EngineResponseStatus.OK })
        expect(ctx.apiClient.reportFailureDeliveryResult).toHaveBeenCalledTimes(1)
        expect(ctx.apiClient.reportFailureDeliveryResult).toHaveBeenCalledWith({
            deliveryId: 'delivery-1',
            platformId: 'platform-1',
            projectId: 'project-1',
            success: false,
            httpStatus: 500,
            errorMessage: undefined,
        })
    })

    it('reports a transport error (destination unreachable) as a failed delivery', async () => {
        requestMock.mockRejectedValue(new Error('ECONNREFUSED'))
        const ctx = makeContext()
        const data = baseData({ failureDeliveryId: 'delivery-2' })

        await eventDestinationJob.execute(ctx, data)

        expect(ctx.apiClient.reportFailureDeliveryResult).toHaveBeenCalledWith(expect.objectContaining({
            deliveryId: 'delivery-2',
            success: false,
            errorMessage: 'ECONNREFUSED',
        }))
    })

    it('reports success for a 2xx response', async () => {
        requestMock.mockResolvedValue({ status: 204 })
        const ctx = makeContext()
        const data = baseData({ failureDeliveryId: 'delivery-3' })

        await eventDestinationJob.execute(ctx, data)

        expect(ctx.apiClient.reportFailureDeliveryResult).toHaveBeenCalledWith(expect.objectContaining({
            deliveryId: 'delivery-3',
            success: true,
        }))
    })

    it('does not call back for regular event-destination jobs without a failureDeliveryId', async () => {
        requestMock.mockResolvedValue({ status: 200 })
        const ctx = makeContext()

        await eventDestinationJob.execute(ctx, baseData())

        expect(ctx.apiClient.reportFailureDeliveryResult).not.toHaveBeenCalled()
    })

    it('always returns OK even when reporting back fails, so the run is never blocked', async () => {
        requestMock.mockResolvedValue({ status: 500 })
        const ctx: JobContext = {
            apiClient: {
                reportFailureDeliveryResult: vi.fn().mockRejectedValue(new Error('rpc down')),
            } as never,
            log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as never,
        } as never

        const result = await eventDestinationJob.execute(ctx, baseData({ failureDeliveryId: 'delivery-4' }))

        expect(result.status).toBe(EngineResponseStatus.OK)
    })
})
