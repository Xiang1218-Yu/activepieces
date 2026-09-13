---
icon: ⏱️
---

# Approval SLA

Per-priority time limits on the EE **flow publish approval** workflow (`flow_approval_request`). The module lives next to the approval request code under `packages/server/api/src/app/ee/flows/flow-approval/`.

### Configuration
- One `approval_sla_policy` row per project (unique on projectId): `timezone` (IANA name) + `rules` JSONB keyed by `FlowApprovalPriority` (`LOW|NORMAL|HIGH|URGENT`). Each rule has `timeoutMinutes`, optional `escalationMinutes` (must be strictly greater than the timeout), and `escalationTargetUserIds` (project members).
- CRUD: `/v1/approval-sla-policies` (READ_PROJECT / WRITE_PROJECT, QUERY projectId). The module is still gated by `environmentsEnabled` via `flowApprovalModule`'s preHandler.
- **Wire shape is a sparse array, not a map.** The upsert DTO (`UpsertApprovalSlaPolicyRequestBody`) takes `rules: { priority, rule }[]` with `.min(1)`; zod v4's `z.record(enum, rule)` instantiates *every* enum key as an `undefined` own property, so a map DTO both rejects partial saves and defeats an "at least one rule" refine. The service (`rulesArrayToMap`) converts the array to the stored JSONB map; only enabled priorities are persisted. Stored policy responses keep the map shape.

### Time model (the non-obvious part)
- SLA minutes are **physical elapsed durations**, not wall-clock offsets: `deadline = submittedAt + timeoutMinutes` as a plain instant add. The configured time zone governs *presentation* (`approvalSlaTime.formatInTimeZone`) and validation only — a minute is always a real minute across DST gaps/repeats. Deadlines are stored as UTC instants (`slaDeadlineAt timestamptz`).
- All deadline/status math runs **server-side** in `approval-sla-time.ts`; the UI only renders `ApprovalSlaStatus` (`deadlineAt`, `remainingMs`, `overdue`, `paused`, `escalatedAt`, `breachReason`, escalation targets). Never recompute in the browser.
- `Etc/UTC` may be missing from `Intl.supportedValuesOf('timeZone')` on small-ICU builds; `approvalSlaTime.isValidTimeZone` allow-lists the standard UTC aliases.

### Pause / cancel
- `pause` sets `pausedAt` + `pauseReason` (`MANUAL|FLOW_DISABLED|FLOW_DELETED`); the status then reports remaining time frozen at that instant and the partial index `idx_flow_approval_request_sla_due` (PENDING AND pausedAt IS NULL) keeps the sweep away.
- `resume` shifts `slaDeadlineAt` by the exact paused wall duration inside a pessimistic lock (`shiftDeadlineForPausedDuration`). `resume`/batch resume take an optional `onlyReason` so a FLOW_DISABLED auto-pause never undoes a MANUAL pause.
- **Flow lifecycle drives auto-pause/cancel via `publishHooksFactory`** (CE no-op; EE impl in `ee/flows/flow-approval/flow-publish-hook.ts`): disabling a flow calls `pausePendingForFlow(FLOW_DISABLED)` (no countdown, no escalation while disabled), re-enabling calls `resumePendingForFlow(FLOW_DISABLED)`, and the DELETE_FLOW background job calls `cancelApprovalsForDeletedFlow` which deletes pending rows and emits a withdrawn audit event.
- Withdrawing deletes the row — that is the human "canceled" case; nothing to sweep.
- Approving/rejecting clears `pausedAt`/`pauseReason` and ends the SLA.

### Sweep job
- System job `APPROVAL_SLA_SWEEP` runs every minute, registered in `flowApprovalModule` (EE/Cloud only, same pattern as `CHAT_STALE_SWEEP`).
- Only PENDING, non-null-deadline, `pausedAt IS NULL` rows are candidates (`listDueForSlaCheck`).
- Escalation notification dedup is the conditional UPDATE `WHERE escalatedAt IS NULL ... RETURNING id` (`markEscalated`). Exactly one sweep instance wins; reopening a detail page or running the sweep twice can never send a second escalation mail.
- `slaBreachReason` (`PENDING_LIMIT` vs `ESCALATION_LIMIT`) is stamped once by the same conditional-update pattern (`markBreached`, only when still null).
- Escalation sends the `approval-sla-escalation` email template to active target users AND emits `flow.approval.sla.escalated` (audit log / event destinations).

### Visibility
- `GET /v1/flow-approval-requests` now requires only READ_FLOW. The service filters rows: a user sees approvals they submitted OR where they currently hold `PUBLISH_SENSITIVE_FLOW_ACCESS` in the project (`listUserIdsWithPermissionOnProject`). Approve/reject endpoints still require the approval permission, enforced both at route and row level.
- **Detail is filtered too**: `GET /:id` → `getPopulatedOrThrow({ viewerId })` runs the same submitter-or-approver check and throws `ErrorCode.AUTHORIZATION` (403) when the viewer is neither — knowing the id is not enough. Never call the unfiltered lookup from a viewer-facing route.
- `PopulatedFlowApprovalRequest.sla` is attached in `list` and `getPopulatedOrThrow`; `overdue=true` query filters past-due non-paused pending rows.
