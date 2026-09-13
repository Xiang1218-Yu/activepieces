import type { AgentConversationStatus } from './index'

// Resource kinds a chat turn can produce or touch. Drives the history page's
// resource-type filter and the badges shown on each result.
export enum ChatHistoryResourceType {
    FLOW = 'FLOW',
    FILE = 'FILE',
    CONNECTION = 'CONNECTION',
    TABLE = 'TABLE',
    AGENT = 'AGENT',
}

export enum ChatHistoryInaccessibleReason {
    PROJECT_DELETED = 'PROJECT_DELETED',
}

export enum ChatHistoryArchiveFilter {
    ACTIVE = 'ACTIVE',
    ARCHIVED = 'ARCHIVED',
    ALL = 'ALL',
}

// A connection referenced by a conversation, desensitized for the search surface:
// the label is masked and no externalId or secret-adjacent field is ever indexed.
export type ChatHistoryConnectionRef = {
    pieceName: string
    maskedLabel: string | null
}

// A file produced or received in a conversation. Names are searchable, but the
// search index never carries fileId or url — file content stays behind the
// conversation's own permission checks.
export type ChatHistoryFileRef = {
    name: string
    mediaType: string
}

export type ChatHistoryEntry = {
    conversationId: string
    title: string | null
    // Masked excerpt of the conversation body. Null when the entry is inaccessible
    // (e.g. its project was deleted) — tombstoned entries never expose old summaries.
    snippet: string | null
    status: AgentConversationStatus
    archived: boolean
    accessible: boolean
    inaccessibleReason: ChatHistoryInaccessibleReason | null
    projectId: string | null
    projectName: string | null
    resourceTypes: ChatHistoryResourceType[]
    files: ChatHistoryFileRef[]
    connections: ChatHistoryConnectionRef[]
    messageCount: number
    conversationCreatedAt: string
    conversationUpdatedAt: string
}
