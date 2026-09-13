import { RunEnvironment } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { db } from '../../../../helpers/db'
import { createMockFlowRun } from '../../../../helpers/mocks'
import { describeWithAuth } from '../../../../helpers/describe-with-auth'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describeWithAuth('Failure rate aggregation endpoint', () => app!, (setup) => {
    it('should reject requests without a time window', async () => {
        const ctx = await setup()

        const response = await ctx.get('/v1/flow-runs/failure-rate', {
            projectId: ctx.project.id,
        })

        expect([400, 409, 422]).toContain(response?.statusCode)
    })

    it('should return paginated empty buckets with a null cursor', async () => {
        const ctx = await setup()

        const response = await ctx.get('/v1/flow-runs/failure-rate', {
            projectId: ctx.project.id,
            createdAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            createdBefore: new Date().toISOString(),
            interval: 'DAY',
        })

        expect(response?.statusCode).toBe(200)
        const body = response?.json()
        expect(body.interval).toBe('DAY')
        expect(body.buckets).toEqual([])
        expect(body.next).toBeNull()
    })
})

describeWithAuth('Compare runs endpoint', () => app!, (setup) => {
    it('should require at least one run id', async () => {
        const ctx = await setup()

        const response = await ctx.get('/v1/flow-runs/compare', {
            projectId: ctx.project.id,
        })

        expect([400, 409, 422]).toContain(response?.statusCode)
    })

    it('should reject more than 10 runs', async () => {
        const ctx = await setup()
        const runIds = Array.from({ length: 11 }, (_, i) => `run${String(i).padStart(18, '0')}`)
        const queryString = runIds.map((id) => `flowRunIds=${id}`).join('&')

        const response = await ctx.inject({
            method: 'GET',
            url: `/api/v1/flow-runs/compare?projectId=${ctx.project.id}&${queryString}`,
        })

        expect([400, 409, 422]).toContain(response.statusCode)
    })

    it('should report unknown run ids as not found without leaking them as columns', async () => {
        const ctx = await setup()
        const unknownRunId = '0'.repeat(21)

        const response = await ctx.inject({
            method: 'GET',
            url: `/api/v1/flow-runs/compare?projectId=${ctx.project.id}&flowRunIds=${unknownRunId}`,
        })

        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body.columns).toEqual([])
        expect(body.notFoundRunIds).toEqual([unknownRunId])
    })

    it('should never include runs from another project, even when their id is known', async () => {
        const ctx = await setup()
        const foreignRun = createMockFlowRun({ environment: RunEnvironment.PRODUCTION })
        await db.save('flow_run', foreignRun)

        const response = await ctx.get('/v1/flow-runs/compare', {
            projectId: ctx.project.id,
            flowRunIds: [foreignRun.id],
        })

        expect(response?.statusCode).toBe(200)
        const body = response?.json()
        expect(body.columns).toEqual([])
        expect(body.notFoundRunIds).toEqual([foreignRun.id])
    })
})
