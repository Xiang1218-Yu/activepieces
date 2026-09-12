import { Cursor, isNil, SeekPage } from '@activepieces/core-utils'
import { ApplicationEvent, AuditLogExportFilters } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { In } from 'typeorm'
import { repoFactory } from '../../core/db/repo-factory'
import { applicationEvents } from '../../helper/application-events'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { rejectedPromiseHandler } from '../../helper/promise-handler'
import { AuditEventEntity } from './audit-event-entity'

export const auditLogRepo = repoFactory(AuditEventEntity)

export const auditLogService = (log: FastifyBaseLogger) => ({
    setup(): void {
        applicationEvents(log).registerListeners(log, {
            userEvent: (log) => async (params) => {
                rejectedPromiseHandler(auditLogRepo().save(params), log)
            },
            workerEvent: (log) => async (_projectId, params) => {
                rejectedPromiseHandler(auditLogRepo().save(params), log)
            },
        })
    },
    async list({ platformId, cursorRequest, limit, userId, action, projectId, createdBefore, createdAfter }: ListParams): Promise<SeekPage<ApplicationEvent>> {
        const decodedCursor = paginationHelper.decodeCursor(cursorRequest)
        const paginator = buildPaginator({
            entity: AuditEventEntity,
            query: {
                limit,
                order: 'DESC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        const queryBuilder = auditLogRepo().createQueryBuilder('audit_event')
            .where({ platformId })
        if (!isNil(userId)) {
            queryBuilder.andWhere({ userId })
        }
        if (!isNil(action)) {
            queryBuilder.andWhere({ action: In(action) })
        }

        if (!isNil(projectId)) {
            queryBuilder.andWhere({ projectId: In(projectId) })
        }

        if (createdAfter) {
            queryBuilder.andWhere('audit_event.created >= :createdAfter', {
                createdAfter,
            })
        }
        if (createdBefore) {
            queryBuilder.andWhere('audit_event.created <= :createdBefore', {
                createdBefore,
            })
        }

        const paginationResponse = await paginator.paginate(queryBuilder)
        return paginationHelper.createPage<ApplicationEvent>(
            paginationResponse.data,
            paginationResponse.cursor,
        )
    },
    async *streamAll({ platformId, filters, batchSize, log }: StreamAllParams): AsyncGenerator<ApplicationEvent[]> {
        let cursorCreated: string | null = null
        let cursorId: string | null = null

        for (;;) {
            const queryBuilder = auditLogRepo().createQueryBuilder('audit_event')
                .where('audit_event."platformId" = :platformId', { platformId })
                .orderBy('audit_event.created', 'DESC')
                .addOrderBy('audit_event.id', 'DESC')
                .take(batchSize)

            if (!isNil(filters.userId)) {
                queryBuilder.andWhere('audit_event."userId" = :userId', { userId: filters.userId })
            }
            if (!isNil(filters.action) && filters.action.length > 0) {
                queryBuilder.andWhere('audit_event.action IN (:...action)', { action: filters.action })
            }
            if (!isNil(filters.projectId) && filters.projectId.length > 0) {
                queryBuilder.andWhere('audit_event."projectId" IN (:...projectId)', { projectId: filters.projectId })
            }
            if (!isNil(filters.createdAfter)) {
                queryBuilder.andWhere('audit_event.created >= :createdAfter', { createdAfter: filters.createdAfter })
            }
            if (!isNil(filters.createdBefore)) {
                queryBuilder.andWhere('audit_event.created <= :createdBefore', { createdBefore: filters.createdBefore })
            }
            if (!isNil(cursorCreated) && !isNil(cursorId)) {
                queryBuilder.andWhere(
                    '(audit_event.created < :cursorCreated OR (audit_event.created = :cursorCreated AND audit_event.id < :cursorId))',
                    { cursorCreated, cursorId },
                )
            }

            const batch = await queryBuilder.getMany()
            if (batch.length === 0) {
                return
            }
            yield batch

            const last = batch[batch.length - 1]
            cursorCreated = last.created
            cursorId = last.id
            if (batch.length < batchSize) {
                return
            }
            log.debug({ batchSize, cursorId }, '[auditLogService#streamAll] fetched batch')
        }
    },
})


type ListParams = {
    platformId: string
    cursorRequest: Cursor | null
    limit: number
    userId?: string
    action?: string[]
    projectId?: string[]
    createdBefore?: string
    createdAfter?: string
}

type StreamAllParams = {
    platformId: string
    filters: AuditLogExportFilters
    batchSize: number
    log: FastifyBaseLogger
}
