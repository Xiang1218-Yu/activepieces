import { isNil } from '@activepieces/core-utils'
import {
    CompareFlowRunsResponse,
    CompareRunColumn,
    CompareStepRow,
    FailureRateAggregationInterval,
    FailureRateAggregationRequestQuery,
    FailureRateAggregationResponse,
    FailureRateBucket,
    FlowRun,
    FlowRunStatus,
    FlowVersion,
    StepOutput,
    flowStructureUtil,
    RunEnvironment,
    runComparisonUtils,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import pLimit from 'p-limit'
import { In } from 'typeorm'
import { flowVersionService } from '../flow-version/flow-version.service'
import { flowRunRepo, readLogsFile } from './flow-run-service'

const MAX_COLUMN_FETCH_CONCURRENCY = 3
const DEFAULT_AGGREGATION_LIMIT = 31
const MAX_AGGREGATION_LIMIT = 100
const FAILURE_RATE_FAILED_STATUSES: FlowRunStatus[] = [
    FlowRunStatus.FAILED,
    FlowRunStatus.INTERNAL_ERROR,
    FlowRunStatus.QUOTA_EXCEEDED,
    FlowRunStatus.TIMEOUT,
    FlowRunStatus.MEMORY_LIMIT_EXCEEDED,
    FlowRunStatus.LOG_SIZE_EXCEEDED,
]

type CompareParams = {
    projectId: string
    flowRunIds: string[]
}

export const flowRunComparisonService = (log: FastifyBaseLogger) => ({
    async compare({ projectId, flowRunIds }: CompareParams): Promise<CompareFlowRunsResponse> {
        const runs = await flowRunRepo().find({
            where: {
                projectId,
                id: In(flowRunIds),
                environment: RunEnvironment.PRODUCTION,
            },
            order: { created: 'DESC' },
        })
        const notFoundRunIds = getNotFoundRunIds({ requestedIds: flowRunIds, foundIds: runs.map((run) => run.id) })

        const versionIds = [...new Set(runs.map((run) => run.flowVersionId))]
        const versions = await loadVersions({ log, versionIds })

        const limit = pLimit(MAX_COLUMN_FETCH_CONCURRENCY)
        const columns = await Promise.all(
            runs.map((run) => limit(() => buildColumn({
                log,
                run,
                version: versions.get(run.flowVersionId),
            }))),
        )

        const rows = buildRows({ runs, versions })

        return {
            columns,
            rows,
            versionIds,
            notFoundRunIds,
        }
    },

    async aggregateFailureRate(params: FailureRateAggregationRequestQuery): Promise<FailureRateAggregationResponse> {
        const interval = params.interval ?? FailureRateAggregationInterval.DAY
        const pageSize = Math.min(params.limit ?? DEFAULT_AGGREGATION_LIMIT, MAX_AGGREGATION_LIMIT)
        const createdAfter = new Date(params.createdAfter)
        const createdBefore = new Date(params.createdBefore)
        if (Number.isNaN(createdAfter.getTime()) || Number.isNaN(createdBefore.getTime()) || createdAfter >= createdBefore) {
            return { interval, buckets: [], next: null }
        }
        if (!isNil(params.cursor) && Number.isNaN(Date.parse(params.cursor))) {
            return { interval, buckets: [], next: null }
        }

        const cursorExclusiveBefore = isNil(params.cursor) ? createdBefore : new Date(params.cursor)

        const truncUnit = interval === FailureRateAggregationInterval.HOUR ? 'hour' : 'day'

        let bucketsQuery = flowRunRepo().createQueryBuilder('flow_run')
            .select(`DISTINCT date_trunc('${truncUnit}', flow_run.created)`, 'bucketStart')
            .where('flow_run."projectId" = :projectId', { projectId: params.projectId })
            .andWhere('flow_run.environment = :environment', { environment: RunEnvironment.PRODUCTION })
            .andWhere('flow_run."archivedAt" IS NULL')
            .andWhere('flow_run.created >= :createdAfter', { createdAfter })
            .andWhere('flow_run.created < :createdBefore', { createdBefore })
            .andWhere('flow_run.created < :cursorExclusiveBefore', { cursorExclusiveBefore })
            .orderBy('bucketStart', 'DESC')
            .limit(pageSize + 1)

        if (params.flowId && params.flowId.length > 0) {
            bucketsQuery = bucketsQuery.andWhere('flow_run."flowId" IN (:...flowIds)', { flowIds: params.flowId })
        }
        if (params.tags && params.tags.length > 0) {
            bucketsQuery = bucketsQuery.andWhere('flow_run.tags @> ARRAY[:...tags]::varchar[]', { tags: params.tags })
        }

        const bucketStarts = await bucketsQuery.getRawMany<{ bucketStart: Date }>()
        const hasMore = bucketStarts.length > pageSize
        const pageBucketStarts = bucketStarts.slice(0, pageSize)

        if (pageBucketStarts.length === 0) {
            return { interval, buckets: [], next: null }
        }

        let countsQuery = flowRunRepo().createQueryBuilder('flow_run')
            .select(`date_trunc('${truncUnit}', flow_run.created)`, 'bucketStart')
            .addSelect('flow_run.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .where('flow_run."projectId" = :projectId', { projectId: params.projectId })
            .andWhere('flow_run.environment = :environment', { environment: RunEnvironment.PRODUCTION })
            .andWhere('flow_run."archivedAt" IS NULL')
            .andWhere(`date_trunc('${truncUnit}', flow_run.created) IN (:...bucketStarts)`, {
                bucketStarts: pageBucketStarts.map((row) => row.bucketStart),
            })
            .groupBy('bucketStart')
            .addGroupBy('flow_run.status')

        if (params.flowId && params.flowId.length > 0) {
            countsQuery = countsQuery.andWhere('flow_run."flowId" IN (:...flowIds)', { flowIds: params.flowId })
        }
        if (params.tags && params.tags.length > 0) {
            countsQuery = countsQuery.andWhere('flow_run.tags @> ARRAY[:...tags]::varchar[]', { tags: params.tags })
        }

        const rawRows = await countsQuery.getRawMany<{ bucketStart: Date, status: FlowRunStatus, count: string }>()
        const bucketsByStart = new Map<string, AccumulatingBucket>()
        for (const row of rawRows) {
            const key = row.bucketStart.toISOString()
            const existing = bucketsByStart.get(key) ?? {
                date: row.bucketStart,
                bucketStart: key,
                total: 0,
                failed: 0,
                succeeded: 0,
                other: 0,
            }
            const count = parseInt(row.count, 10)
            existing.total += count
            if (FAILURE_RATE_FAILED_STATUSES.includes(row.status)) {
                existing.failed += count
            }
            else if (row.status === FlowRunStatus.SUCCEEDED) {
                existing.succeeded += count
            }
            else {
                existing.other += count
            }
            bucketsByStart.set(key, existing)
        }

        const buckets = pageBucketStarts
            .map((row) => bucketsByStart.get(row.bucketStart.toISOString()))
            .filter((bucket): bucket is AccumulatingBucket => !isNil(bucket))
            .map(({ date: _date, ...bucket }) => ({
                ...bucket,
                failureRate: bucket.total === 0 ? 0 : bucket.failed / bucket.total,
            }))

        const next = hasMore && buckets.length > 0 ? buckets[buckets.length - 1].bucketStart : null

        return {
            interval,
            buckets,
            next,
        }
    },
})

type AccumulatingBucket = FailureRateBucket & { date: Date }

async function loadVersions({ log, versionIds }: { log: FastifyBaseLogger, versionIds: string[] }): Promise<Map<string, FlowVersion>> {
    const versions = await Promise.all(
        versionIds.map(async (versionId) => {
            const version = await flowVersionService(log).getOne(versionId)
            return isNil(version) ? undefined : [versionId, version] as const
        }),
    )
    return new Map(versions.filter((entry): entry is readonly [string, FlowVersion] => !isNil(entry)))
}

function getNotFoundRunIds({ requestedIds, foundIds }: { requestedIds: string[], foundIds: string[] }): string[] {
    const found = new Set(foundIds)
    return requestedIds.filter((id) => !found.has(id))
}

type BuildColumnParams = {
    log: FastifyBaseLogger
    run: FlowRun
    version: FlowVersion | undefined
}

async function buildColumn({ log, run, version }: BuildColumnParams): Promise<CompareRunColumn> {
    let steps: Record<string, StepOutput> = {}
    let stepsAvailable = false
    if (!isNil(run.logsFileId)) {
        const stateFile = await readLogsFile(log, run.logsFileId, run.projectId)
        if (!isNil(stateFile)) {
            steps = stateFile.executionState.steps
            stepsAvailable = true
        }
    }

    const triggerName = version?.trigger.name
    const triggerStep = isNil(triggerName) ? undefined : steps[triggerName]
    const versionActions = isNil(version)
        ? []
        : flowStructureUtil.getAllSteps(version.trigger)
            .filter((step) => step.name !== triggerName)
            .map((step) => ({ name: step.name, displayName: step.displayName }))

    const stepCells = Object.fromEntries(
        versionActions.map(({ name, displayName }) => [
            stepRowKey({ stepName: name, displayName }),
            runComparisonUtils.summarizeStep({ step: steps[name] }),
        ]),
    )

    const failedStepType = isNil(run.failedStep) ? undefined : steps[run.failedStep.name]?.type

    return {
        flowRunId: run.id,
        flowId: run.flowId,
        flowVersionId: run.flowVersionId,
        versionShort: run.flowVersionId.slice(0, 8),
        flowDisplayName: version?.displayName ?? run.flowVersion?.displayName,
        created: run.created,
        status: run.status,
        errorCategory: runComparisonUtils.categorizeRunError({
            status: run.status,
            failedStep: run.failedStep,
            triggerName,
            failedStepType,
        }),
        trigger: {
            present: !isNil(triggerStep),
            status: triggerStep?.status,
            durationMs: isNil(triggerStep?.duration) ? null : Math.round(triggerStep.duration),
            errorMessage: triggerStep?.errorMessage ?? null,
        },
        durationMs: computeRunDurationMs(run),
        queueMs: computeQueueMs(run),
        tags: run.tags ?? [],
        stepsAvailable,
        steps: stepCells,
    }
}

function buildRows({ runs, versions }: { runs: FlowRun[], versions: Map<string, FlowVersion> }): CompareStepRow[] {
    const rowInfo = new Map<string, { stepName: string, displayName?: string, versionIds: Set<string>, order: number }>()
    let nextOrder = 0
    for (const run of runs) {
        const version = versions.get(run.flowVersionId)
        if (isNil(version)) {
            continue
        }
        const actions = flowStructureUtil.getAllSteps(version.trigger)
            .filter((step) => step.name !== version.trigger.name)
        actions.forEach((step) => {
            const rowKey = stepRowKey({ stepName: step.name, displayName: step.displayName })
            const existing = rowInfo.get(rowKey)
            if (existing) {
                existing.versionIds.add(run.flowVersionId)
                return
            }
            rowInfo.set(rowKey, {
                stepName: step.name,
                displayName: step.displayName,
                versionIds: new Set<string>([run.flowVersionId]),
                order: nextOrder++,
            })
        })
    }
    const allVersionIds = new Set(runs.map((run) => run.flowVersionId))
    return [...rowInfo.entries()]
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([rowKey, info]) => ({
            rowKey,
            stepName: info.stepName,
            displayName: info.displayName,
            onlyInVersionIds: info.versionIds.size === allVersionIds.size
                ? []
                : [...info.versionIds],
        }))
}

function stepRowKey({ stepName, displayName }: { stepName: string, displayName?: string }): string {
    return `${stepName} ${displayName ?? ''}`
}

function computeRunDurationMs(run: FlowRun): number | null {
    if (isNil(run.startTime) || isNil(run.finishTime)) {
        return null
    }
    return new Date(run.finishTime).getTime() - new Date(run.startTime).getTime()
}

function computeQueueMs(run: FlowRun): number | null {
    const queuePhase = run.timeline?.legs?.[0]?.find((phase) => phase.name === 'QUEUE')
    return queuePhase?.durationMs ?? null
}
