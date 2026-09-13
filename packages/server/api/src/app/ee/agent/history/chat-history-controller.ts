import { OptionalArrayFromQuery } from '@activepieces/core-utils'
import { AgentConversationStatus, ChatHistoryArchiveFilter, ChatHistoryResourceType, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { securityAccess } from '../../../core/security/authorization/fastify-security'
import { agentConversationService } from '../agent-conversation-service'
import { chatHistoryService } from './chat-history-service'

const CHAT_PRINCIPALS = [PrincipalType.USER] as const

export const chatHistoryController: FastifyPluginAsyncZod = async (app) => {

    app.get('/history/search', SearchHistoryRoute, async (request) => {
        return chatHistoryService(request.log).search({
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            filters: {
                ...request.query,
                limit: request.query.limit ?? 20,
            },
        })
    })

    app.post('/conversations/:id/archive', ArchiveConversationRoute, async (request) => {
        return agentConversationService(request.log).setConversationArchived({
            id: request.params.id,
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            archived: true,
        })
    })

    app.post('/conversations/:id/unarchive', ArchiveConversationRoute, async (request) => {
        return agentConversationService(request.log).setConversationArchived({
            id: request.params.id,
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            archived: false,
        })
    })
}

const SearchHistoryRoute = {
    config: {
        security: securityAccess.publicPlatform(CHAT_PRINCIPALS),
    },
    schema: {
        tags: ['agent'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: z.object({
            q: z.string().max(200).optional(),
            projectId: z.string().optional(),
            status: z.nativeEnum(AgentConversationStatus).optional(),
            resourceTypes: OptionalArrayFromQuery(z.nativeEnum(ChatHistoryResourceType)),
            from: z.string().optional(),
            to: z.string().optional(),
            archived: z.nativeEnum(ChatHistoryArchiveFilter).optional(),
            cursor: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
        }),
    },
}

const ArchiveConversationRoute = {
    config: {
        security: securityAccess.publicPlatform(CHAT_PRINCIPALS),
    },
    schema: {
        tags: ['agent'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({ id: z.string() }),
    },
}
