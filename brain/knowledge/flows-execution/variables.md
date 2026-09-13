---
icon: 🔒
---

# Variables

Project-scoped, encrypted secret values (API keys, tokens) users create once and reference in any flow input via `{{variables['NAME']}}`. Stored in a dedicated `variable` table, fully separate from `app_connection`. Ships in every edition (no plan flag).

### Entities & services
- **Variable**: unique `(projectId, name)`. `name` is immutable, regex `^[a-zA-Z0-9_]+$`, used as both label and mention key. `value` stored as `EncryptedObject` (`{iv,data}`) wrapping `{secret_text}`.
- **VariableType**: `SECRET` (default; existing rows migrated with `DEFAULT 'SECRET'`) vs `TEXT`. Both stay encrypted at rest — `type` only changes API display behaviour: single-resource responses carry the decrypted `value` for `TEXT` rows, never for `SECRET` (those need the reveal endpoint). List responses only attach TEXT values when the caller passes `includeValues=true` — the Variables page does, the Flow Builder selector and mention editor do not, so their payloads never contain values.
- `variable.service.ts` (upsert/list/delete/reveal/decrypt-for-worker); `variable-worker.controller.ts` is the engine-only route.
- Encryption: `encryptUtils.encryptObject` (AES-256-CBC) on write; decrypted on reveal and worker fetch.
- List filters: `name` (ILIKE), `type` (repeatable param), `updatedAfter`/`updatedBefore` (ISO strings, invalid values silently ignored), `usedInFlows=true|false` (repeatable; both selected = no filter).
- **Usage** (`usedInFlows` on `VariableListItem`) is computed per list call by `getUsedVariableNames`: one query extracts mention names from `flow_version.trigger::text` via `regexp_matches(..., 'variables\[''([a-zA-Z0-9_]+)''\]', 'g')`, scoped to each flow's published OR latest version (same heuristic as `findFlowsUsingPiece`). The `usedInFlows` filter then becomes a `variable.name IN/NOT IN (:...usedNames)` condition — kept out of the main `.where({...})` object because `name` is already taken by the ILIKE filter.

### How it works
- User routes `/v1/variables`: POST upsert, GET list, DELETE. Reveal is `POST /:id/reveal`, **USER-only** (no SERVICE keys).
- Engine resolves mentions via `GET /v1/worker/variables/:name` using the engine principal token. `resolveSingleToken` checks `variables` prefix first, then `connections`, then step refs. Mention always resolves to a string (no sub-field access).
- Permissions: `READ_VARIABLE` (VIEWER+), `WRITE_VARIABLE` (EDITOR/ADMIN, needed for create/rotate/delete/reveal/type change).
- Frontend: `variablesQueries.useVariables` keys the query as `['variables', request]` — the **entire request object is the key**, so a slow response for a stale filter/page can only land in its own cache entry and never overwrites the current query. Do not reintroduce hand-maintained `extraKeys`; that was the stale-overwrite hazard.

### Gotchas
- The create/rotate dialog value field is deliberately **NOT** `type="password"` (Chrome's leaked-password breach check + password-manager prompt, GIT-1619). It's `type="text"` masked with CSS `-webkit-text-security: disc`, `autoComplete="off"`, `spellCheck={false}`. Firefox < 118 renders unmasked (acceptable — only holds text being typed).
- Every reveal fires `VARIABLE_VALUE_REVEALED` (audit event `variable.value.revealed`) — use it for "who pulled variable X and when". Also `VARIABLE_UPSERTED`, `VARIABLE_DELETED`.
- The list page masks SECRET values by default (`VariableValueCell`); the eye toggle calls reveal, so it only renders for `WRITE_VARIABLE` holders. The Flow Builder selector and the mention editor (`tiptap-editor`) read names only and never receive values in their list payload (no `includeValues`).
- `usedInFlows` only sees mentions in each flow's published or latest version — a variable referenced solely by an older version reads as unused.

### Key files
Entry point: `variableModule`, registered in `packages/server/api/src/app/app.ts`.

- `packages/server/api/src/app/variable/` — entity, service, REST + worker controllers, Fastify module
- `packages/server/api/src/app/database/migration/postgres/1793000000000-AddVariableTable.ts` — schema migration; `1842000000000-AddTypeToVariable.ts` adds the `type` column
- `packages/server/engine/src/lib/piece-context/variable-resolver.ts` — engine-side resolver, mirrors `connection-resolver.ts`
- `packages/server/engine/src/lib/variables/props-resolver.ts` — the `variables` branch of `resolveSingleToken`
- `packages/core/shared/src/lib/automation/variable/` — `Variable` types, name regex, upsert/read request DTOs
- `packages/web/src/features/variables/` — frontend client + TanStack Query hooks
- `packages/web/src/app/routes/variables/` — the `/variables` list page
- `packages/web/src/app/variables/` — create / rotate dialog, reused by the page and the data-selector tab
- `packages/web/src/app/builder/data-selector/variables-tab.tsx` — builder panel for inserting mentions

Paths verified 2026-07-17.
