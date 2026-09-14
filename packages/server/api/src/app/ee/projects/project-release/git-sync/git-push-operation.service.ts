import { ActivepiecesError, apId, ErrorCode, isNil } from '@activepieces/core-utils'
import { memoryLock } from '@activepieces/server-utils'
import { GitPushFailureReason, GitPushOperation, GitPushOperationStatus, PushGitRepoRequest } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { QueryFailedError } from 'typeorm'
import { repoFactory } from '../../../../core/db/repo-factory'
import { ProjectReleaseEntity } from '../project-release.entity'
import { GitPushOperationEntity } from './git-push-operation.entity'
import { gitSyncHandler } from './git-sync-handler'

const repo = repoFactory<GitPushOperation>(GitPushOperationEntity)
const projectReleaseRepo = repoFactory(ProjectReleaseEntity)

const STALE_IN_PROGRESS_MS = 10 * 60 * 1000
const MAX_ERROR_MESSAGE_LENGTH = 2000

export const gitPushOperationService = (log: FastifyBaseLogger) => ({
    async start(params: StartParams): Promise<GitPushOperation> {
        const { projectId, gitRepoId, request, userId, releaseId = null } = params
        return memoryLock.runExclusive({
            key: `git-push-start:${projectId}`,
            fn: () => startOperation({ projectId, gitRepoId, request, userId: userId ?? null, releaseId, log }),
        })
    },

    async retry(params: RetryParams): Promise<GitPushOperation> {
        const { operationId, projectId, log: requestLog } = params
        const previous = await repo().findOneBy({ id: operationId, projectId })
        if (isNil(previous)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: operationId,
                    entityType: 'git-push-operation',
                },
            })
        }
        if (isNil(previous.gitRepoId)) {
            throw new ActivepiecesError({
                code: ErrorCode.GIT_REPO_NOT_CONFIGURED,
                params: {},
            })
        }
        return gitPushOperationService(requestLog).start({
            projectId,
            gitRepoId: previous.gitRepoId,
            userId: previous.triggeredBy ?? undefined,
            releaseId: previous.releaseId ?? undefined,
            request: previous.request,
        })
    },

    async getLatest({ projectId }: GetLatestParams): Promise<GitPushOperation | null> {
        return repo().findOne({
            where: { projectId },
            order: { created: 'DESC' },
        })
    },

    async markInterruptedOnStartup(): Promise<void> {
        await repo().update({
            status: GitPushOperationStatus.IN_PROGRESS,
        }, {
            status: GitPushOperationStatus.FAILED,
            failureReason: GitPushFailureReason.UNKNOWN,
            errorMessage: 'Operation interrupted by server restart',
            finishedAt: new Date().toISOString(),
        })
    },
})

async function startOperation({ projectId, gitRepoId, request, userId, releaseId, log }: {
    projectId: string
    gitRepoId: string
    request: PushGitRepoRequest
    userId: string | null
    releaseId: string | null
    log: FastifyBaseLogger
}): Promise<GitPushOperation> {
    const now = new Date()
    await repo().createQueryBuilder()
        .update()
        .set({
            status: GitPushOperationStatus.FAILED,
            failureReason: GitPushFailureReason.UNKNOWN,
            errorMessage: 'Operation interrupted by server restart',
            finishedAt: now.toISOString(),
        })
        .where('status = :status', { status: GitPushOperationStatus.IN_PROGRESS })
        .andWhere('startedAt < :cutoff', { cutoff: new Date(now.getTime() - STALE_IN_PROGRESS_MS) })
        .execute()

    const existingInProgress = await repo().findOne({
        where: { projectId, status: GitPushOperationStatus.IN_PROGRESS },
        order: { created: 'DESC' },
    })
    if (!isNil(existingInProgress)) {
        throw new ActivepiecesError({
            code: ErrorCode.GIT_PUSH_IN_PROGRESS,
            params: {},
        })
    }

    const releaseContext = await resolveReleaseContext({ projectId, releaseId })

    const operation: GitPushOperation = {
        id: apId(),
        created: now.toISOString(),
        updated: now.toISOString(),
        projectId,
        gitRepoId,
        status: GitPushOperationStatus.IN_PROGRESS,
        operationType: request.type,
        request,
        commitMessage: request.commitMessage ?? null,
        releaseId: releaseContext.id,
        releaseName: releaseContext.name,
        triggeredBy: userId,
        failureReason: null,
        errorMessage: null,
        startedAt: now.toISOString(),
        finishedAt: null,
    }
    await repo().save(operation).catch((error: unknown) => {
        if (isUniqueViolation(error)) {
            throw new ActivepiecesError({
                code: ErrorCode.GIT_PUSH_IN_PROGRESS,
                params: {},
            })
        }
        throw error
    })

    void runInBackground({ operation, log })
    return operation
}

