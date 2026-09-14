import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import { GitBranchType, GitPushOperationStatus, GitPushOperationType, PlatformRole, PrincipalType, PushTablesGitRepoRequest } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { vi } from 'vitest'

const commitAndPushMock = vi.fn()

vi.mock('../../../../src/app/ee/projects/project-release/git-sync/git-helper', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/app/ee/projects/project-release/git-sync/git-helper')>()
    return {
        ...actual,
        gitHelper: {
            ...actual.gitHelper,
            createGitRepoAndReturnPaths: vi.fn().mockImplementation(() => {
                const root = mkdtempSync(path.join(tmpdir(), 'git-push-test-'))
                const flowFolderPath = path.join(root, 'flows')
                const connectionsFolderPath = path.join(root, 'connections')
                const tablesFolderPath = path.join(root, 'tables')
                const stateFolderPath = path.join(root, 'state')
                for (const folder of [flowFolderPath, connectionsFolderPath, tablesFolderPath, stateFolderPath]) {
                    mkdirSync(folder, { recursive: true })
                }
                return Promise.resolve({
                    git: { addConfig: vi.fn() },
                    flowFolderPath,
                    connectionsFolderPath,
                    tablesFolderPath,
                    stateFolderPath,
                })
            }),
            commitAndPush: (...args: unknown[]): Promise<void> => commitAndPushMock(...args) as Promise<void>,
        },
    }
})

import { databaseConnection } from '../../../../src/app/database/database-connection'
import { gitPushOperationService } from '../../../../src/app/ee/projects/project-release/git-sync/git-push-operation.service'
import { generateMockToken } from '../../../helpers/auth'
import {
    createMockGitRepo,
    mockAndSaveBasicSetup,
} from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

function appOrThrow(): FastifyInstance {
    if (app === null) {
        throw new Error('test app is not initialized')
    }
    return app
}

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(() => {
    commitAndPushMock.mockReset()
    commitAndPushMock.mockResolvedValue(undefined)
})

afterEach(async () => {
    await databaseConnection().getRepository('git_push_operation').createQueryBuilder().delete().execute()
})

