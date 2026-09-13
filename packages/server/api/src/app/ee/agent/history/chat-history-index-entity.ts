import { AgentConversation, ChatHistoryConnectionRef, ChatHistoryFileRef, ChatHistoryInaccessibleReason, ChatHistoryResourceType } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../../database/database-common'

// One row per searchable conversation. The row stores only desensitized,
// denormalized data (masked search text, file names, masked connection labels),
// so the history-search surface never has to read raw message bodies. When the
// owning project is deleted the row is tombstoned in place (accessible=false,
// content cleared) instead of leaking the old summary.
export type ChatHistoryIndexRow = {
    id: string
    created: string
    updated: string
    conversationId: string
    platformId: string
    userId: string
    projectId: string | null
    projectName: string | null
    title: string | null
    status: string
    archived: boolean
    searchText: string | null
    resourceTypes: ChatHistoryResourceType[]
    files: ChatHistoryFileRef[]
    connections: ChatHistoryConnectionRef[]
    messageCount: number
    accessible: boolean
    inaccessibleReason: ChatHistoryInaccessibleReason | null
    conversationCreatedAt: string
    conversationUpdatedAt: string
}

export type ChatHistoryIndexWithRelations = ChatHistoryIndexRow & {
    conversation: AgentConversation
}

export const ChatHistoryIndexEntity = new EntitySchema<ChatHistoryIndexWithRelations>({
    name: 'agent_conversation_history_index',
    columns: {
        ...BaseColumnSchemaPart,
        conversationId: {
            ...ApIdSchema,
            nullable: false,
        },
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        userId: {
            ...ApIdSchema,
            nullable: false,
        },
        projectId: {
            type: String,
            nullable: true,
        },
        projectName: {
            type: String,
            nullable: true,
        },
        title: {
            type: String,
            nullable: true,
        },
        status: {
            type: String,
            nullable: false,
        },
        archived: {
            type: Boolean,
            nullable: false,
            default: false,
        },
        searchText: {
            type: 'text',
            nullable: true,
        },
        resourceTypes: {
            type: String,
            array: true,
            nullable: false,
            default: '{}',
        },
        files: {
            type: 'jsonb',
            nullable: false,
            default: '[]',
        },
        connections: {
            type: 'jsonb',
            nullable: false,
            default: '[]',
        },
        messageCount: {
            type: Number,
            nullable: false,
            default: 0,
        },
        accessible: {
            type: Boolean,
            nullable: false,
            default: true,
        },
        inaccessibleReason: {
            type: String,
            nullable: true,
        },
        conversationCreatedAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
        conversationUpdatedAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
    },
    indices: [
        {
            name: 'idx_chat_history_index_platform_user_updated',
            columns: ['platformId', 'userId', 'conversationUpdatedAt', 'id'],
        },
        {
            name: 'idx_chat_history_index_project',
            columns: ['projectId'],
            where: '"projectId" IS NOT NULL',
        },
    ],
    uniques: [
        {
            name: 'uq_chat_history_index_conversation',
            columns: ['conversationId'],
        },
    ],
    relations: {
        conversation: {
            type: 'one-to-one',
            target: 'agent_conversation',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'conversationId',
                foreignKeyConstraintName: 'fk_chat_history_index_conversation',
            },
        },
    },
})
