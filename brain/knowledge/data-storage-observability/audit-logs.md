---
icon: 📜
---

# Audit Logs

Records security-relevant actions for compliance and forensics, persisted to the `audit_event` table and queryable by platform admins. Enterprise/Cloud only, gated by `platform.plan.auditLogEnabled`.

### Entities & services
- **ApplicationEvent**: discriminated union of all auditable types; **ApplicationEventName** is a 27-value enum (`flow.created`, `flow.published`, `user.signed.in`, `variable.value.revealed`, etc.).
- `audit_event` entity: `action`, `userEmail`, `userId`, `projectId` (nullable), `data` (jsonb), `ip`. Composite indices on `(platformId, projectId, userId, action)` and narrower.
- `audit-event-service.ts`: `setup()` and `list()`.

### How it works
- `setup()` registers two fire-and-forget listeners on the `applicationEvents` bus — `userEvent` (user actions) and `workerEvent` (background actions) — so events are captured transparently without callers coupling to the audit code.
- `GET /v1/audit-events` (platformAdminOnly) returns `SeekPage<ApplicationEvent>` sorted by `created` desc. Filters: `action[]`, `projectId[]`, `userId`, `createdBefore/After`, cursor/limit.
- **Export** (`ee/audit-logs/audit-log-export-*.ts`): `POST /v1/audit-events/exports` creates an `audit_log_export` row (filters stored verbatim) and enqueues the `audit-log-export` **system job** (runs API-side, concurrency 5) — the request thread never scans the table. The job walks `auditLogService(log).streamAll()` keyset paginator (composite cursor on `(created DESC, id DESC)`, batch 1000), runs every event through `auditEventRedaction` (recursive key-name redaction for password/secret/token/key/credential-shaped keys, incl. camelCase), and pipes CSV/JSON straight into `fileService.save()` as a `FileType.AUDIT_LOG_EXPORT` stream with `enforceByteLimit(MAX_FILE_SIZE_MB)` in the pipe. Empty results still produce a file: CSV = metadata comment + header row, JSON = `{metadata, events:[]}` (schema shape). Output files sit on the file-cleanup schedule; a daily `audit-log-export-cleanup` system job also deletes export rows/files older than 7 days.
- One-time download: `POST /exports/:id/download-link` mints a 15-min JWT (audience `AUDIT_LOG_EXPORT_DOWNLOAD`, per-token `jti`) for an absolute URL; the public `GET /v1/audit-events/exports/:id/download?token=` route is mounted **outside** the `auditLogEnabled` feature-gate (the JWT is the credential) and atomically marks the `jti` used in Redis (`SET NX EX`) — the second use 401s before touching the file.
- **Download never buffers the whole file in the request thread**: `prepareDownload()` redeems the token, re-checks the export row's `platformId`/`fileId`, and loads only file metadata via `getPlatformFileOrThrow` (explicit `select` list that excludes the `data` bytea — a plain `findOneBy` would hydrate the whole blob). With `AP_S3_USE_SIGNED_URLS=true` it returns a short-lived (15-min) presigned GET and the controller 307-redirects the browser straight to S3/R2; otherwise it returns a Node `Readable` — `s3Helper.getFileStream()` (`GetObject` stream, returns the SDK Readable directly with NO `transformToByteArray` fallback) for S3, or a 1-MB-chunked readable for DB bytea — and Fastify pipes it with an attachment `Content-Disposition`. The old `getDataOrThrow` (full-file Buffer) path is gone from this route, and the API eslint config blocks `getDataOrThrow`/`getDataOrUndefined`/`s3Helper.getFile` calls anywhere under `ee/audit-logs` via `no-restricted-syntax`; `getDataOrThrow` itself carries a doc warning that it buffers and is not for download paths.
- **Retries**: the export job carries `maxAttempts` in its data and receives BullMQ `attemptsMade` via the `SystemJobHandler(data, job)` second arg; transient storage errors rethrow for BullMQ exponential backoff (attempts persisted on the row), while `FILE_TOO_LARGE` and the final attempt mark the row FAILED without further retries. Pitfall: `ActivepiecesError` carries its code on `error.error.code`; top-level `error.code` is absent, so classify via `extractErrorCode`.

