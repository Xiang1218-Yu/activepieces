import { isNil, ProjectId } from '@activepieces/core-utils'
import { apDayjs } from '@activepieces/server-utils'
import { FlowRunStatus, RunRetentionCleanupPreview, RunRetentionPolicySpec, TERMINAL_RUN_STATUSES } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { QueryResult } from 'typeorm'
import { databaseConnection } from '../database/database-connection'
import { distributedLock } from '../database/redis-connections'
import { flowRunRepo } from '../flows/flow-run/flow-run-service'
import { projectRepo } from '../project/project-repo'
import { runRetentionPolicyRepo } from './run-retention-policy-service'

const DELETE_BATCH_SIZE = 1000
const MAX_DELETED_PER_GROUP = 100_000
const CLEANUP_LOCK_TIMEOUT_SECONDS = 10 * 60

export const runRetentionCleanupService = (log: FastifyBaseLogger) => ({
    async cleanup(): Promise<RunRetentionCleanupSummary> {
        return distributedLock(log).runExclusive({
            key: 'run_retention_cleanup',
            timeoutInSeconds: CLEANUP_LOCK_TIMEOUT_SECONDS,
            fn: async () => {
                const groups = await listPolicyGroups()
                const deletedByGroup: number[] = []
                for (const group of groups) {
                    const deleted = await deleteExpiredRunsForGroup(group, log)
                    deletedByGroup.push(deleted)
                }
                const deletedCount = deletedByGroup.reduce((total, count) => total + count, 0)
                log.info({ deletedCount, policyGroups: groups.length }, '[runRetentionCleanup] cleanup completed')
                return { deletedCount, policyGroups: groups.length }
            },
        })
    },
    async preview({ projectId, spec }: PreviewParams): Promise<RunRetentionCleanupPreview> {
        const statuses = terminalStatusesOf(spec.statuses)
        if (statuses.length === 0) {
            return { estimatedCount: 0, earliestFinishTime: null }
        }
        const boundary = retentionBoundary(spec.retentionDays)
        const row = await flowRunRepo()
            .createQueryBuilder('flow_run')
            .select('COUNT(flow_run.id)', 'count')
            .addSelect('MIN(flow_run."finishTime")', 'earliest')
            .where('flow_run."projectId" = :projectId', { projectId })
            .andWhere('flow_run.status IN (:...statuses)', { statuses })
            .andWhere('flow_run."finishTime" IS NOT NULL')
            .andWhere('flow_run."finishTime" < :boundary', { boundary })
            .andWhere(spec.includeArchived ? '1 = 1' : 'flow_run."archivedAt" IS NULL')
            .andWhere('NOT EXISTS (SELECT 1 FROM flow_run child WHERE child."parentRunId" = flow_run.id)')
            .andWhere('NOT EXISTS (SELECT 1 FROM waitpoint waitpoint WHERE waitpoint."flowRunId" = flow_run.id)')
            .getRawOne<{ count: string, earliest: string | Date | null }>()
        const earliest = row?.earliest
        return {
            estimatedCount: Number(row?.count ?? 0),
            earliestFinishTime: isNil(earliest) ? null : toIsoString(earliest),
        }
    },
})

async function listPolicyGroups(): Promise<PolicyGroup[]> {
    const policies = await runRetentionPolicyRepo().find()
    const overrides = policies.filter((policy) => !isNil(policy.projectId))
    const defaults = policies.filter((policy) => isNil(policy.projectId))

    const groups = new Map<string, PolicyGroup>()
    const addToGroup = ({ spec, projectId }: { spec: RunRetentionPolicySpec, projectId: ProjectId }): void => {
        const key = JSON.stringify(spec)
        const group = groups.get(key) ?? { spec, projectIds: [] }
        group.projectIds.push(projectId)
        groups.set(key, group)
    }

    for (const override of overrides) {
        if (isNil(override.projectId)) {
            continue
        }
        addToGroup({ spec: toSpec(override), projectId: override.projectId })
    }
    for (const platformDefault of defaults) {
        const overriddenProjectIds = new Set(
            overrides
                .filter((override) => override.platformId === platformDefault.platformId)
                .map((override) => override.projectId),
        )
        const projects = await projectRepo().find({
            select: ['id'],
            where: { platformId: platformDefault.platformId },
        })
        for (const project of projects) {
            if (!overriddenProjectIds.has(project.id)) {
                addToGroup({ spec: toSpec(platformDefault), projectId: project.id })
            }
        }
    }
    return [...groups.values()]
}