async function resolveReleaseContext({ projectId, releaseId }: {
    projectId: string
    releaseId: string | null
}): Promise<{ id: string | null, name: string | null }> {
    const release = isNil(releaseId)
        ? await projectReleaseRepo().findOne({
            where: { projectId },
            order: { created: 'DESC' },
        })
        : await projectReleaseRepo().findOne({ where: { id: releaseId, projectId } })
    if (isNil(release)) {
        return { id: null, name: null }
    }
    return { id: release.id, name: release.name }
}

async function runInBackground({ operation, log }: { operation: GitPushOperation, log: FastifyBaseLogger }): Promise<void> {
    if (isNil(operation.triggeredBy)) {
        await markFailed({
            operationId: operation.id,
            reason: GitPushFailureReason.UNKNOWN,
            message: 'Push operation is missing the triggering user',
        })
        return
    }
    if (isNil(operation.gitRepoId)) {
        await markFailed({
            operationId: operation.id,
            reason: GitPushFailureReason.NOT_CONFIGURED,
            message: 'Git repository is no longer configured for this project',
        })
        return
    }
    try {
        await gitSyncHandler(log).execute({
            gitRepoId: operation.gitRepoId,
            userId: operation.triggeredBy,
            request: operation.request,
        })
        await markSucceeded(operation.id)
    }
    catch (error) {
        await markFailed({
            operationId: operation.id,
            reason: toFailureReason(error),
            message: toErrorMessage(error),
        })
        log.error({ err: error, operationId: operation.id }, 'git push operation failed')
    }
}

async function markSucceeded(operationId: string): Promise<void> {
    await repo().update(operationId, {
        status: GitPushOperationStatus.SUCCEEDED,
        finishedAt: new Date().toISOString(),
    })
}

async function markFailed(params: MarkFailedParams): Promise<void> {
    const { operationId, reason, message } = params
    await repo().update(operationId, {
        status: GitPushOperationStatus.FAILED,
        failureReason: reason,
        errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
        finishedAt: new Date().toISOString(),
    })
}

function toFailureReason(error: unknown): GitPushFailureReason {
    if (error instanceof ActivepiecesError) {
        switch (error.error.code) {
            case ErrorCode.INVALID_GIT_CREDENTIALS:
            case ErrorCode.AUTHENTICATION:
                return GitPushFailureReason.AUTHENTICATION_FAILED
            case ErrorCode.GIT_PUSH_CONFLICT:
                return GitPushFailureReason.CONFLICT
            case ErrorCode.ENTITY_NOT_FOUND: {
                const entityType = (error.error.params as { entityType?: string }).entityType
                return entityType === 'git-repo'
                    ? GitPushFailureReason.NOT_CONFIGURED
                    : GitPushFailureReason.REMOTE_REJECTED
            }
            default:
                return GitPushFailureReason.REMOTE_REJECTED
        }
    }
    return GitPushFailureReason.UNKNOWN
}

function toErrorMessage(error: unknown): string {
    if (error instanceof ActivepiecesError) {
        const params = error.error.params as { message?: unknown }
        if (typeof params.message === 'string' && params.message.length > 0) {
            return params.message
        }
    }
    if (error instanceof Error && error.message.length > 0) {
        return error.message
    }
    return 'Unknown error while pushing to the remote repository'
}

const POSTGRES_UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
        return false
    }
    const driverError: unknown = error.driverError
    return typeof driverError === 'object'
        && driverError !== null
        && 'code' in driverError
        && driverError.code === POSTGRES_UNIQUE_VIOLATION
}

type StartParams = {
    projectId: string
    gitRepoId: string
    userId?: string
    releaseId?: string
    request: PushGitRepoRequest
}

type RetryParams = {
    operationId: string
    projectId: string
    log: FastifyBaseLogger
}

type GetLatestParams = {
    projectId: string
}

type MarkFailedParams = {
    operationId: string
    reason: GitPushFailureReason
    message: string
}
