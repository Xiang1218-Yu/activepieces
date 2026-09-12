---
icon: 📝
---

# Human Input

Human Input exposes public endpoints that let external users interact with flows via two modes: **Forms** (structured input fields) and **Chat** (conversational UI). Both are backed by flows whose trigger is the `@activepieces/piece-forms` piece. The backend endpoints are read-only and public — they return UI metadata (title, input schema, branding); the actual submission goes through the webhook endpoint.

### Entities & services
- `human-input.service.ts` — resolves flow, validates trigger type, builds response.
- Two controllers: `GET /v1/human-input/form/:flowId` and `GET /v1/human-input/chat/:flowId` (both `securityAccess.public()`).
- **Forms piece** provides three triggers: `form_submission`, `file_submission`, `chat_submission`.
- Frontend renders forms at `/forms/<flowId>` and chat at `/chat/<flowId>`.

### How it works
- **`getFormByFlowIdOrThrow`**: loads flow → if no published version and `useDraft` false, returns null (404) → asserts trigger is forms-piece `form_submission`/`file_submission` → resolves exact piece version. `file_submission` returns a hardcoded single-file schema (`SIMPLE_FILE_PROPS`); `form_submission` returns `trigger.settings.input`.
- **`getChatUIByFlowIdOrThrow`**: asserts `chat_submission` trigger → fetches platform logo + name → returns `ChatUIResponse` with branding embedded (supports white-labeled chat).
- Form input types: `text`, `text_area`, `toggle`, `file`.
- **`waitForResponse`**: when true, the flow run pauses after triggering and the frontend waits for a value to display back to the submitter.

### Gotchas
- Endpoints are fully public — anyone with the flow ID can read form/chat metadata (but only the UI definition, not execute).
- A flow without a published version returns 404 unless `useDraft=true` is passed — protects unpublished forms from accidental exposure.
- These endpoints only return the UI definition; triggering the flow itself goes through the webhook endpoint.

### Editions
Fully available in CE/EE/Cloud — no plan flag required.

### Form submission analytics
`packages/server/api/src/app/flows/form-analytics/` backs the **Form Analytics** page (`/form-analytics`, `READ_RUN`): a per-form conversion funnel (visited → started → submitted / failed / timed out / abandoned) broken down by date, flow version, and visitor attribution (anonymous vs signed-in), plus per-field abandonment (reached vs interacted).

- Two tables, both project-scoped and cascade-deleted with the flow/project: `form_session` (one funnel row per visitor attempt) and `form_field_interaction` (one reached/interacted row per session × field).
- Public tracking endpoints live under `/v1/form-analytics` (`securityAccess.public()`): `POST /sessions`, `/events`, `/field-interactions`, `/resolve-run`. Identity is best-effort — the controller calls `authenticateOrThrow` itself to tag `AUTHENTICATED` vs `ANONYMOUS`; no/invalid token = anonymous.
- **Refresh must not spawn sessions**: sessions are deduped per `(flowId, visitorKey, useDraft)` and an existing session is reused only while it is still in an open status (`VISITED`/`STARTED`); terminal sessions get a fresh row on the next visit. `visitorKey` is the `x-ap-form-session` header (a localStorage visitor id), falling back to request IP.
- **Run correlation**: sync submissions are linked inline in `webhook.service.handleSync` (the `x-ap-form-session` header is read by `extractFormSessionId` and the created run id is stored via `linkRunToSession`). Async submissions have no run at request time, so the page polls `POST /resolve-run`, which claims the latest unclaimed production run for the flow inside a ±time window around submission (`linkLatestRun`, guarded so one run can't be claimed by two sessions).
- **Deleted/expired submissions never appear in the detail**: `getFunnel` drops sessions whose run is missing or `archivedAt` is set, and drops sessions whose client reported a terminal event but no run ever materialised past the abandonment window (`FORM_SESSION_ABANDONMENT_MS`). Open sessions older than the window are classified `ABANDONED`.
- Funnel statuses are derived from **FlowRunStatus** (`mapRunStatus`: SUCCEEDED→SUBMITTED, FAILED-family/CANCELED→FAILED, TIMEOUT→TIMED_OUT) so the page matches the Runs list exactly; the client SUBMIT/FAILURE/TIMEOUT events only fill in until the run resolves. Draft (`useDraft=true`) sessions are recorded with `useDraft=true` and excluded from the production funnel query.

### Key files
Entry point: `humanInputService`, defined in the human-input service and called by both the form and chat controllers.

- `packages/server/api/src/app/flows/flow/human-input/` — the whole backend slice: both controllers, the service, and the module that registers them
- `packages/core/execution/src/lib/flows/form.ts` — shared zod contracts: `FormInputType`, `FormProps`, `FormResponse`, `ChatUIProps`, `ChatUIResponse`, `USE_DRAFT_QUERY_PARAM_NAME`
- `packages/web/src/features/forms/` — form rendering component, API client, and query hooks
- `packages/web/src/features/chat/` — chat UI components (bubble, input, message list, intro)
- `packages/web/src/app/routes/forms/` — public form page
- `packages/web/src/app/routes/form-analytics/` + `packages/web/src/features/form-analytics/` — internal conversion funnel / field-abandonment page and its API/hooks
- `packages/server/api/src/app/flows/form-analytics/` — sessions + field-interaction entities, public tracking controller, project-scoped funnel controller, reconciliation service
- `packages/web/src/app/routes/chat/` — public chat page, the reusable chat shell, and the in-builder Drawer wrapper for testing `chat_submission` flows
- `packages/web/src/app/builder/state/chat-state.ts` — builder-side chat state paired with the Drawer

Paths verified 2026-07-17. An earlier version pointed at `packages/core/shared/src/lib/automation/flows/form.ts`; it moved to `packages/core/execution/src/lib/flows/form.ts`.
