import { isNil, SeekPage, tryCatch, unique } from '@activepieces/core-utils'
import { AgentConversation, AgentConversationStatus, AgentRunSource, ChatHistoryArchiveFilter, ChatHistoryEntry, ChatHistoryInaccessibleReason, ChatHistoryResourceType } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { Brackets, In } from 'typeorm'
import { repoFactory } from '../../../core/db/repo-factory'
import { buildPaginator } from '../../../helper/pagination/build-paginator'
import { paginationHelper } from '../../../helper/pagination/pagination-utils'
import { Order } from '../../../helper/pagination/paginator'
import { ProjectEntity } from '../../../project/project-entity'
import { AgentConversationEntity } from '../agent-conversation-entity'
import { EVAL_CONVERSATION_ID_PREFIX, isEvalConversationId } from '../agent-helpers'
import { ChatHistoryIndexEntity, ChatHistoryIndexRow } from './chat-history-index-entity'
import { chatHistoryMask, MAX_SEARCH_TEXT_LENGTH } from './chat-history-mask'

const indexRepo = repoFactory(ChatHistoryIndexEntity)
const conversationRepo = repoFactory(AgentConversationEntity)
const projectRepo = repoFactory(ProjectEntity)

// Only user-facing chat surfaces are searchable. Flow-step runs are execution
// artifacts with their own retention, and builder sessions belong to the agent
// editor — neither should turn up when a user looks for a past chat.
const INDEXED_SOURCES: AgentRunSource[] = [AgentRunSource.CHAT, AgentRunSource.AGENT]

// Self-healing backfill for conversations that predate the index (or whose
// indexing hook failed). Bounded per search call so a large backlog drains
// across searches instead of blocking one request.
const BACKFILL_BATCH_SIZE = 100