describe('Git Push Operations API', () => {
    async function setupRepo(): Promise<SetupRepoResult> {
        const { mockProject, mockOwner } = await mockAndSaveBasicSetup({
            platform: {},
            plan: { environmentsEnabled: true },
            user: { platformRole: PlatformRole.ADMIN },
        })
        const gitRepo = createMockGitRepo({
            projectId: mockProject.id,
            branchType: GitBranchType.DEVELOPMENT,
            branch: 'main',
        })
        await databaseConnection().getRepository('git_repo').save(gitRepo)
        const token = await generateMockToken({
            id: mockOwner.id,
            type: PrincipalType.USER,
            platform: { id: mockProject.platformId },
        })
        return { gitRepo, token, projectId: mockProject.id, ownerId: mockOwner.id }
    }

    function pushPayload(): PushTablePayload {
        return {
            type: GitPushOperationType.PUSH_TABLE,
            commitMessage: 'chore: test push',
            externalTableIds: ['table-1'],
        }
    }

    async function startPush(repoId: string, token: string): Promise<InjectResponse | undefined> {
        return app?.inject({
            method: 'POST',
            url: `/api/v1/git-repos/${repoId}/push-operations`,
            payload: pushPayload(),
            headers: { authorization: `Bearer ${token}` },
        })
    }

    async function getLatest(projectId: string, token: string): Promise<InjectResponse | undefined> {
        return app?.inject({
            method: 'GET',
            url: `/api/v1/git-repos/push-operations/latest?projectId=${projectId}`,
            headers: { authorization: `Bearer ${token}` },
        })
    }

    it('creates an IN_PROGRESS operation, deduplicates concurrent pushes, and reports success', async () => {
        const { gitRepo, token, projectId } = await setupRepo()
        let releasePush: () => void = () => undefined
        commitAndPushMock.mockImplementation((): Promise<void> => new Promise<void>((resolve) => {
            releasePush = (): void => {
                commitAndPushMock.mockResolvedValue(undefined)
                resolve()
            }
        }))

        const first = await startPush(gitRepo.id, token)
        expect(first?.statusCode).toBe(StatusCodes.CREATED)
        const firstBody = first?.json()
        expect(firstBody.status).toBe(GitPushOperationStatus.IN_PROGRESS)

        const duplicate = await startPush(gitRepo.id, token)
        expect(duplicate?.statusCode).toBe(StatusCodes.CONFLICT)
        expect(duplicate?.json().code).toBe(ErrorCode.GIT_PUSH_IN_PROGRESS)

        const latestResponse = await getLatest(projectId, token)
        expect(latestResponse?.statusCode).toBe(StatusCodes.OK)
        expect(latestResponse?.json().id).toBe(firstBody.id)

        releasePush()
        await waitForLatestStatus(projectId, GitPushOperationStatus.SUCCEEDED)

        const afterSuccess = await getLatest(projectId, token)
        const body = afterSuccess?.json()
        expect(body.status).toBe(GitPushOperationStatus.SUCCEEDED)
        expect(body.finishedAt).toBeTruthy()
        expect(body.failureReason).toBeNull()
        expect(body.gitRepoId).toBe(gitRepo.id)

        const second = await startPush(gitRepo.id, token)
        expect(second?.statusCode).toBe(StatusCodes.CREATED)
        await waitForLatestStatus(projectId, GitPushOperationStatus.SUCCEEDED)
    })

    it('classifies a non-fast-forward push as CONFLICT and recovers through retry', async () => {
        const { gitRepo, token, projectId } = await setupRepo()
        commitAndPushMock.mockRejectedValueOnce(
            new ActivepiecesError({
                code: ErrorCode.GIT_PUSH_CONFLICT,
                params: { message: 'Updates were rejected (non-fast-forward), fetch first' },
            }),
        ).mockResolvedValueOnce(undefined)

        const created = await startPush(gitRepo.id, token)
        expect(created?.statusCode).toBe(StatusCodes.CREATED)
        const failed = await waitForLatestStatus(projectId, GitPushOperationStatus.FAILED)
        expect(failed.failureReason).toBe('CONFLICT')
        expect(failed.errorMessage).toContain('non-fast-forward')

        const retry = await app?.inject({
            method: 'POST',
            url: `/api/v1/git-repos/push-operations/${failed.id}/retry`,
            headers: { authorization: `Bearer ${token}` },
        })
        expect(retry?.statusCode).toBe(StatusCodes.CREATED)
        expect(retry?.json().status).toBe(GitPushOperationStatus.IN_PROGRESS)
        const recovered = await waitForLatestStatus(projectId, GitPushOperationStatus.SUCCEEDED)
        expect(recovered.id).not.toBe(failed.id)
    })

    it('classifies an SSH authentication failure as AUTHENTICATION_FAILED', async () => {
        const { gitRepo, token, projectId } = await setupRepo()
        commitAndPushMock.mockRejectedValue(
            new ActivepiecesError({
                code: ErrorCode.INVALID_GIT_CREDENTIALS,
                params: { message: 'git@github.com: Permission denied (publickey).' },
            }),
        )

        const created = await startPush(gitRepo.id, token)
        expect(created?.statusCode).toBe(StatusCodes.CREATED)
        const failed = await waitForLatestStatus(projectId, GitPushOperationStatus.FAILED)
        expect(failed.failureReason).toBe('AUTHENTICATION_FAILED')
        expect(failed.errorMessage).toContain('Permission denied')
    })

    it('returns null latest operation when the project never pushed', async () => {
        const { token, projectId } = await setupRepo()
        const response = await getLatest(projectId, token)
        expect(response?.statusCode).toBe(StatusCodes.OK)
        expect(response?.json()).toBeNull()
    })

    it('marks IN_PROGRESS operations as interrupted on startup recovery', async () => {
        const { projectId, gitRepo, ownerId } = await setupRepo()
        await gitPushOperationService(appOrThrow().log).start({
            projectId,
            gitRepoId: gitRepo.id,
            userId: ownerId,
            request: pushPayload(),
        })
        await waitForLatestStatus(projectId, GitPushOperationStatus.SUCCEEDED)

        await databaseConnection().getRepository('git_push_operation').createQueryBuilder()
            .update()
            .set({
                status: GitPushOperationStatus.IN_PROGRESS,
                finishedAt: null,
            })
            .where('projectId = :projectId', { projectId })
            .execute()

        await gitPushOperationService(appOrThrow().log).markInterruptedOnStartup()

        const latest = await databaseConnection().getRepository('git_push_operation').findOneOrFail({
            where: { projectId },
            order: { created: 'DESC' },
        })
        expect(latest.status).toBe(GitPushOperationStatus.FAILED)
        expect(latest.failureReason).toBe('UNKNOWN')
    })
})

type LatestOperationSnapshot = {
    id: string
    status: string
    failureReason: string | null
    errorMessage: string | null
}

type SetupRepoResult = {
    gitRepo: ReturnType<typeof createMockGitRepo>
    token: string
    projectId: string
    ownerId: string
}

type PushTablePayload = PushTablesGitRepoRequest

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>

async function waitForLatestStatus(projectId: string, status: GitPushOperationStatus, retries = 40): Promise<LatestOperationSnapshot> {
    const repository = databaseConnection().getRepository('git_push_operation')
    for (let attempt = 0; attempt < retries; attempt++) {
        const operation = await repository.findOne({
            where: { projectId },
            order: { created: 'DESC' },
        })
        if (operation?.status === status) {
            return {
                id: operation.id,
                status: operation.status,
                failureReason: operation.failureReason ?? null,
                errorMessage: operation.errorMessage ?? null,
            }
        }
        if (operation?.status === GitPushOperationStatus.FAILED) {
            throw new Error(`operation failed: ${operation.failureReason} ${operation.errorMessage}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`latest operation did not reach status ${status}`)
}
