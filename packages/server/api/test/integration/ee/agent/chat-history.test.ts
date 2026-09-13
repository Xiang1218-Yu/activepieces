import { apId } from '@activepieces/core-utils'
import { AgentConversationStatus, AgentRunSource, ChatHistoryArchiveFilter, ChatHistoryResourceType, PersistedAgentPartType, PersistedAgentRole, PersistedToolCallStatus } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { AgentConversationEntity } from '../../../../src/app/ee/agent/agent-conversation-entity'
import { chatHistoryService } from '../../../../src/app/ee/agent/history/chat-history-service'
import { db } from '../../../helpers/db'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

const conversationRepo = () => databaseConnection().getRepository(AgentConversationEntity)
const indexRepo = () => databaseConnection().getRepository('agent_conversation_history_index')

async function context(): Promise<TestContext> {
    return createTestContext(app, { plan: { agentsEnabled: true, chatEnabled: true } })
}

const SECRET_EMAIL = 'boss@acme.com'
const SECRET_KEY = 'sk-live-1234567890abcdef'
const CONNECTION_LABEL = 'ops-team@acme.com'

async function seedConversation(ctx: TestContext, overrides: Record<string, unknown> = {}) {
    const conversation = await conversationRepo().save({
        id: apId(),
        platformId: ctx.platform.id,
        projectId: ctx.project.id,
        userId: ctx.user.id,
        agentId: null,
        source: AgentRunSource.CHAT,
        title: 'Quarterly report automation',
        modelName: null,
        status: AgentConversationStatus.IDLE,
        activeRunId: null,
        archivedAt: null,
        messages: [],
        uiMessages: [
            {
                role: PersistedAgentRole.USER,
                parts: [{ type: PersistedAgentPartType.TEXT, text: `Email the report to ${SECRET_EMAIL} with api_key: ${SECRET_KEY}` }],
            },
            {
                role: PersistedAgentRole.ASSISTANT,
                parts: [
                    { type: PersistedAgentPartType.TEXT, text: 'Done, the report flow ran.' },
                    { type: PersistedAgentPartType.FILE, toolCallId: 't1', fileId: 'file-secret-id', url: 'https://files.example/signed-url', mediaType: 'application/pdf', fileName: 'report.pdf', byteSize: 100, timestamp: '2026-01-01T00:00:00Z' },
                    { type: PersistedAgentPartType.ACTION_RECEIPT, toolCallId: 't2', actionDisplayName: 'Send Message', pieceName: '@activepieces/piece-slack', connectionLabel: CONNECTION_LABEL, status: 'success', timestamp: '2026-01-01T00:00:00Z' },
                    { type: PersistedAgentPartType.TOOL_CALL, toolCallId: 't3', toolName: 'ap_create_flow', input: {}, status: PersistedToolCallStatus.COMPLETED },
                    { type: PersistedAgentPartType.TOOL_CALL, toolCallId: 't4', toolName: 'ap_execute_action', input: {}, status: PersistedToolCallStatus.ERROR, errorText: 'Slack auth expired' },
                ],
            },
        ],
        summary: null,
        summarizedUpToIndex: null,
        ...overrides,
    })
    await chatHistoryService(app.log).upsertForConversation({ conversationId: conversation.id })
    return conversation
}

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('chat history search', () => {
    it('indexes a conversation with masked body, file names only, and masked connections', async () => {
        const ctx = await context()
        const conversation = await seedConversation(ctx)

        const response = await ctx.get('/v1/agents/history/search', { q: 'report' })
        expect(response.statusCode).toBe(StatusCodes.OK)
        const { data } = response.json()
        expect(data).toHaveLength(1)
        const entry = data[0]
        expect(entry.conversationId).toBe(conversation.id)
        expect(entry.accessible).toBe(true)
        expect(entry.archived).toBe(false)
        expect(entry.projectName).toBe(ctx.project.displayName)
        expect(entry.resourceTypes).toEqual(expect.arrayContaining([
            ChatHistoryResourceType.FLOW,
            ChatHistoryResourceType.FILE,
            ChatHistoryResourceType.CONNECTION,
        ]))
        // Body is masked: no email, no api key
        expect(entry.snippet).toBeTruthy()
        expect(entry.snippet).not.toContain(SECRET_EMAIL)
        expect(entry.snippet).not.toContain(SECRET_KEY)
        // Files expose names only — never ids or urls
        expect(entry.files).toEqual([{ name: 'report.pdf', mediaType: 'application/pdf' }])
        expect(JSON.stringify(entry)).not.toContain('file-secret-id')
        expect(JSON.stringify(entry)).not.toContain('signed-url')
        // Connections are masked
        expect(entry.connections).toHaveLength(1)
        expect(entry.connections[0].maskedLabel).not.toContain(CONNECTION_LABEL)
        expect(JSON.stringify(entry)).not.toContain(CONNECTION_LABEL)
    })

    it('finds conversations by a tool failure reason', async () => {
        const ctx = await context()
        await seedConversation(ctx)

        const response = await ctx.get('/v1/agents/history/search', { q: 'Slack auth expired' })
        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().data).toHaveLength(1)
    })

    it('scopes results to the requesting user only', async () => {
        const ctx = await context()
        await seedConversation(ctx)
        const other = await context()

        const response = await other.get('/v1/agents/history/search', {})
        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().data).toHaveLength(0)
    })

    it('filters by project, status, resource type, and time', async () => {
        const ctx = await context()
        const conversation = await seedConversation(ctx)

        const byProject = await ctx.get('/v1/agents/history/search', { projectId: ctx.project.id })
        expect(byProject.json().data).toHaveLength(1)

        const wrongProject = await ctx.get('/v1/agents/history/search', { projectId: apId() })
        expect(wrongProject.json().data).toHaveLength(0)

        const byStatus = await ctx.get('/v1/agents/history/search', { status: AgentConversationStatus.ERROR })
        expect(byStatus.json().data).toHaveLength(0)

        const byResource = await ctx.get('/v1/agents/history/search', { resourceTypes: [ChatHistoryResourceType.FILE] })
        expect(byResource.json().data).toHaveLength(1)
        const byMissingResource = await ctx.get('/v1/agents/history/search', { resourceTypes: [ChatHistoryResourceType.TABLE] })
        expect(byMissingResource.json().data).toHaveLength(0)

        const future = await ctx.get('/v1/agents/history/search', { from: '2999-01-01T00:00:00.000Z' })
        expect(future.json().data).toHaveLength(0)
        const past = await ctx.get('/v1/agents/history/search', { to: '2000-01-01T00:00:00.000Z' })
        expect(past.json().data).toHaveLength(0)

        const found = await ctx.get('/v1/agents/history/search', { q: conversation.id.slice(0, 0) })
        expect(found.statusCode).toBe(StatusCodes.OK)
    })
})