export const chatHistoryService = (log: FastifyBaseLogger) => ({
    async upsertForConversation({ conversationId }: ConversationKey): Promise<void> {
        if (isEvalConversationId(conversationId)) {
            return
        }
        const conversation = await conversationRepo().findOneBy({ id: conversationId })
        if (isNil(conversation) || !INDEXED_SOURCES.includes(conversation.source)) {
            return
        }
        const row = await buildIndexRow(conversation)
        await indexRepo().upsert(row, { conflictPaths: ['conversationId'] })
    },

    async removeForConversation({ conversationId }: ConversationKey): Promise<void> {
        await indexRepo().delete({ conversationId })
    },

    async syncArchived({ conversationId, archived }: ConversationKey & { archived: boolean }): Promise<void> {
        await indexRepo().update({ conversationId }, { archived })
    },

    // Project deletion tombstones its index rows in place: the entry stays so the
    // history page can say "no longer accessible", but the masked corpus, file and
    // connection refs go with the project — the old summary is never served again.
    async tombstoneForProject({ projectId }: { projectId: string }): Promise<void> {
        const result = await indexRepo()
            .createQueryBuilder()
            .update()
            .set({
                accessible: false,
                inaccessibleReason: ChatHistoryInaccessibleReason.PROJECT_DELETED,
                searchText: null,
                files: [],
                connections: [],
                projectName: null,
            })
            .where('"projectId" = :projectId AND accessible = true', { projectId })
            .execute()
        if ((result.affected ?? 0) > 0) {
            log.info({ project: { id: projectId }, tombstoned: result.affected }, '[chatHistoryService] Tombstoned history index rows for deleted project')
        }
    },

    async search({ platformId, userId, filters }: SearchParams): Promise<SeekPage<ChatHistoryEntry>> {
        await this.backfillMissingForUser({ platformId, userId })

        const decodedCursor = paginationHelper.decodeCursor(filters.cursor)
        const paginator = buildPaginator({
            entity: ChatHistoryIndexEntity,
            alias: 'history',
            query: {
                limit: filters.limit,
                orderBy: [
                    { field: 'conversationUpdatedAt', order: Order.DESC },
                    { field: 'id', order: Order.DESC },
                ],
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })

        const queryBuilder = indexRepo()
            .createQueryBuilder('history')
            .where({ platformId, userId })

        const keyword = filters.q?.trim()
        if (!isNil(keyword) && keyword.length > 0) {
            const escaped = `%${escapeLike(keyword)}%`
            queryBuilder.andWhere(new Brackets((qb) => {
                qb.where('history.title ILIKE :keyword', { keyword: escaped })
                    .orWhere('history."searchText" ILIKE :keyword', { keyword: escaped })
            }))
        }
        if (!isNil(filters.projectId)) {
            queryBuilder.andWhere('history."projectId" = :projectId', { projectId: filters.projectId })
        }
        if (!isNil(filters.status)) {
            queryBuilder.andWhere('history.status = :status', { status: filters.status })
        }
        if (!isNil(filters.resourceTypes) && filters.resourceTypes.length > 0) {
            // Scalar params only: array binding through the query builder is driver-sensitive.
            const resourceTypes = filters.resourceTypes
            queryBuilder.andWhere(new Brackets((qb) => {
                resourceTypes.forEach((type, index) => {
                    qb.orWhere(`:resourceType${index} = ANY(history."resourceTypes")`, { [`resourceType${index}`]: type })
                })
            }))
        }
        if (!isNil(filters.from)) {
            queryBuilder.andWhere('history."conversationUpdatedAt" >= :from', { from: filters.from })
        }
        if (!isNil(filters.to)) {
            queryBuilder.andWhere('history."conversationUpdatedAt" <= :to', { to: filters.to })
        }
        if (filters.archived === ChatHistoryArchiveFilter.ACTIVE) {
            queryBuilder.andWhere('history.archived = false')
        }
        else if (filters.archived === ChatHistoryArchiveFilter.ARCHIVED) {
            queryBuilder.andWhere('history.archived = true')
        }

        const { data, cursor } = await paginator.paginate(queryBuilder)
        const entries = await toEntries({ rows: data, keyword, log })
        return paginationHelper.createPage(entries, cursor)
    },

    async backfillMissingForUser({ platformId, userId }: { platformId: string, userId: string }): Promise<void> {
        const missing = await conversationRepo()
            .createQueryBuilder('conversation')
            .select('conversation.id', 'id')
            .where('conversation."platformId" = :platformId', { platformId })
            .andWhere('conversation."userId" = :userId', { userId })
            .andWhere('conversation.source IN (:...sources)', { sources: INDEXED_SOURCES })
            .andWhere('conversation.id NOT LIKE :evalPrefix', { evalPrefix: `${EVAL_CONVERSATION_ID_PREFIX}%` })
            .andWhere('NOT EXISTS (SELECT 1 FROM "agent_conversation_history_index" "idx" WHERE "idx"."conversationId" = conversation.id)')
            .orderBy('conversation.created', 'DESC')
            .limit(BACKFILL_BATCH_SIZE)
            .getMany()
        for (const conversation of missing) {
            const { error } = await tryCatch(() => this.upsertForConversation({ conversationId: conversation.id }))
            if (!isNil(error)) {
                log.warn({ error, conversation: { id: conversation.id } }, '[chatHistoryService] Backfill failed for conversation')
            }
        }
    },
})

async function buildIndexRow(conversation: AgentConversation): Promise<ChatHistoryIndexUpsert> {
    const uiMessages = conversation.uiMessages ?? []
    const project = isNil(conversation.projectId)
        ? null
        : await projectRepo().findOne({ where: { id: conversation.projectId }, withDeleted: true })
    // A conversation indexed after its project vanished is born tombstoned.
    const projectGone = !isNil(conversation.projectId) && (isNil(project) || !isNil(project.deleted))
    const accessible = !projectGone
    return {
        id: conversation.id,
        conversationId: conversation.id,
        platformId: conversation.platformId,
        userId: conversation.userId,
        projectId: conversation.projectId ?? null,
        projectName: projectGone ? null : project?.displayName ?? null,
        title: conversation.title ?? null,
        status: conversation.status,
        archived: !isNil(conversation.archivedAt),
        searchText: accessible ? chatHistoryMask.maskSensitiveText(chatHistoryMask.buildSearchCorpus(uiMessages)).slice(0, MAX_SEARCH_TEXT_LENGTH) : null,
        resourceTypes: accessible ? chatHistoryMask.deriveResourceTypes(uiMessages) : [],
        files: accessible ? chatHistoryMask.extractFiles(uiMessages) : [],
        connections: accessible ? chatHistoryMask.extractConnections(uiMessages) : [],
        messageCount: uiMessages.length,
        accessible,
        inaccessibleReason: projectGone ? ChatHistoryInaccessibleReason.PROJECT_DELETED : null,
        conversationCreatedAt: conversation.created,
        conversationUpdatedAt: conversation.updated,
    }
}

// The tombstone hook on project delete is the primary guard; this re-check is the
// safety net. If a project disappeared without its rows being tombstoned (failed
// hook, older data), the entries are presented as inaccessible anyway and the
// tombstone is repaired in the background.
async function toEntries({ rows, keyword, log }: { rows: ChatHistoryIndexRow[], keyword: string | undefined, log: FastifyBaseLogger }): Promise<ChatHistoryEntry[]> {
    const projectIds = unique(rows.map((row) => row.projectId).filter((projectId): projectId is string => !isNil(projectId)))
    const projects = projectIds.length === 0
        ? []
        : await projectRepo().find({ where: { id: In(projectIds) }, withDeleted: true })
    const goneProjectIds = new Set(projectIds.filter((projectId) => {
        const project = projects.find((candidate) => candidate.id === projectId)
        return isNil(project) || !isNil(project.deleted)
    }))
    const missedTombstoneProjectIds = unique(rows
        .filter((row) => row.accessible && !isNil(row.projectId) && goneProjectIds.has(row.projectId))
        .map((row) => row.projectId as string))
    for (const projectId of missedTombstoneProjectIds) {
        log.warn({ project: { id: projectId } }, '[chatHistoryService] Found un-tombstoned rows for a deleted project; repairing')
        const { error } = await tryCatch(() => chatHistoryService(log).tombstoneForProject({ projectId }))
        if (!isNil(error)) {
            log.warn({ error, project: { id: projectId } }, '[chatHistoryService] Failed to repair tombstone')
        }
    }
    return rows.map((row) => {
        const accessible = row.accessible && (isNil(row.projectId) || !goneProjectIds.has(row.projectId))
        return {
            conversationId: row.conversationId,
            title: row.title,
            snippet: accessible ? chatHistoryMask.buildSnippet(row.searchText, keyword) : null,
            status: row.status as AgentConversationStatus,
            archived: row.archived,
            accessible,
            inaccessibleReason: accessible ? null : row.inaccessibleReason ?? ChatHistoryInaccessibleReason.PROJECT_DELETED,
            projectId: accessible ? row.projectId : null,
            projectName: accessible ? row.projectName : null,
            resourceTypes: accessible ? row.resourceTypes : [],
            files: accessible ? row.files : [],
            connections: accessible ? row.connections : [],
            messageCount: row.messageCount,
            conversationCreatedAt: toIsoString(row.conversationCreatedAt),
            conversationUpdatedAt: toIsoString(row.conversationUpdatedAt),
        }
    })
}

function toIsoString(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : value
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

type ConversationKey = {
    conversationId: string
}

// The index row's own created/updated audit columns are database-managed;
// everything else is rebuilt from the conversation on every upsert.
type ChatHistoryIndexUpsert = Omit<ChatHistoryIndexRow, 'created' | 'updated'>

type SearchParams = {
    platformId: string
    userId: string
    filters: {
        q?: string
        projectId?: string
        status?: AgentConversationStatus
        resourceTypes?: ChatHistoryResourceType[]
        from?: string
        to?: string
        archived?: ChatHistoryArchiveFilter
        cursor?: string
        limit: number
    }
}
