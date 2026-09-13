import { FlowRunStatus, RunEnvironment } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { databaseConnection } from '../../../../../src/app/database/database-connection'
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

    it('pages failure-rate buckets over real runs, newest first, with an exclusive cursor', async () => {
        const ctx = await setup()
        const projectId = ctx.project.id

        await seedRunsForProject(projectId)

        const windowFrom = new Date()
        windowFrom.setUTCDate(windowFrom.getUTCDate() - 8)
        windowFrom.setUTCHours(0, 0, 0, 0)
        const windowTo = new Date()
        windowTo.setUTCDate(windowTo.getUTCDate() + 1)
        windowTo.setUTCHours(0, 0, 0, 0)

        const firstPage = await ctx.get('/v1/flow-runs/failure-rate', {
            projectId,
            createdAfter: windowFrom.toISOString(),
            createdBefore: windowTo.toISOString(),
            interval: 'DAY',
            limit: 2,
        })

        expect(firstPage?.statusCode).toBe(200)
        const firstBody = firstPage?.json()
        expect(firstBody.buckets).toHaveLength(2)

        expect(firstBody.buckets[0].bucketStart).toBe(utcDayStart(-2))
        const newestBucket = firstBody.buckets[0]
        expect(newestBucket.total).toBe(2)
        expect(newestBucket.failed).toBe(1)
        expect(newestBucket.succeeded).toBe(1)
        expect(newestBucket.other).toBe(0)
        expect(newestBucket.failureRate).toBeCloseTo(0.5, 5)

        expect(firstBody.buckets[1].bucketStart).toBe(utcDayStart(-4))
        const middleBucket = firstBody.buckets[1]
        expect(middleBucket.total).toBe(3)
        expect(middleBucket.failed).toBe(1)
        expect(middleBucket.succeeded).toBe(2)
        expect(middleBucket.failureRate).toBeCloseTo(1 / 3, 5)

        expect(new Date(firstBody.next).getTime()).toBeLessThan(
            new Date(newestBucket.bucketStart).getTime(),
        )
        expect(firstBody.next).toBe(middleBucket.bucketStart)

        const secondPage = await ctx.get('/v1/flow-runs/failure-rate', {
            projectId,
            createdAfter: windowFrom.toISOString(),
            createdBefore: windowTo.toISOString(),
            interval: 'DAY',
            limit: 2,
            cursor: firstBody.next,
        })

        expect(secondPage?.statusCode).toBe(200)
        const secondBody = secondPage?.json()
        expect(secondBody.buckets).toHaveLength(1)
        const oldestBucket = secondBody.buckets[0]
        expect(oldestBucket.bucketStart).toBe(utcDayStart(-6))
        expect(oldestBucket.total).toBe(3)
        expect(oldestBucket.failed).toBe(2)
        expect(oldestBucket.succeeded).toBe(0)
        expect(oldestBucket.other).toBe(1)
        expect(oldestBucket.failureRate).toBeCloseTo(2 / 3, 5)
        expect(secondBody.next).toBeNull()

        expect(
            new Date(oldestBucket.bucketStart).getTime(),
        ).toBeLessThan(new Date(middleBucket.bucketStart).getTime())
    })
})

async function seedRunsForProject(projectId: string): Promise<void> {
    await seedRunAtDayOffset(projectId, -2, FlowRunStatus.FAILED)
    await seedRunAtDayOffset(projectId, -2, FlowRunStatus.SUCCEEDED)
    await seedRunAtDayOffset(projectId, -4, FlowRunStatus.FAILED)
    await seedRunAtDayOffset(projectId, -4, FlowRunStatus.SUCCEEDED)
    await seedRunAtDayOffset(projectId, -4, FlowRunStatus.SUCCEEDED)
    await seedRunAtDayOffset(projectId, -6, FlowRunStatus.FAILED)
    await seedRunAtDayOffset(projectId, -6, FlowRunStatus.FAILED)
    await seedRunAtDayOffset(projectId, -6, FlowRunStatus.CANCELED)
}

async function seedRunAtDayOffset(projectId: string, dayOffset: number, status: FlowRunStatus): Promise<void> {
    const run = createMockFlowRun({
        projectId,
        status,
        environment: RunEnvironment.PRODUCTION,
    })
    await db.save('flow_run', run)

    const date = new Date()
    date.setUTCDate(date.getUTCDate() + dayOffset)
    date.setUTCHours(12, 0, 0, 0)
    await databaseConnection().query('UPDATE flow_run SET created = $1 WHERE id = $2', [
        date.toISOString(),
        run.id,
    ])
}

function utcDayStart(dayOffset: number): string {
    const date = new Date()
    date.setUTCDate(date.getUTCDate() + dayOffset)
    date.setUTCHours(0, 0, 0, 0)
    return date.toISOString().replace('.000Z', 'Z')
}

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