describe('conversation archiving', () => {
    it('archives and unarchives through the endpoints, reflected in search filters', async () => {
        const ctx = await context()
        const conversation = await seedConversation(ctx)

        const archiveResponse = await ctx.post(`/v1/agents/conversations/${conversation.id}/archive`)
        expect(archiveResponse.statusCode).toBe(StatusCodes.OK)
        expect(archiveResponse.json().archivedAt).not.toBeNull()

        const activeOnly = await ctx.get('/v1/agents/history/search', { archived: ChatHistoryArchiveFilter.ACTIVE })
        expect(activeOnly.json().data).toHaveLength(0)
        const archivedOnly = await ctx.get('/v1/agents/history/search', { archived: ChatHistoryArchiveFilter.ARCHIVED })
        expect(archivedOnly.json().data).toHaveLength(1)
        expect(archivedOnly.json().data[0].archived).toBe(true)

        const unarchiveResponse = await ctx.post(`/v1/agents/conversations/${conversation.id}/unarchive`)
        expect(unarchiveResponse.statusCode).toBe(StatusCodes.OK)
        expect(unarchiveResponse.json().archivedAt).toBeNull()
        const activeAgain = await ctx.get('/v1/agents/history/search', { archived: ChatHistoryArchiveFilter.ACTIVE })
        expect(activeAgain.json().data).toHaveLength(1)
    })

    it('refuses to continue an archived conversation', async () => {
        const ctx = await context()
        const conversation = await seedConversation(ctx)
        await ctx.post(`/v1/agents/conversations/${conversation.id}/archive`)

        const response = await ctx.post(`/v1/agents/conversations/${conversation.id}/messages`, {
            content: 'continue please',
        })
        expect(response.statusCode).toBe(StatusCodes.CONFLICT)
        expect(response.json().params?.message).toContain('archived')
    })

    it('does not let another user archive the conversation', async () => {
        const ctx = await context()
        const conversation = await seedConversation(ctx)
        const other = await context()

        const response = await other.post(`/v1/agents/conversations/${conversation.id}/archive`)
        expect(response.statusCode).toBe(StatusCodes.NOT_FOUND)
    })
})

describe('project deletion', () => {
    it('tombstones the index instead of serving old summaries', async () => {
        const ctx = await context()
        const conversation = await seedConversation(ctx)

        await chatHistoryService(app.log).tombstoneForProject({ projectId: ctx.project.id })

        // The masked corpus is gone with the project: content keywords no longer
        // match, and the entry that still matches its title shows no summary.
        const byContent = await ctx.get('/v1/agents/history/search', { q: 'Slack auth expired' })
        expect(byContent.json().data).toHaveLength(0)

        const all = await ctx.get('/v1/agents/history/search', {})
        expect(all.json().data).toHaveLength(1)
        const entry = all.json().data[0]
        expect(entry.conversationId).toBe(conversation.id)
        expect(entry.accessible).toBe(false)
        expect(entry.snippet).toBeNull()
        expect(entry.files).toEqual([])
        expect(entry.connections).toEqual([])
        expect(entry.resourceTypes).toEqual([])
        expect(entry.projectName).toBeNull()

        const row = await indexRepo().findOneBy({ conversationId: conversation.id })
        expect(row.searchText).toBeNull()
    })

    it('presents entries as inaccessible even if the tombstone was missed', async () => {
        const ctx = await context()
        await seedConversation(ctx)

        // Simulate a project deleted without the tombstone hook (e.g. older data).
        await db.update('project', ctx.project.id, { deleted: new Date() })

        const response = await ctx.get('/v1/agents/history/search', {})
        const entry = response.json().data[0]
        expect(entry.accessible).toBe(false)
        expect(entry.snippet).toBeNull()
        expect(entry.projectName).toBeNull()

        // The safety net also repairs the row.
        const row = await indexRepo().findOneBy({ conversationId: entry.conversationId })
        expect(row.accessible).toBe(false)
        expect(row.searchText).toBeNull()
    })
})

describe('conversation deletion', () => {
    it('removes the index row with the conversation', async () => {
        const ctx = await context()
        const conversation = await seedConversation(ctx)

        const response = await ctx.delete(`/v1/agents/conversations/${conversation.id}`)
        expect(response.statusCode).toBe(StatusCodes.NO_CONTENT)

        const row = await indexRepo().findOneBy({ conversationId: conversation.id })
        expect(row).toBeNull()
    })
})
