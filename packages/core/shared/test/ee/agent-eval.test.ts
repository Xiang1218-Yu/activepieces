import {
    AgentEvalCaseStatus,
    agentEvalUtils,
    emptyAgentEvalRunTotals,
} from '../../src/lib/ee/agent/agent-eval'

describe('agentEvalUtils.render', () => {
    it('replaces every {{variable}} occurrence with its value', () => {
        const rendered = agentEvalUtils.render(
            'Refund order {{order_id}} for {{customer}} — again, {{order_id}}.',
            { order_id: 'A-42', customer: 'Ada' },
        )
        expect(rendered).toBe('Refund order A-42 for Ada — again, A-42.')
    })

    it('tolerates whitespace inside the braces', () => {
        expect(agentEvalUtils.render('Hi {{ name }}', { name: 'Ada' })).toBe('Hi Ada')
    })

    it('renders missing variables as empty text instead of leaking the placeholder', () => {
        expect(agentEvalUtils.render('Hi {{name}}', {})).toBe('Hi ')
    })

    it('leaves non-variable double braces alone', () => {
        expect(agentEvalUtils.render('{{not valid}} {{0abc}}', {})).toBe('{{not valid}} {{0abc}}')
    })
})

describe('agentEvalUtils.extractVariables', () => {
    it('returns each variable once, in order of first use', () => {
        expect(agentEvalUtils.extractVariables('{{b}} {{a}} {{b}}')).toEqual(['b', 'a'])
    })

    it('returns an empty list when there are no variables', () => {
        expect(agentEvalUtils.extractVariables('plain message')).toEqual([])
    })
})

describe('agentEvalUtils.estimateCredits', () => {
    it('charges the base weight plus one credit per tool call', () => {
        expect(agentEvalUtils.estimateCredits(0)).toBe(1)
        expect(agentEvalUtils.estimateCredits(4)).toBe(5)
    })
})

describe('agentEvalUtils.isTerminalCaseStatus', () => {
    it('treats pending and running as non-terminal', () => {
        expect(agentEvalUtils.isTerminalCaseStatus(AgentEvalCaseStatus.PENDING)).toBe(false)
        expect(agentEvalUtils.isTerminalCaseStatus(AgentEvalCaseStatus.RUNNING)).toBe(false)
    })

    it('treats every settled outcome as terminal', () => {
        for (const status of [
            AgentEvalCaseStatus.SUCCESS,
            AgentEvalCaseStatus.FAILED,
            AgentEvalCaseStatus.NEEDS_APPROVAL,
            AgentEvalCaseStatus.TIMEOUT,
            AgentEvalCaseStatus.SKIPPED,
        ]) {
            expect(agentEvalUtils.isTerminalCaseStatus(status)).toBe(true)
        }
    })
})

describe('emptyAgentEvalRunTotals', () => {
    it('starts every case as pending', () => {
        const totals = emptyAgentEvalRunTotals(3)
        expect(totals.total).toBe(3)
        expect(totals.pending).toBe(3)
        expect(totals.succeeded).toBe(0)
        expect(totals.creditsUsed).toBe(0)
    })
})