async function deleteExpiredRunsForGroup({ spec, projectIds }: PolicyGroup, log: FastifyBaseLogger): Promise<number> {
    const statuses = terminalStatusesOf(spec.statuses)
    if (projectIds.length === 0 || statuses.length === 0) {
        return 0
    }
    const boundary = retentionBoundary(spec.retentionDays)
    let totalDeleted = 0
    let iterations = 0
    const maxIterations = Math.ceil(MAX_DELETED_PER_GROUP / DELETE_BATCH_SIZE)
    while (iterations < maxIterations) {
        iterations += 1
        const candidates = await flowRunRepo()
            .createQueryBuilder('flow_run')
            .select('flow_run.id', 'id')
            .where('flow_run."projectId" IN (:...projectIds)', { projectIds })
            .andWhere('flow_run.status IN (:...statuses)', { statuses })
            .andWhere('flow_run."finishTime" IS NOT NULL')
            .andWhere('flow_run."finishTime" < :boundary', { boundary })
            .andWhere(spec.includeArchived ? '1 = 1' : 'flow_run."archivedAt" IS NULL')
            .andWhere('NOT EXISTS (SELECT 1 FROM flow_run child WHERE child."parentRunId" = flow_run.id)')
            .andWhere('NOT EXISTS (SELECT 1 FROM waitpoint waitpoint WHERE waitpoint."flowRunId" = flow_run.id)')
            .orderBy('flow_run."finishTime"', 'ASC')
            .limit(DELETE_BATCH_SIZE)
            .getRawMany<{ id: string }>()
        if (candidates.length === 0) {
            break
        }
        totalDeleted += await deleteBatch({
            ids: candidates.map((candidate) => candidate.id),
            statuses,
            boundary,
            includeArchived: spec.includeArchived,
        })
        if (candidates.length < DELETE_BATCH_SIZE) {
            break
        }
    }
    if (totalDeleted > 0) {
        log.info({ deletedCount: totalDeleted, retentionDays: spec.retentionDays, projectCount: projectIds.length }, '[runRetentionCleanup] deleted expired runs for policy group')
    }
    return totalDeleted
}

async function deleteBatch({ ids, statuses, boundary, includeArchived }: DeleteBatchParams): Promise<number> {
    const queryRunner = databaseConnection().createQueryRunner()
    try {
        const result: QueryResult = await queryRunner.query(
            `DELETE FROM flow_run
            WHERE id = ANY($1)
            AND status = ANY($2)
            AND "finishTime" IS NOT NULL
            AND "finishTime" < $3
            AND ($4::boolean OR "archivedAt" IS NULL)
            AND NOT EXISTS (SELECT 1 FROM flow_run child WHERE child."parentRunId" = flow_run.id)
            AND NOT EXISTS (SELECT 1 FROM waitpoint waitpoint WHERE waitpoint."flowRunId" = flow_run.id)
            RETURNING id`,
            [ids, statuses, boundary, includeArchived],
            true,
        )
        return result.records.length
    }
    finally {
        await queryRunner.release()
    }
}

function terminalStatusesOf(statuses: FlowRunStatus[]): FlowRunStatus[] {
    return statuses.filter((status) => TERMINAL_RUN_STATUSES.includes(status))
}

function retentionBoundary(retentionDays: number): string {
    return apDayjs().subtract(retentionDays, 'days').toISOString()
}

function toIsoString(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : apDayjs(value).toISOString()
}

function toSpec(policy: { retentionDays: number, statuses: FlowRunStatus[], includeArchived: boolean }): RunRetentionPolicySpec {
    return {
        retentionDays: policy.retentionDays,
        statuses: policy.statuses,
        includeArchived: policy.includeArchived,
    }
}

type PolicyGroup = {
    spec: RunRetentionPolicySpec
    projectIds: ProjectId[]
}

type DeleteBatchParams = {
    ids: string[]
    statuses: FlowRunStatus[]
    boundary: string
    includeArchived: boolean
}

type PreviewParams = {
    projectId: ProjectId
    spec: RunRetentionPolicySpec
}

export type RunRetentionCleanupSummary = {
    deletedCount: number
    policyGroups: number
}
