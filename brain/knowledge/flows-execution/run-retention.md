---
icon: 🗑️
---

# Run Retention

Per-project run retention policies that bound `flow_run` table growth for self-hosted deployments. Platform admins set a default policy per platform; project admins set a strictly shorter override. A system job hard-deletes eligible runs hourly; a preview endpoint estimates impact before a policy is saved.

### Entities & services
- **RunRetentionPolicy** — `run_retention_policy` table: `platformId`, nullable `projectId` (NULL = platform default), `retentionDays`, `statuses` (terminal-only, validated by zod refine), `includeArchived`. Two partial unique indexes: one default per platform (`WHERE "projectId" IS NULL`), one override per project.
- **runRetentionPolicyService** — CRUD + `getEffective` (override → platform default → null). Override upsert rejects `retentionDays >=` the platform default (or `EXECUTION_DATA_RETENTION_DAYS` when no default exists) with `ErrorCode.VALIDATION` (HTTP 409).
- **runRetentionCleanupService** — `preview` (estimated count + earliest `finishTime`) and `cleanup` (the hourly job body).

### How it works
- Routes (`/v1/run-retention-policies/*`): `default` is platformAdminOnly; `override` is project-scoped `WRITE_PROJECT`; `effective` and `preview` are `READ_RUN`. Preview accepts an optional ad-hoc policy in the body so admins see impact before saving.
- Effective policy per project = project override ?? platform default ?? **nothing** — cleanup is opt-in: no policy anywhere means no run is ever deleted (file cleanup via `EXECUTION_DATA_RETENTION_DAYS` is unaffected and stays the fallback for log files).
- `RUN_RETENTION_CLEANUP` system job (cron `45 */1 * * *`) resolves policies into `(spec, projectIds)` groups, then per group loops: SELECT up to 1000 candidate ids (terminal status in `spec.statuses`, `finishTime < now - retentionDays`, `archivedAt IS NULL` unless `includeArchived`, oldest first) → `DELETE ... RETURNING id` capped at 100k per group per run; backlogs drain across hourly runs.
- Policy changes emit `run.retention.policy.updated` / `run.retention.policy.deleted` onto `applicationEvents` from the service (persisted to `audit_event` only on EE/Cloud, like all audit events).

### Gotchas
- **The delete re-checks every predicate inside the DELETE statement**, not just in the candidate SELECT — a run retried between SELECT and DELETE flips back to QUEUED with `finishTime = NULL` and must not be caught. Counts come from `DELETE ... RETURNING id`, never from the SELECT size, so a failed-and-retried pass cannot double-count: already-deleted rows simply match nothing on the next pass. (`DeleteResult.affected` is unreliable on the PGlite driver used in tests — `RETURNING` is the portable exact count.)
- **Executing and referenced runs are structurally excluded**: statuses are intersected with `TERMINAL_RUN_STATUSES` at query time (policy validation alone is not trusted), and `NOT EXISTS` clauses skip runs referenced as `parentRunId` by any surviving run and runs that still have waitpoints. Parent runs become eligible once their children are deleted, so subflow trees drain child-first across passes.
- This deletes `flow_run` **rows**; the log files (`FLOW_RUN_LOG` etc.) are reclaimed independently by the hourly `FILE_CLEANUP_TRIGGER` job keyed off `project.executionDataRetentionDays` — the two retention systems share nothing but the naming pattern. A run row can therefore outlive its logs (retry of such a run fails loud with `ENTITY_NOT_FOUND` on the missing slice), and logs can outlive the row.
- `TERMINAL_RUN_STATUSES` in `@activepieces/shared` is derived from `isFlowRunStateTerminal({ ignoreInternalError: false })` — INTERNAL_ERROR counts as terminal and is cleanable.

### Key files
- `packages/server/api/src/app/run-retention/` — entity, policy service, cleanup service, controller, module
- `packages/core/shared/src/lib/management/run-retention/` — `RunRetentionPolicy`, spec/request/response zod schemas, `TERMINAL_RUN_STATUSES`
- `packages/server/api/src/app/database/migration/postgres/1842000000000-AddRunRetentionPolicy.ts`
- `packages/server/api/test/integration/ce/run-retention/` — API, preview, and cleanup integration tests
