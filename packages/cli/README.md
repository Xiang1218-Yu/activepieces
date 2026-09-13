# @activepieces/cli

## Usage

```bash
npx @activepieces/cli <command>
```

### benchmark

Creates a flow (webhook trigger → data mapper → return response), publishes it, then load-tests
its synchronous webhook endpoint with [autocannon](https://github.com/mcollina/autocannon).
Defaults target a local dev environment.

Authenticate with a platform-admin API key. The CLI provisions a throwaway project for the run
(with a high concurrency cap so a project rate limiter can't skew the numbers) and deletes it after:

```bash
AP_API_KEY=<key> npx @activepieces/cli benchmark --url https://your-instance.example.com
```

| Option | Default | Description |
|---|---|---|
| `--url` | `http://localhost:3000` | Activepieces base URL (dev env API port) |
| `--requests` | `40 × concurrency` | Total requests to fire |
| `--concurrency` | auto = execution slots | Concurrent connections |
| `--api-key` | `AP_API_KEY` env | Platform-admin API key (Bearer) |
| `--body` | `{"test":true}` | JSON body sent to the webhook |
| `--json` | | Machine-readable output |

### flow runs

Lists recent flow runs for a project — useful in CI to check the latest runs without
opening the web app. Reads `GET /api/v1/flow-runs`, ordered by server recency (newest first).

```bash
AP_API_KEY=<key> npx @activepieces/cli flow runs \
  --url https://your-instance.example.com \
  --project <projectId> \
  --status FAILED --since 24h --json
```

| Option | Default | Description |
|---|---|---|
| `--url` | `http://localhost:3000` | Activepieces base URL |
| `--api-key` | `AP_API_KEY` env | API key with `READ_RUN` permission (env recommended for CI) |
| `--project` | | Project id to query (required) |
| `--flow <flowId>` | | Filter by flow id; repeatable or comma-separated |
| `--status <status>` | | Filter by run status; repeatable. Values: `FAILED`, `QUOTA_EXCEEDED`, `INTERNAL_ERROR`, `PAUSED`, `QUEUED`, `RUNNING`, `SUCCEEDED`, `MEMORY_LIMIT_EXCEEDED`, `TIMEOUT`, `CANCELED`, `LOG_SIZE_EXCEEDED` |
| `--after <iso>` | | Runs created at/after an ISO-8601 timestamp |
| `--before <iso>` | | Runs created at/before an ISO-8601 timestamp |
| `--since <duration>` | | Relative time window: `30m`, `24h`, `7d`, `2w` |
| `--cursor <cursor>` | | `nextCursor` from a previous call |
| `--limit <n>` | server default (10) | Page size, 1–100 |
| `--all` | | Follow `nextCursor` automatically (up to `--max-pages`) |
| `--max-pages <n>` | `100` | Safety cap for `--all` |
| `--include-archived` | off | Include archived runs (excluded by default, matching the API) |
| `--detail` | off | Fetch each run and show per-step status and error summaries |
| `--json` | | Machine-readable JSON on stdout; diagnostics go to stderr |

Exit codes: `0` ok, `2` bad arguments, `3` auth (401/403), `4` rate limited (429 after retries),
`5` server error (5xx), `6` network/timeout error, `7` request rejected (other 4xx).

`--detail` shows each step's name, type, status, duration and error message. Step inputs and
outputs — which contain resolved connection credentials — are never printed, in either output mode.
With `--json`, stdout holds a single JSON object (`data`, `nextCursor`, `previousCursor`,
`truncated`, …); all human diagnostics (pagination hints, retries, empty results) go to stderr.

## Building

Run `turbo run build --filter=@activepieces/cli` to build the library.

The publishable, self-contained bundle is produced by `npm run build-publish` (bundles workspace
deps with esbuild into `dist/`) and published via the **Release CLI** GitHub workflow.
