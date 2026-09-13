import { ApprovalSlaBreachReason, ApprovalSlaPolicy, ApprovalSlaRule, FlowApprovalPriority, FlowApprovalRequestState } from '@activepieces/shared'
import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import { approvalSlaTime } from '../../../../../src/app/ee/flows/flow-approval/approval-sla-time'

const rule = (timeoutMinutes: number, escalationMinutes?: number): ApprovalSlaRule => ({
    timeoutMinutes,
    escalationMinutes,
    escalationTargetUserIds: escalationMinutes ? ['user-escalation'] : [],
})

const policy = (timezone: string, rules: Partial<Record<FlowApprovalPriority, ApprovalSlaRule>>): ApprovalSlaPolicy => ({
    id: 'pol',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    projectId: 'proj',
    platformId: 'plat',
    timezone,
    rules: rules as ApprovalSlaPolicy['rules'],
})

const pendingApproval = (overrides: Partial<{
    priority: FlowApprovalPriority
    submittedAt: string
    slaDeadlineAt: string | null
    pausedAt: string | null
    escalatedAt: string | null
    slaBreachReason: ApprovalSlaBreachReason | null
}> = {}) => ({
    state: FlowApprovalRequestState.PENDING,
    priority: FlowApprovalPriority.HIGH,
    submittedAt: '2026-03-08T12:00:00.000Z',
    slaDeadlineAt: null,
    pausedAt: null,
    escalatedAt: null,
    slaBreachReason: null,
    ...overrides,
})

describe('approvalSlaTime', () => {
    it('rejects unknown time zones', () => {
        expect(approvalSlaTime.isValidTimeZone('Mars/Olympus')).toBe(false)
        expect(() => approvalSlaTime.addMinutesInZone('2026-03-08T12:00:00.000Z', 60, 'Mars/Olympus')).toThrow()
    })

    it('computes a deadline as a fixed UTC instant', () => {
        const deadline = approvalSlaTime.computeDeadline({
            submittedAtIso: '2026-03-02T10:00:00.000Z',
            rule: rule(120),
            timezoneName: 'Europe/Berlin',
        })
        expect(deadline).toBe('2026-03-02T12:00:00.000Z')
    })

    it('counts SLA minutes as physical elapsed time across the US spring-forward gap', () => {
        const submittedAt = '2026-03-07T17:00:00.000Z'
        const deadline = approvalSlaTime.computeDeadline({
            submittedAtIso: submittedAt,
            rule: rule(2 * 24 * 60),
            timezoneName: 'America/New_York',
        })
        expect(dayjs(deadline).diff(dayjs(submittedAt), 'minute')).toBe(2 * 24 * 60)
        expect(deadline).toBe('2026-03-09T17:00:00.000Z')
    })

    it('counts SLA minutes as physical elapsed time across the US fall-back repeated hour', () => {
        const submittedAt = '2026-10-31T16:00:00.000Z'
        const deadline = approvalSlaTime.computeDeadline({
            submittedAtIso: submittedAt,
            rule: rule(7 * 24 * 60),
            timezoneName: 'America/New_York',
        })
        expect(dayjs(deadline).diff(dayjs(submittedAt), 'minute')).toBe(7 * 24 * 60)
        expect(dayjs(deadline).tz('America/New_York').format('YYYY-MM-DD HH:mm')).toBe('2026-11-07 11:00')
    })

    it('reports negative remaining time once overdue and positive before', () => {
        const slaPolicy = policy('Etc/UTC', { [FlowApprovalPriority.HIGH]: rule(60) })
        const approval = pendingApproval({
            submittedAt: '2026-03-02T10:00:00.000Z',
            slaDeadlineAt: '2026-03-02T11:00:00.000Z',
        })
        const before = approvalSlaTime.computeSlaStatus({
            approval,
            policy: slaPolicy,
            nowIso: '2026-03-02T10:30:00.000Z',
        })
        expect(before?.remainingMs).toBe(30 * 60_000)
        expect(before?.overdue).toBe(false)

        const after = approvalSlaTime.computeSlaStatus({
            approval,
            policy: slaPolicy,
            nowIso: '2026-03-02T11:30:00.000Z',
        })
        expect(after?.remainingMs).toBe(-30 * 60_000)
        expect(after?.overdue).toBe(true)
    })

    it('freezes the remaining time while the approval is paused', () => {
        const slaPolicy = policy('Etc/UTC', { [FlowApprovalPriority.HIGH]: rule(60) })
        const approval = pendingApproval({
            submittedAt: '2026-03-02T10:00:00.000Z',
            slaDeadlineAt: '2026-03-02T11:00:00.000Z',
            pausedAt: '2026-03-02T10:45:00.000Z',
        })
        const status = approvalSlaTime.computeSlaStatus({
            approval,
            policy: slaPolicy,
            nowIso: '2026-03-02T15:00:00.000Z',
        })
        expect(status?.paused).toBe(true)
        expect(status?.remainingMs).toBe(15 * 60_000)
        expect(status?.overdue).toBe(false)
    })

    it('returns undefined when the project or priority has no configured rule', () => {
        expect(approvalSlaTime.computeSlaStatus({ approval: pendingApproval(), policy: null })).toBeUndefined()
        const slaPolicy = policy('Etc/UTC', { [FlowApprovalPriority.LOW]: rule(60) })
        expect(approvalSlaTime.computeSlaStatus({
            approval: pendingApproval({ priority: FlowApprovalPriority.HIGH }),
            policy: slaPolicy,
        })).toBeUndefined()
    })

    it('exposes the escalation instant after the deadline only when targets exist', () => {
        expect(approvalSlaTime.computeEscalationInstant({
            submittedAtIso: '2026-03-02T10:00:00.000Z',
            rule: rule(60, 90),
            timezoneName: 'Etc/UTC',
        })).toBe('2026-03-02T11:30:00.000Z')
        expect(approvalSlaTime.computeEscalationInstant({
            submittedAtIso: '2026-03-02T10:00:00.000Z',
            rule: { timeoutMinutes: 60, escalationMinutes: 90, escalationTargetUserIds: [] },
            timezoneName: 'Etc/UTC',
        })).toBeNull()
    })

    it('surfaces the persisted breach reason on a decided approval', () => {
        const slaPolicy = policy('Etc/UTC', { [FlowApprovalPriority.HIGH]: rule(60, 90) })
        const status = approvalSlaTime.computeSlaStatus({
            approval: {
                state: FlowApprovalRequestState.APPROVED,
                priority: FlowApprovalPriority.HIGH,
                submittedAt: '2026-03-02T10:00:00.000Z',
                slaDeadlineAt: '2026-03-02T11:00:00.000Z',
                pausedAt: null,
                escalatedAt: '2026-03-02T11:30:00.000Z',
                slaBreachReason: ApprovalSlaBreachReason.ESCALATION_LIMIT,
            },
            policy: slaPolicy,
            nowIso: '2026-03-03T10:00:00.000Z',
        })
        expect(status?.breachReason).toBe(ApprovalSlaBreachReason.ESCALATION_LIMIT)
        expect(status?.overdue).toBe(true)
    })
})
