import { DefaultProjectRole, FlowTriggerType, VariableType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { describeWithAuth } from '../../../helpers/describe-with-auth'
import { createMockFlow, createMockFlowVersion } from '../../../helpers/mocks'
import { createMemberContext, createServiceContext, createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Variable API', () => {
    describeWithAuth('POST /v1/variables (Create)', () => app!, (setup) => {
        it('should default to SECRET type and never return the value', async () => {
            const ctx = await setup()

            const response = await ctx.post('/v1/variables', {
                projectId: ctx.project.id,
                name: 'MY_SECRET',
                value: 'super-secret',
            })

            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            const body = response?.json()
            expect(body.type).toBe(VariableType.SECRET)
            expect(body.value).toBeUndefined()
        })

        it('should return the value for TEXT variables', async () => {
            const ctx = await setup()

            const response = await ctx.post('/v1/variables', {
                projectId: ctx.project.id,
                name: 'MY_TEXT',
                type: VariableType.TEXT,
                value: 'plain-value',
            })

            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            const body = response?.json()
            expect(body.type).toBe(VariableType.TEXT)
            expect(body.value).toBe('plain-value')
        })
    })

    describeWithAuth('GET /v1/variables (List)', () => app!, (setup) => {
        it('should only expose values of TEXT variables', async () => {
            const ctx = await setup()
            await seedVariable(ctx, { name: 'SECRET_ONE', value: 'shhh' })
            await seedVariable(ctx, { name: 'TEXT_ONE', value: 'hello', type: VariableType.TEXT })

            const response = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                includeValues: 'true',
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.data).toHaveLength(2)
            const secret = body.data.find((v: { name: string }) => v.name === 'SECRET_ONE')
            const text = body.data.find((v: { name: string }) => v.name === 'TEXT_ONE')
            expect(secret.value).toBeUndefined()
            expect(secret.usedInFlows).toBe(false)
            expect(text.value).toBe('hello')
            expect(text.usedInFlows).toBe(false)
        })

        it('should omit values from the list unless they are requested', async () => {
            const ctx = await setup()
            await seedVariable(ctx, { name: 'TEXT_ONE', value: 'hello', type: VariableType.TEXT })

            const response = await ctx.get('/v1/variables', { projectId: ctx.project.id })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json().data).toHaveLength(1)
            expect(response?.json().data[0].type).toBe(VariableType.TEXT)
            expect(response?.json().data[0].value).toBeUndefined()
        })

        it('should filter by type', async () => {
            const ctx = await setup()
            await seedVariable(ctx, { name: 'SECRET_ONE', value: 'shhh' })
            await seedVariable(ctx, { name: 'TEXT_ONE', value: 'hello', type: VariableType.TEXT })

            const secretOnly = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                type: [VariableType.SECRET],
            })
            expect(secretOnly?.json().data.map((v: { name: string }) => v.name)).toEqual(['SECRET_ONE'])

            const textOnly = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                type: [VariableType.TEXT],
            })
            expect(textOnly?.json().data.map((v: { name: string }) => v.name)).toEqual(['TEXT_ONE'])

            const both = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                type: [VariableType.SECRET, VariableType.TEXT],
            })
            expect(both?.json().data).toHaveLength(2)
        })

        it('should filter by name', async () => {
            const ctx = await setup()
            await seedVariable(ctx, { name: 'STRIPE_KEY', value: 'shhh' })
            await seedVariable(ctx, { name: 'SLACK_TOKEN', value: 'shhh' })

            const response = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                name: 'stripe',
            })

            expect(response?.json().data.map((v: { name: string }) => v.name)).toEqual(['STRIPE_KEY'])
        })

        it('should filter by updated time', async () => {
            const ctx = await setup()
            await seedVariable(ctx, { name: 'MY_SECRET', value: 'shhh' })

            const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
            const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()

            const afterFuture = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                updatedAfter: future,
            })
            expect(afterFuture?.json().data).toHaveLength(0)

            const afterPast = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                updatedAfter: past,
            })
            expect(afterPast?.json().data).toHaveLength(1)

            const beforePast = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                updatedBefore: past,
            })
            expect(beforePast?.json().data).toHaveLength(0)

            const between = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                updatedAfter: past,
                updatedBefore: future,
            })
            expect(between?.json().data).toHaveLength(1)
        })

        it('should mark and filter variables used in flows', async () => {
            const ctx = await setup()
            await seedVariable(ctx, { name: 'USED_VAR', value: 'shhh' })
            await seedVariable(ctx, { name: 'IDLE_VAR', value: 'shhh' })
            await seedFlowReferencingVariable(ctx, 'USED_VAR')

            const response = await ctx.get('/v1/variables', { projectId: ctx.project.id })

            const data = response?.json().data
            const used = data.find((v: { name: string }) => v.name === 'USED_VAR')
            const idle = data.find((v: { name: string }) => v.name === 'IDLE_VAR')
            expect(used.usedInFlows).toBe(true)
            expect(idle.usedInFlows).toBe(false)

            const usedOnly = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                usedInFlows: ['true'],
            })
            expect(usedOnly?.json().data.map((v: { name: string }) => v.name)).toEqual(['USED_VAR'])

            const unusedOnly = await ctx.get('/v1/variables', {
                projectId: ctx.project.id,
                usedInFlows: ['false'],
            })
            expect(unusedOnly?.json().data.map((v: { name: string }) => v.name)).toEqual(['IDLE_VAR'])
        })

        it('should not leak variables from other projects', async () => {
            const ctx = await setup()
            const otherCtx = await createTestContext(app!)
            await seedVariable(ctx, { name: 'MINE', value: 'shhh' })
            await seedVariable(otherCtx, { name: 'THEIRS', value: 'shhh' })

            const response = await ctx.get('/v1/variables', { projectId: ctx.project.id })

            expect(response?.json().data.map((v: { name: string }) => v.name)).toEqual(['MINE'])
        })
    })

    describeWithAuth('POST /v1/variables/:id (Update)', () => app!, (setup) => {
        it('should change the type from SECRET to TEXT', async () => {
            const ctx = await setup()
            const id = await seedVariable(ctx, { name: 'MY_SECRET', value: 'now-visible' })

            const response = await ctx.post(`/v1/variables/${id}`, { type: VariableType.TEXT })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json().type).toBe(VariableType.TEXT)
            expect(response?.json().value).toBe('now-visible')
        })
    })

    describe('POST /v1/variables/:id (Rotate value)', () => {
        it('should rotate the value of a SECRET variable without exposing it', async () => {
            const ctx = await createTestContext(app!)
            const id = await seedVariable(ctx, { name: 'MY_SECRET', value: 'old' })

            const response = await ctx.post(`/v1/variables/${id}`, { value: 'new' })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json().value).toBeUndefined()

            const reveal = await ctx.post(`/v1/variables/${id}/reveal`, {})
            expect(reveal?.json().value).toBe('new')
        })
    })

    describe('Permissions', () => {
        it('should allow a viewer to list variables', async () => {
            const ctx = await createTestContext(app!)
            await seedVariable(ctx, { name: 'MY_SECRET', value: 'shhh' })
            const viewerCtx = await createMemberContext(app!, ctx, {
                projectRole: DefaultProjectRole.VIEWER,
            })

            const response = await viewerCtx.get('/v1/variables', { projectId: ctx.project.id })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json().data).toHaveLength(1)
            expect(response?.json().data[0].value).toBeUndefined()
        })

        it('should forbid a viewer from creating, updating, deleting and revealing', async () => {
            const ctx = await createTestContext(app!)
            const id = await seedVariable(ctx, { name: 'MY_SECRET', value: 'shhh' })
            const viewerCtx = await createMemberContext(app!, ctx, {
                projectRole: DefaultProjectRole.VIEWER,
            })

            const createResponse = await viewerCtx.post('/v1/variables', {
                projectId: ctx.project.id,
                name: 'NEW_VAR',
                value: 'shhh',
            })
            expect(createResponse?.statusCode).toBe(StatusCodes.FORBIDDEN)

            const updateResponse = await viewerCtx.post(`/v1/variables/${id}`, { value: 'new' })
            expect(updateResponse?.statusCode).toBe(StatusCodes.FORBIDDEN)

            const deleteResponse = await viewerCtx.delete(`/v1/variables/${id}`)
            expect(deleteResponse?.statusCode).toBe(StatusCodes.FORBIDDEN)

            const revealResponse = await viewerCtx.post(`/v1/variables/${id}/reveal`, {})
            expect(revealResponse?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })

        it('should allow an editor to reveal a SECRET variable value', async () => {
            const ctx = await createTestContext(app!)
            const id = await seedVariable(ctx, { name: 'MY_SECRET', value: 'shhh' })
            const editorCtx = await createMemberContext(app!, ctx, {
                projectRole: DefaultProjectRole.EDITOR,
            })

            const response = await editorCtx.post(`/v1/variables/${id}/reveal`, {})

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json().value).toBe('shhh')
        })

        it('should forbid a service key from revealing values', async () => {
            const ctx = await createTestContext(app!)
            const id = await seedVariable(ctx, { name: 'MY_SECRET', value: 'shhh' })
            const serviceCtx = await createServiceContext(app!, ctx)

            const response = await serviceCtx.post(`/v1/variables/${id}/reveal`, {})

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })
    })
})

async function seedVariable(
    ctx: Awaited<ReturnType<typeof createTestContext>>,
    params: { name: string, value: string, type?: VariableType },
): Promise<string> {
    const response = await ctx.post('/v1/variables', {
        projectId: ctx.project.id,
        name: params.name,
        type: params.type,
        value: params.value,
    })
    expect(response?.statusCode).toBe(StatusCodes.CREATED)
    return response?.json().id
}

async function seedFlowReferencingVariable(
    ctx: Awaited<ReturnType<typeof createTestContext>>,
    variableName: string,
): Promise<void> {
    const flow = createMockFlow({ projectId: ctx.project.id })
    await db.save('flow', flow)
    const flowVersion = createMockFlowVersion({
        flowId: flow.id,
        updatedBy: ctx.user.id,
        trigger: {
            type: FlowTriggerType.EMPTY,
            name: 'trigger',
            settings: {
                note: `{{variables['${variableName}']}}`,
            },
            valid: false,
            displayName: 'Trigger',
            lastUpdatedDate: new Date().toISOString(),
        },
    })
    await db.save('flow_version', flowVersion)
    await db.update('flow', flow.id, { publishedVersionId: flowVersion.id })
}
