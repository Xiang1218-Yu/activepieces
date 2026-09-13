import { ApprovalSlaBreachReason, ApprovalSlaPauseReason, ApprovalSlaPolicy, ApprovalSlaRule, ApprovalSlaStatus, FlowApprovalPriority, FlowApprovalRequestState } from '@activepieces/shared'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

const SUPPORTED_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'))
const UTC_ALIASES = new Set(['Etc/UTC', 'UTC', 'GMT', 'Etc/GMT', 'GMT+0', 'GMT-0'])

export function isValidTimeZone(timezoneName: string): boolean {
    return UTC_ALIASES.has(timezoneName) || SUPPORTED_TIMEZONES.has(timezoneName)
}

export function validateTimeZoneOrThrow(timezoneName: string): void {
    if (!isValidTimeZone(timezoneName)) {
        throw new Error(`Unsupported time zone: ${timezoneName}`)
    }
}

// SLA limits are physical elapsed durations: 60 configured minutes are 60 real minutes,
// independent of DST jumps. The configured time zone governs server-side presentation of
// the deadline (and any future calendar rules), never the length of a minute.
export function addMinutesInZone(startIso: string, timeoutMinutes: number, timezoneName: string): string {
    validateTimeZoneOrThrow(timezoneName)
    return dayjs(startIso).add(timeoutMinutes, 'minute').toISOString()
}

export function resolveRule(policy: ApprovalSlaPolicy | null, priority: FlowApprovalPriority): ApprovalSlaRule | undefined {
    if (policy === null) {
        return undefined
    }
    return policy.rules[priority]
}

export function computeDeadline({
    submittedAtIso,
    rule,
    timezoneName,
}: {
    submittedAtIso: string
    rule: ApprovalSlaRule
    timezoneName: string
}): string {
    return addMinutesInZone(submittedAtIso, rule.timeoutMinutes, timezoneName)
}

export function computeEscalationInstant({
    submittedAtIso,
    rule,
    timezoneName,
}: {
    submittedAtIso: string
    rule: ApprovalSlaRule
    timezoneName: string
}): string | null {
    if (rule.escalationMinutes === undefined || rule.escalationMinutes <= 0 || rule.escalationTargetUserIds.length === 0) {
        return null
    }
    return addMinutesInZone(submittedAtIso, rule.escalationMinutes, timezoneName)
}

export type SlaStatusInput = {
    state: FlowApprovalRequestState
    priority: FlowApprovalPriority
    submittedAt: string
    slaDeadlineAt?: string | null
    pausedAt?: string | null
    pauseReason?: ApprovalSlaPauseReason | null
    escalatedAt?: string | null
    slaBreachReason?: ApprovalSlaBreachReason | null
}

export function computeSlaStatus({
    approval,
    policy,
    nowIso = new Date().toISOString(),
}: {
    approval: SlaStatusInput
    policy: ApprovalSlaPolicy | null
    nowIso?: string
}): ApprovalSlaStatus | undefined {
    const rule = resolveRule(policy, approval.priority)
    if (policy === null || rule === undefined) {
        return undefined
    }
    const timezoneName = policy.timezone
    const deadlineIso = approval.slaDeadlineAt ?? computeDeadline({
        submittedAtIso: approval.submittedAt,
        rule,
        timezoneName,
    })

    if (approval.state !== FlowApprovalRequestState.PENDING) {
        return {
            configured: true,
            priority: approval.priority,
            timezone: timezoneName,
            deadlineAt: deadlineIso,
            remainingMs: 0,
            overdue: approval.slaBreachReason != null,
            paused: false,
            pauseReason: null,
            escalationTargetUserIds: rule.escalationTargetUserIds,
            escalatedAt: approval.escalatedAt ?? null,
            breachReason: approval.slaBreachReason ?? null,
        }
    }

    const paused = approval.pausedAt != null
    const referenceIso = paused ? (approval.pausedAt as string) : nowIso
    const remainingMs = dayjs(deadlineIso).diff(dayjs(referenceIso))
    const overdue = remainingMs < 0 || approval.slaBreachReason != null

    return {
        configured: true,
        priority: approval.priority,
        timezone: timezoneName,
        deadlineAt: deadlineIso,
        remainingMs,
        overdue,
        paused,
        pauseReason: approval.pauseReason ?? null,
        escalationTargetUserIds: rule.escalationTargetUserIds,
        escalatedAt: approval.escalatedAt ?? null,
        breachReason: approval.slaBreachReason ?? null,
    }
}

export function formatInTimeZone({ iso, timezoneName }: { iso: string, timezoneName: string }): string {
    validateTimeZoneOrThrow(timezoneName)
    return dayjs(iso).tz(timezoneName).format('DD MMM YYYY, HH:mm z')
}

export const approvalSlaTime = {
    isValidTimeZone,
    validateTimeZoneOrThrow,
    addMinutesInZone,
    resolveRule,
    computeDeadline,
    computeEscalationInstant,
    computeSlaStatus,
    formatInTimeZone,
}
