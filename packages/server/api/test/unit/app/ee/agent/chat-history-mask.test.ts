import { ChatHistoryResourceType, PersistedAgentMessage, PersistedAgentPartType, PersistedAgentRole, PersistedToolCallStatus } from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import { chatHistoryMask } from '../../../../../src/app/ee/agent/history/chat-history-mask'

describe('chatHistoryMask.maskSensitiveText', () => {
    it('masks emails', () => {
        expect(chatHistoryMask.maskSensitiveText('reach me at john.doe@example.com please')).toBe('reach me at ••• please')
    })

    it('masks key=value secrets but keeps the key name', () => {
        expect(chatHistoryMask.maskSensitiveText('use api_key: sk-live-1234567890abcdef')).toBe('use api_key:•••')
        expect(chatHistoryMask.maskSensitiveText('password = "hunter2!"')).toBe('password =•••"')
    })

    it('masks bearer tokens and JWTs', () => {
        expect(chatHistoryMask.maskSensitiveText('call with Bearer abcdef1234567890')).toBe('call with •••')
        expect(chatHistoryMask.maskSensitiveText('token eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF')).toBe('token •••')
    })

    it('masks long digit runs', () => {
        expect(chatHistoryMask.maskSensitiveText('card 4242 4242 4242 4242')).toBe('card •••')
    })

    it('leaves ordinary text untouched', () => {
        expect(chatHistoryMask.maskSensitiveText('build me a flow that posts to Slack every morning')).toBe('build me a flow that posts to Slack every morning')
    })
})

describe('chatHistoryMask.maskConnectionLabel', () => {
    it('masks email labels', () => {
        expect(chatHistoryMask.maskConnectionLabel('jane@acme.com')).toBe('ja•••@•••')
    })

    it('masks free-form labels down to a prefix', () => {
        expect(chatHistoryMask.maskConnectionLabel('Production Slack workspace')).toBe('Pr•••')
    })

    it('masks blank labels fully', () => {
        expect(chatHistoryMask.maskConnectionLabel('   ')).toBe('•••')
    })
})

function textMessage(role: PersistedAgentRole, text: string): PersistedAgentMessage {
    return { role, parts: [{ type: PersistedAgentPartType.TEXT, text }] }
}

describe('chatHistoryMask.deriveResourceTypes', () => {
    it('detects files, connections, flows, tables, and agents', () => {
        const messages: PersistedAgentMessage[] = [
            {
                role: PersistedAgentRole.ASSISTANT,
                parts: [
                    { type: PersistedAgentPartType.FILE, toolCallId: 't1', fileId: 'f1', url: 'https://files.example/secret', mediaType: 'text/csv', fileName: 'report.csv', byteSize: 100, timestamp: '2026-01-01' },
                    { type: PersistedAgentPartType.ACTION_RECEIPT, toolCallId: 't2', actionDisplayName: 'Send Message', pieceName: '@activepieces/piece-slack', connectionLabel: 'ops@acme.com', status: 'success', timestamp: '2026-01-01' },
                    { type: PersistedAgentPartType.TOOL_CALL, toolCallId: 't3', toolName: 'ap_create_flow', input: {}, status: PersistedToolCallStatus.COMPLETED },
                    { type: PersistedAgentPartType.TOOL_CALL, toolCallId: 't4', toolName: 'ap_create_table', input: {}, status: PersistedToolCallStatus.COMPLETED },
                    { type: PersistedAgentPartType.TOOL_CALL, toolCallId: 't5', toolName: 'ap_update_agent', input: {}, status: PersistedToolCallStatus.COMPLETED },
                ],
            },
        ]
        const types = chatHistoryMask.deriveResourceTypes(messages)
        expect(types).toEqual(expect.arrayContaining([
            ChatHistoryResourceType.FILE,
            ChatHistoryResourceType.CONNECTION,
            ChatHistoryResourceType.FLOW,
            ChatHistoryResourceType.TABLE,
            ChatHistoryResourceType.AGENT,
        ]))
    })

    it('returns nothing for plain text conversations', () => {
        expect(chatHistoryMask.deriveResourceTypes([textMessage(PersistedAgentRole.USER, 'hello')])).toEqual([])
    })
})

