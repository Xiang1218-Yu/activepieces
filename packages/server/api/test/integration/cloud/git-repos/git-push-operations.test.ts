import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import { GitBranchType, GitPushOperationStatus, GitPushOperationType, PlatformRole, PrincipalType, ProjectReleaseType, PushTablesGitRepoRequest } from '@activepieces/shared'
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
    createMockFile,
    createMockGitRepo,
    createMockProjectRelease,
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
        const { mockProject, mockOwner, mockPlatform } = await mockAndSaveBasicSetup({
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
        return {
            gitRepo,
            token,
            projectId: mockProject.id,
            ownerId: mockOwner.id,
            platformId: mockPlatform.id,
        }
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

    it('classifies a generic remote refusal as REMOTE_REJECTED', async () => {
        const { gitRepo, token, projectId } = await setupRepo()
        commitAndPushMock.mockRejectedValue(
            new ActivepiecesError({
                code: ErrorCode.GIT_PUSH_FAILED,
                params: { message: 'remote: error: GH006: protected branch hook declined' },
            }),
        )

        const created = await startPush(gitRepo.id, token)
        expect(created?.statusCode).toBe(StatusCodes.CREATED)
        const failed = await waitForLatestStatus(projectId, GitPushOperationStatus.FAILED)
        expect(failed.failureReason).toBe('REMOTE_REJECTED')
        expect(failed.errorMessage).toContain('protected branch')
    })

    it('keeps operation history when the git repo is deleted and refuses retry as NOT_CONFIGURED', async () => {
        const { gitRepo, token, projectId } = await setupRepo()
        commitAndPushMock.mockRejectedValueOnce(
            new ActivepiecesError({
                code: ErrorCode.GIT_PUSH_CONFLICT,
                params: { message: 'non-fast-forward' },
            }),
        )
        const created = await startPush(gitRepo.id, token)
        expect(created?.statusCode).toBe(StatusCodes.CREATED)
        const failed = await waitForLatestStatus(projectId, GitPushOperationStatus.FAILED)
        expect(failed.failureReason).toBe('CONFLICT')

        await databaseConnection().getRepository('git_repo').delete({ id: gitRepo.id })

        const history = await getLatest(projectId, token)
        const historyBody = history?.json()
        expect(history?.statusCode).toBe(StatusCodes.OK)
        expect(historyBody.id).toBe(failed.id)
        expect(historyBody.gitRepoId).toBeNull()

        const retry = await appOrThrow().inject({
            method: 'POST',
            url: `/api/v1/git-repos/push-operations/${failed.id}/retry`,
            headers: { authorization: `Bearer ${token}` },
        })
        expect(retry.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(retry.json().code).toBe(ErrorCode.GIT_REPO_NOT_CONFIGURED)
    })

    it('returns 404 when starting a push against a missing git repo', async () => {
        const { token } = await setupRepo()
        const response = await appOrThrow().inject({
            method: 'POST',
            url: `/api/v1/git-repos/${'nonExistingRepoId'}/push-operations`,
            payload: pushPayload(),
            headers: { authorization: `Bearer ${token}` },
        })
        expect(response.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('prevents a second instance starting a push while one is IN_PROGRESS (cross-instance)', async () => {
        const { projectId, gitRepo, ownerId } = await setupRepo()
        commitAndPushMock.mockImplementation((): Promise<void> => new Promise<void>(() => undefined))

        await gitPushOperationService(appOrThrow().log).start({
            projectId,
            gitRepoId: gitRepo.id,
            userId: ownerId,
            request: pushPayload(),
        })

        await expect(gitPushOperationService(appOrThrow().log).start({
            projectId,
            gitRepoId: gitRepo.id,
            userId: ownerId,
            request: pushPayload(),
        })).rejects.toMatchObject({ error: { code: ErrorCode.GIT_PUSH_IN_PROGRESS } })
    })

    it('recovers the in-progress operation and remote target after a page refresh', async () => {
        const { gitRepo, token, projectId } = await setupRepo()
        let releasePush: () => void = () => undefined
        commitAndPushMock.mockImplementation((): Promise<void> => new Promise<void>((resolve) => {
            releasePush = resolve
        }))

        const created = await startPush(gitRepo.id, token)
        const createdBody = created?.json()

        const firstFetch = await getLatest(projectId, token)
        const firstBody = firstFetch?.json()
        expect(firstBody.status).toBe(GitPushOperationStatus.IN_PROGRESS)
        expect(firstBody.id).toBe(createdBody.id)
        expect(firstBody.gitRepoId).toBe(gitRepo.id)
        expect(firstBody.releaseName).toBeNull()

        const secondFetch = await getLatest(projectId, token)
        expect(secondFetch?.json().status).toBe(GitPushOperationStatus.IN_PROGRESS)

        releasePush()

        const finalBody = await pollLatest(() => getLatest(projectId, token), GitPushOperationStatus.SUCCEEDED)
        expect(finalBody.gitRepoId).toBe(gitRepo.id)
        expect(finalBody.finishedAt).toBeTruthy()
    })

    it('persists the explicit release id and name with the push operation', async () => {
        const { gitRepo, token, projectId, ownerId, platformId } = await setupRepo()
        const release = await saveProjectRelease({
            projectId,
            ownerId,
            platformId,
            name: 'Release 42',
        })

        const response = await appOrThrow().inject({
            method: 'POST',
            url: `/api/v1/git-repos/${gitRepo.id}/push-operations`,
            payload: { ...pushPayload(), releaseId: release.id },
            headers: { authorization: `Bearer ${token}` },
        })
        expect(response.statusCode).toBe(StatusCodes.CREATED)
        const operation = await waitForLatestStatus(projectId, GitPushOperationStatus.SUCCEEDED)
        expect(operation.releaseId).toBe(release.id)
        expect(operation.releaseName).toBe('Release 42')

        const afterRefresh = await getLatest(projectId, token)
        const body = afterRefresh?.json()
        expect(body.releaseId).toBe(release.id)
        expect(body.releaseName).toBe('Release 42')
    })

    it('resolves the current release automatically when no releaseId is provided', async () => {
        const { gitRepo, token, projectId, ownerId, platformId } = await setupRepo()
        const older = await saveProjectRelease({ projectId, ownerId, platformId, name: 'older release' })
        const latest = await saveProjectRelease({ projectId, ownerId, platformId, name: 'latest release' })
        await databaseConnection().getRepository('project_release').update(older.id, {
            created: new Date(Date.now() - 60000).toISOString(),
        })
        await databaseConnection().getRepository('project_release').update(latest.id, {
            created: new Date().toISOString(),
        })

        await startPush(gitRepo.id, token)
        const operation = await waitForLatestStatus(projectId, GitPushOperationStatus.SUCCEEDED)
        expect(operation.releaseId).toBe(latest.id)
        expect(operation.releaseName).toBe('latest release')
    })

    it('keeps a null release context when the project has no releases', async () => {
        const { gitRepo, token, projectId } = await setupRepo()
        await startPush(gitRepo.id, token)
        const operation = await waitForLatestStatus(projectId, GitPushOperationStatus.SUCCEEDED)
        expect(operation.releaseId).toBeNull()
        expect(operation.releaseName).toBeNull()
    })
})

type LatestOperationSnapshot = {
    id: string
    status: string
    failureReason: string | null
    errorMessage: string | null
    gitRepoId: string
    releaseId: string | null
    releaseName: string | null
}

type SetupRepoResult = {
    gitRepo: ReturnType<typeof createMockGitRepo>
    token: string
    projectId: string
    ownerId: string
    platformId: string
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
                gitRepoId: operation.gitRepoId,
                releaseId: operation.releaseId ?? null,
                releaseName: operation.releaseName ?? null,
            }
        }
        if (operation?.status === GitPushOperationStatus.FAILED) {
            throw new Error(`operation failed: ${operation.failureReason} ${operation.errorMessage}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`latest operation did not reach status ${status}`)
}

async function pollLatest(fetchLatest: () => Promise<InjectResponse | undefined>, status: GitPushOperationStatus, retries = 40): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < retries; attempt++) {
        const response = await fetchLatest()
        const body = response?.json() as Record<string, unknown>
        if (body?.status === status) {
            return body
        }
        if (body?.status === GitPushOperationStatus.FAILED) {
            throw new Error(`operation failed: ${String(body.failureReason)} ${String(body.errorMessage)}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`latest operation did not reach status ${status} over HTTP`)
}

async function saveProjectRelease(params: {
    projectId: string
    ownerId: string
    platformId: string
    name: string
}): Promise<ReturnType<typeof createMockProjectRelease>> {
    const file = createMockFile({
        projectId: params.projectId,
        platformId: params.platformId,
    })
    await databaseConnection().getRepository('file').save(file)
    const release = createMockProjectRelease({
        projectId: params.projectId,
        importedBy: params.ownerId,
        fileId: file.id,
        name: params.name,
        type: ProjectReleaseType.GIT,
    })
    await databaseConnection().getRepository('project_release').save(release)
    return release
}