### Gotchas
- `createAuditEvent()` in test mocks ignored `projectId`/`projectDisplayName` until the export tests needed them — both are now passed through.
- Event capture is decoupled via the event bus — new auditable actions just emit onto `applicationEvents`.
- **Emit from the service that performs the operation, not from each caller.** Controller-only emission is how #14591 happened: flow events lived in `flow.controller.ts`, so all 15 MCP flow tools plus `app-connection.handler.ts`, `worker-rpc-service.ts`, `project-state-helper.ts` and `platform-teardown-jobs.ts` mutated flows and audited nothing. Flow *runs* never had that bug because `flowRunSideEffects` is called from `flow-run-service.ts`. Put the `*-side-effects.ts` hook call inside the service and default it on; where a bulk/system path genuinely wants silence (project release apply, platform teardown), give it an explicit `emitEvents: false` opt-out so the decision is reviewable instead of accidental. Request-derived `ip` is optional in the schema — pass it down from the controller as one optional param rather than keeping emission up there to preserve it.
- The list endpoint sorts by `created DESC, id DESC` — `Paginator` appends the `id` tiebreaker itself (`withIdTiebreaker`), so the index has to cover **both** columns. `(platformId, created DESC)` alone leaves an Incremental Sort node on top; `(platformId, created DESC, id DESC)` is a plain index scan. Without either, Postgres reads every row for the platform (via the `platformId`-leading `action` index) and sorts the lot to return 11, so the page 500s on statement timeout (GIT-1705). Cloud prod, Aug 2026: `audit_event` is **362M rows / 475 GB**, one platform holding ~6.5M — plan cost 7.4M, and it never finishes. The table is never pruned (GIT-1574), so any new query shape here needs an index covering the sort, not just the filter.
- Building any index on `audit_event` in prod is an operation, not a migration step: at 475 GB `CREATE INDEX CONCURRENTLY` runs for hours, and migrations run in `main.ts` *before* the server listens — so a boot-time build never reaches the healthcheck and the deploy is rolled back on top of a half-built index. Build it by hand ahead of the deploy and let the migration's `IF NOT EXISTS` no-op. `CREATE INDEX CONCURRENTLY` also obeys `statement_timeout`, so `SET statement_timeout = 0` in the psql session doing the build (and expect the boot-time path to fail outright wherever a role-level timeout is set). A CONCURRENTLY build that gets killed leaves the index present but `indisvalid = false`, where a plain `IF NOT EXISTS` retry skips it and reports success on an index the planner will never use; the 1820 migration checks `pg_index.indisvalid` and drops the invalid leftover before rebuilding, for that reason.
- Anything you read about this paginator emitting `DATE_TRUNC('second', created)` cursors is stale — it now selects `created::text` and emits a plain composite cursor `(created < c) OR (created = c AND id < i)`, so the old "events in the same second get skipped across pages" bug is gone.
- `summarizeApplicationEvent()` builds detailed summaries (e.g. for `flow.updated`). `buildMockEvent()` yields a typed mock per event name, reused by event-destination test delivery.

### Key files
Entry point: `auditLogService`, wired up in `auditEventModule` which calls `.setup()` and mounts the controller at `/v1/audit-events`.

- `packages/server/api/src/app/ee/audit-logs/` — module, service, and TypeORM entity
- `packages/core/shared/src/lib/ee/audit-events/` — event types, the `ApplicationEvent` union, `summarizeApplicationEvent()`, and `buildMockEvent()`
- `packages/web/src/features/platform-admin/api/audit-events-api.ts` — frontend API client
- `packages/web/src/features/platform-admin/hooks/audit-log-hooks.ts` — React Query hooks
- `packages/web/src/app/routes/platform/security/audit-logs/` — platform admin UI page
- `packages/server/api/test/integration/cloud/audit-event/` — integration tests
- `docs/admin-guide/security/audit-logs/` — one user-facing doc page per event type

Paths verified 2026-07-17.
