import { ProjectMigrationResourceType, ProjectReleaseType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Project Migration Precheck API', () => {
    it('should return an empty grouped report for two empty projects', async () => {
        const ctx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })
        const sourceCtx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })

        const response = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: sourceCtx.project.id,
            targetProjectId: ctx.project.id,
            snapshotToken: null,
            resourceType: ProjectMigrationResourceType.FLOW,
            cursor: null,
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json()
        expect(body.summary.sourceProjectId).toBe(sourceCtx.project.id)
        expect(body.summary.targetProjectId).toBe(ctx.project.id)
        expect(body.summary.snapshotToken).toBeTruthy()
        expect(body.summary.snapshotToken.startsWith('apm1.')).toBe(true)
        expect(body.summary.totals.FLOW.total).toBe(0)
        expect(body.summary.hasBlockers).toBe(false)
        expect(body.page.data).toHaveLength(0)
        expect(body.page.nextCursor).toBeNull()
    })

    it('should page with the snapshot token and keep the same signed snapshot', async () => {
        const ctx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })
        const sourceCtx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })

        const firstResponse = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: sourceCtx.project.id,
            targetProjectId: ctx.project.id,
            snapshotToken: null,
            resourceType: ProjectMigrationResourceType.TABLE,
            cursor: null,
        })
        const firstBody = firstResponse?.json()
        expect(firstBody.summary.totals.TABLE.total).toBe(0)

        const secondResponse = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: sourceCtx.project.id,
            targetProjectId: ctx.project.id,
            snapshotToken: firstBody.summary.snapshotToken,
            resourceType: ProjectMigrationResourceType.TABLE,
            cursor: null,
        })
        expect(secondResponse?.statusCode).toBe(StatusCodes.OK)
        const secondBody = secondResponse?.json()
        expect(secondBody.summary.snapshotToken).toBe(firstBody.summary.snapshotToken)
        expect(secondBody.summary.totals.TABLE.total).toBe(0)
    })

    it('should strictly use the signed snapshot and ignore changes made to the live target afterwards', async () => {
        const ctx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })
        const sourceCtx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })

        await sourceCtx.post('/v1/flows', {
            displayName: 'Source Flow',
            projectId: sourceCtx.project.id,
        }, { query: { projectId: sourceCtx.project.id } })

        const precheckResponse = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: sourceCtx.project.id,
            targetProjectId: ctx.project.id,
            snapshotToken: null,
            resourceType: ProjectMigrationResourceType.FLOW,
            cursor: null,
        })
        const snapshotToken = precheckResponse?.json().summary.snapshotToken

        // The target project changes after the snapshot was taken.
        await ctx.post('/v1/flows', {
            displayName: 'Late Target Flow',
            projectId: ctx.project.id,
        }, { query: { projectId: ctx.project.id } })

        const diffResponse = await ctx.post('/v1/project-releases/diff', {
            projectId: ctx.project.id,
            type: ProjectReleaseType.PROJECT,
            targetProjectId: sourceCtx.project.id,
            snapshotToken,
        })

        expect(diffResponse?.statusCode).toBe(StatusCodes.OK)
        const body = diffResponse?.json()
        expect(body.flows.some((flow: { flow: { displayName: string } }) => flow.flow.displayName === 'Late Target Flow')).toBe(false)
        expect(body.flows.some((flow: { flow: { displayName: string } }) => flow.flow.displayName === 'Source Flow')).toBe(true)
    })

    it('should reject a signed snapshot token when the target project changes', async () => {
        const ctx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })
        const sourceCtx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })
        const otherTargetCtx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })

        const precheckResponse = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: sourceCtx.project.id,
            targetProjectId: ctx.project.id,
            snapshotToken: null,
            resourceType: ProjectMigrationResourceType.FLOW,
            cursor: null,
        })
        const snapshotToken = precheckResponse?.json().summary.snapshotToken

        const response = await otherTargetCtx.post('/v1/project-releases/migration-precheck', {
            projectId: otherTargetCtx.project.id,
            sourceProjectId: sourceCtx.project.id,
            targetProjectId: otherTargetCtx.project.id,
            snapshotToken,
            resourceType: ProjectMigrationResourceType.FLOW,
            cursor: null,
        })

        expect([StatusCodes.BAD_REQUEST, StatusCodes.FORBIDDEN]).toContain(response?.statusCode)
    })

    it('should accept the snapshot token on the project diff endpoint', async () => {
        const ctx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })
        const sourceCtx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })

        const precheckResponse = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: sourceCtx.project.id,
            targetProjectId: ctx.project.id,
            snapshotToken: null,
            resourceType: ProjectMigrationResourceType.FLOW,
            cursor: null,
        })
        const snapshotToken = precheckResponse?.json().summary.snapshotToken

        const diffResponse = await ctx.post('/v1/project-releases/diff', {
            projectId: ctx.project.id,
            type: ProjectReleaseType.PROJECT,
            targetProjectId: sourceCtx.project.id,
            snapshotToken,
        })

        expect(diffResponse?.statusCode).toBe(StatusCodes.OK)
        const body = diffResponse?.json()
        expect(body.flows).toHaveLength(0)
        expect(body.tables).toHaveLength(0)
        expect(body.folders).toHaveLength(0)
    })

    it('should reject a precheck without a source project or snapshot token', async () => {
        const ctx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })

        const response = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: null,
            targetProjectId: ctx.project.id,
            snapshotToken: null,
            resourceType: null,
            cursor: null,
        })

        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('should reject identical source and target projects', async () => {
        const ctx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })

        const response = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: ctx.project.id,
            targetProjectId: ctx.project.id,
            snapshotToken: null,
            resourceType: ProjectMigrationResourceType.FLOW,
            cursor: null,
        })

        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('should reject source and target projects from another platform', async () => {
        const ctx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })
        const otherPlatformCtx = await createTestContext(app!, {
            project: { releasesEnabled: true },
            plan: { environmentsEnabled: true },
        })

        const response = await ctx.post('/v1/project-releases/migration-precheck', {
            projectId: ctx.project.id,
            sourceProjectId: otherPlatformCtx.project.id,
            targetProjectId: ctx.project.id,
            snapshotToken: null,
            resourceType: ProjectMigrationResourceType.FLOW,
            cursor: null,
        })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