describe('chatHistoryMask.extractFiles', () => {
    it('keeps names and media types only — never urls or file ids', () => {
        const messages: PersistedAgentMessage[] = [
            {
                role: PersistedAgentRole.ASSISTANT,
                parts: [
                    { type: PersistedAgentPartType.FILE, toolCallId: 't1', fileId: 'secret-file-id', url: 'https://files.example/signed-url', mediaType: 'application/pdf', fileName: 'invoice.pdf', byteSize: 10, timestamp: '2026-01-01' },
                ],
            },
        ]
        const files = chatHistoryMask.extractFiles(messages)
        expect(files).toEqual([{ name: 'invoice.pdf', mediaType: 'application/pdf' }])
        expect(JSON.stringify(files)).not.toContain('secret-file-id')
        expect(JSON.stringify(files)).not.toContain('signed-url')
    })
})

describe('chatHistoryMask.extractConnections', () => {
    it('masks labels and dedupes by piece and label', () => {
        const receipt = (label: string): PersistedAgentMessage => ({
            role: PersistedAgentRole.ASSISTANT,
            parts: [
                { type: PersistedAgentPartType.ACTION_RECEIPT, toolCallId: `t-${label}`, actionDisplayName: 'Send Message', pieceName: '@activepieces/piece-slack', connectionLabel: label, status: 'success', timestamp: '2026-01-01' },
            ],
        })
        const connections = chatHistoryMask.extractConnections([receipt('ops@acme.com'), receipt('ops@acme.com')])
        expect(connections).toEqual([{ pieceName: '@activepieces/piece-slack', maskedLabel: 'op•••@•••' }])
        expect(JSON.stringify(connections)).not.toContain('ops@acme.com')
    })
})

describe('chatHistoryMask.buildSearchCorpus', () => {
    it('includes message text, failure reasons, and file names but not tool outputs', () => {
        const messages: PersistedAgentMessage[] = [
            textMessage(PersistedAgentRole.USER, 'make a report'),
            {
                role: PersistedAgentRole.ASSISTANT,
                parts: [
                    { type: PersistedAgentPartType.TOOL_CALL, toolCallId: 't1', toolName: 'ap_execute_action', input: { secret: 'shh' }, output: { rows: ['raw output that must not be indexed'] }, status: PersistedToolCallStatus.ERROR, errorText: 'Slack auth expired' },
                    { type: PersistedAgentPartType.FILE, toolCallId: 't2', fileId: 'f1', url: 'https://files.example/x', mediaType: 'text/csv', fileName: 'report.csv', byteSize: 1, timestamp: '2026-01-01' },
                ],
            },
        ]
        const corpus = chatHistoryMask.buildSearchCorpus(messages)
        expect(corpus).toContain('make a report')
        expect(corpus).toContain('Slack auth expired')
        expect(corpus).toContain('report.csv')
        expect(corpus).not.toContain('raw output that must not be indexed')
        expect(corpus).not.toContain('shh')
    })
})

describe('chatHistoryMask.buildSnippet', () => {
    it('returns null for empty corpus', () => {
        expect(chatHistoryMask.buildSnippet(null)).toBeNull()
        expect(chatHistoryMask.buildSnippet('   ')).toBeNull()
    })

    it('centers the snippet on the keyword when present', () => {
        const corpus = `${'lorem ipsum '.repeat(30)}needle${' dolor sit'.repeat(30)}`
        const snippet = chatHistoryMask.buildSnippet(corpus, 'needle')
        expect(snippet).toContain('needle')
        expect(snippet?.startsWith('…')).toBe(true)
        expect(snippet?.endsWith('…')).toBe(true)
    })

    it('takes the head when there is no keyword match', () => {
        const corpus = `start ${'x'.repeat(500)}`
        const snippet = chatHistoryMask.buildSnippet(corpus, 'missing')
        expect(snippet?.startsWith('start')).toBe(true)
        expect(snippet?.endsWith('…')).toBe(true)
    })
})
