import axios, { AxiosError, AxiosInstance } from 'axios';
import chalk from 'chalk';
import { Command } from 'commander';
import { FlowRunStatus, SeekPage } from '@activepieces/shared';

const FLOW_RUNS_DOC = 'List recent flow runs for a project without opening the web app. Reads GET /api/v1/flow-runs.';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_AUTH = 3;
const EXIT_RATE_LIMITED = 4;
const EXIT_SERVER = 5;
const EXIT_TRANSPORT = 6;
const EXIT_CLIENT = 7;

const DEFAULT_URL = 'http://localhost:3000';
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const RATE_LIMIT_MAX_ATTEMPTS = 4;
const DETAIL_CONCURRENCY = 5;
const REDACTED = '[REDACTED]';

const TERMINAL_STATUSES = new Set<string>([
    FlowRunStatus.SUCCEEDED,
    FlowRunStatus.FAILED,
    FlowRunStatus.TIMEOUT,
    FlowRunStatus.QUOTA_EXCEEDED,
    FlowRunStatus.MEMORY_LIMIT_EXCEEDED,
    FlowRunStatus.LOG_SIZE_EXCEEDED,
    FlowRunStatus.INTERNAL_ERROR,
]);

const FLOW_RUN_STATUSES = new Set<string>(Object.values(FlowRunStatus));
const BEARER_PATTERN = /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|Bearer\s+[A-Za-z0-9._~+/-]{20,})/g;

export function createFlowRunsCommand(): Command {
    return new Command('runs')
    .description(FLOW_RUNS_DOC)
    .option('--url <url>', 'Activepieces base URL', DEFAULT_URL)
    .option('--api-key <key>', 'API key with READ_RUN permission (or set AP_API_KEY env var; env recommended for CI)')
    .requiredOption('--project <projectId>', 'Project id to query')
    .option('--flow <flowId...>', 'Filter by flow id (repeatable, or comma-separated)')
    .option('--status <status...>', `Filter by run status (repeatable): ${Object.values(FlowRunStatus).join('|')}`)
    .option('--after <iso>', 'Only runs created at or after this ISO-8601 timestamp (e.g. 2026-09-01T00:00:00Z)')
    .option('--before <iso>', 'Only runs created at or before this ISO-8601 timestamp')
    .option('--since <duration>', 'Only runs from the last duration, e.g. 30m, 24h, 7d, 2w')
    .option('--cursor <cursor>', 'Pagination cursor (nextCursor) returned by a previous invocation')
    .option('--limit <n>', `Page size, 1-${MAX_PAGE_SIZE} (server default ${DEFAULT_PAGE_SIZE})`)
    .option('--all', 'Follow nextCursor and fetch every page up to --max-pages')
    .option('--max-pages <n>', 'Safety cap when using --all', '100')
    .option('--include-archived', 'Include archived runs (excluded by default, matching the API)')
    .option('--detail', 'Fetch each run and include per-step status and error summaries (never includes step inputs, outputs, or auth values)')
    .option('--json', 'Emit machine-readable JSON on stdout; diagnostics go to stderr')
    .action(async (opts) => {
        let config: FlowRunsConfig;
        try {
            config = flowRunsUtils.normalizeOptions(opts);
        } catch (e) {
            failUsage(e instanceof Error ? e.message : String(e));
            return;
        }

        const client = createClient(config);
        let page: RunsPage;
        try {
            page = await fetchRuns({ client, config });
            if (config.detail) {
                await attachDetails({ client, config, runs: page.runs });
            }
        } catch (e) {
            handleFailure(config, e);
            return;
        }
        emit(config, page);
        process.exit(EXIT_OK);
    });
}

function normalizeOptions(opts: Record<string, unknown>): FlowRunsConfig {
    const apiKey = typeof opts['apiKey'] === 'string' && opts['apiKey'].length > 0
        ? opts['apiKey']
        : process.env.AP_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new Error('Missing API key: pass --api-key <key> or set the AP_API_KEY environment variable. AP_API_KEY is recommended in CI to keep secrets out of process arguments.');
    }

    const statuses: FlowRunStatus[] = [];
    for (const rawStatus of parseStringArray(opts['status'])) {
        const status = rawStatus.toUpperCase();
        if (!flowRunsUtils.isFlowRunStatus(status)) {
            throw new Error(`Invalid --status "${status}". Valid values: ${Object.values(FlowRunStatus).join(', ')}`);
        }
        statuses.push(status);
    }
    const flowIds = parseStringArray(opts['flow']);
    for (const flowId of flowIds) {
        if (!/^[A-Za-z0-9]{20,}$/.test(flowId)) {
            throw new Error(`Invalid --flow id "${flowId}". Expected an Activepieces id.`);
        }
    }

    const limit = opts['limit'] === undefined ? undefined : parsePositiveInt(String(opts['limit']), '--limit');
    if (limit !== undefined && limit > MAX_PAGE_SIZE) {
        throw new Error(`--limit must be at most ${MAX_PAGE_SIZE}.`);
    }
    const maxPages = parsePositiveInt(String(opts['maxPages'] ?? '100'), '--max-pages');

    let createdAfter: string | undefined;
    if (typeof opts['after'] === 'string') {
        createdAfter = requireIsoTimestamp(opts['after'], '--after');
    }
    if (typeof opts['since'] === 'string') {
        const sinceIso = new Date(Date.now() - flowRunsUtils.parseSinceDuration(opts['since']).ms).toISOString();
        if (createdAfter === undefined || Date.parse(sinceIso) > Date.parse(createdAfter)) {
            createdAfter = sinceIso;
        }
    }
    const createdBefore = typeof opts['before'] === 'string'
        ? requireIsoTimestamp(opts['before'], '--before')
        : undefined;
    if (createdAfter !== undefined && createdBefore !== undefined && Date.parse(createdAfter) > Date.parse(createdBefore)) {
        throw new Error('--after/--since must be earlier than --before.');
    }

    return {
        url: stripTrailingSlash(typeof opts['url'] === 'string' ? opts['url'] : DEFAULT_URL),
        apiKey,
        projectId: requireString(opts['project'], '--project'),
        flowIds,
        statuses,
        createdAfter,
        createdBefore,
        cursor: typeof opts['cursor'] === 'string' ? opts['cursor'] : undefined,
        limit,
        fetchAll: opts['all'] === true,
        maxPages,
        includeArchived: opts['includeArchived'] === true,
        detail: opts['detail'] === true,
        json: opts['json'] === true,
    };
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Missing required option ${name}`);
    }
    return value;
}

function parseStringArray(value: unknown): string[] {
    if (value === undefined) return [];
    const values = Array.isArray(value) ? value : [value];
    return values
        .flatMap((v) => String(v).split(','))
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
}

function parsePositiveInt(value: string, flag: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`${flag} must be a positive integer, got "${value}"`);
    }
    return n;
}

function requireIsoTimestamp(value: string, flag: string): string {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        throw new Error(`${flag} must be an ISO-8601 timestamp (e.g. 2026-09-01T00:00:00Z), got "${value}"`);
    }
    return new Date(parsed).toISOString();
}

function parseSinceDuration(value: string): { ms: number } {
    const match = /^(\d+)\s*([mhdw])$/.exec(value.trim().toLowerCase());
    if (!match) {
        throw new Error(`--since must be a duration like 30m, 24h, 7d, 2w, got "${value}"`);
    }
    const amount = Number(match[1]);
    const unitMs: Record<string, number> = {
        m: 60_000,
        h: 3_600_000,
        d: 86_400_000,
        w: 7 * 86_400_000,
    };
    return { ms: amount * unitMs[match[2]] };
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function isFlowRunStatus(value: string): value is FlowRunStatus {
    return FLOW_RUN_STATUSES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createClient(config: FlowRunsConfig): AxiosInstance {
    return axios.create({
        baseURL: config.url,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
        paramsSerializer: {
            serialize: serializeQueryParams,
        },
    });
}

function serializeQueryParams(params: Record<string, unknown>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) search.append(key, String(item));
        } else {
            search.append(key, String(value));
        }
    }
    return search.toString();
}

async function fetchRuns({ client, config }: FetchRunsParams): Promise<RunsPage> {
    const runs: RunListItem[] = [];
    let cursor = config.cursor;
    let nextCursor: string | null = null;
    let previousCursor: string | null = null;
    let pagesFetched = 0;

    do {
        const params: Record<string, unknown> = { projectId: config.projectId };
        if (config.flowIds.length > 0) params['flowId'] = config.flowIds;
        if (config.statuses.length > 0) params['status'] = config.statuses;
        if (config.createdAfter !== undefined) params['createdAfter'] = config.createdAfter;
        if (config.createdBefore !== undefined) params['createdBefore'] = config.createdBefore;
        if (config.limit !== undefined) params['limit'] = config.limit;
        if (config.includeArchived) params['includeArchived'] = true;
        if (cursor) params['cursor'] = cursor;

        const page = await getFlowRunsPage({ client, config, params });
        for (const item of page.data) {
            const run = projectRun(item);
            if (run) runs.push(run);
        }
        nextCursor = page.next;
        previousCursor = page.previous;
        pagesFetched += 1;
        cursor = page.next ?? undefined;
    } while (config.fetchAll && cursor !== undefined && pagesFetched < config.maxPages);

    return {
        runs,
        nextCursor,
        previousCursor,
        pagesFetched,
        truncated: config.fetchAll && nextCursor !== null && pagesFetched >= config.maxPages,
    };
}

async function getFlowRunsPage({ client, config, params }: GetFlowRunsPageParams): Promise<SeekPage<Record<string, unknown>>> {
    let attempt = 0;
    while (true) {
        const result = await rawGet({ client, path: '/api/v1/flow-runs', params });
        if (!result.ok) {
            throw new TransportFailure(result.error);
        }
        const { status, data, headers } = result.response;
        if (status === 200) {
            const page = parseSeekPage(data);
            if (!page) {
                throw new ServerFailure(status, 'Malformed response body: expected a SeekPage with a data array.');
            }
            return page;
        }
        if (status === 401) {
            throw new AuthFailure(status, 'Authentication failed (401): the API key is missing, invalid, or expired.');
        }
        if (status === 403) {
            throw new AuthFailure(status, `Permission denied (403): this API key cannot read runs in project ${config.projectId}.`);
        }
        if (status === 429) {
            if (attempt >= RATE_LIMIT_MAX_ATTEMPTS - 1) {
                throw new RateLimitFailure(status, `Rate limited (429) after ${RATE_LIMIT_MAX_ATTEMPTS} attempts.`);
            }
            const waitMs = retryAfterMs(headers) ?? backoffMs(attempt);
            writeErr(chalk.yellow(`Rate limited by server (429); retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 2}/${RATE_LIMIT_MAX_ATTEMPTS})`));
            await sleep(waitMs);
            attempt += 1;
            continue;
        }
        if (status >= 500) {
            throw new ServerFailure(status, `Server error (HTTP ${status}).`);
        }
        throw new ClientFailure(status, `Request rejected (HTTP ${status}): ${summarizeBody(data)}`);
    }
}

function parseSeekPage(body: unknown): SeekPage<Record<string, unknown>> | null {
    if (!isRecord(body) || !Array.isArray(body['data'])) return null;
    const items = body['data'].filter(isRecord);
    return {
        data: items,
        next: typeof body['next'] === 'string' ? body['next'] : null,
        previous: typeof body['previous'] === 'string' ? body['previous'] : null,
    };
}

type RawResponse = { status: number; data: unknown; headers: Record<string, unknown> };
type RawGetResult = { ok: true; response: RawResponse } | { ok: false; error: AxiosError };

async function rawGet({ client, path, params }: { client: AxiosInstance; path: string; params: Record<string, unknown> }): Promise<RawGetResult> {
    try {
        const res = await client.get(path, { params });
        const headers: Record<string, unknown> = {};
        if (isRecord(res.headers)) {
            for (const [key, value] of Object.entries(res.headers)) headers[key.toLowerCase()] = value;
        }
        return { ok: true, response: { status: res.status, data: res.data, headers } };
    } catch (e) {
        if (e instanceof AxiosError) {
            return { ok: false, error: e };
        }
        throw e;
    }
}

function retryAfterMs(headers: Record<string, unknown>): number | undefined {
    const raw = headers['retry-after'];
    if (typeof raw !== 'string') return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 60_000);
    }
    const dateMs = Date.parse(raw);
    if (!Number.isNaN(dateMs)) {
        return Math.min(Math.max(dateMs - Date.now(), 0), 60_000);
    }
    return undefined;
}

function backoffMs(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, 15_000);
}

function summarizeBody(body: unknown): string {
    if (isRecord(body) && typeof body['message'] === 'string') {
        return body['message'];
    }
    try {
        return JSON.stringify(body);
    } catch {
        return String(body);
    }
}

async function attachDetails({ client, config, runs }: AttachDetailsParams): Promise<void> {
    const queue = [...runs];
    const workers = Array.from({ length: Math.min(DETAIL_CONCURRENCY, runs.length) }, async () => {
        while (queue.length > 0) {
            const run = queue.pop();
            if (!run) return;
            run.steps = await fetchRunSteps({ client, config, runId: run.id });
        }
    });
    await Promise.all(workers);
}

async function fetchRunSteps({ client, config, runId }: FetchRunStepsParams): Promise<StepSummary[]> {
    const result = await rawGet({
        client,
        path: `/api/v1/flow-runs/${encodeURIComponent(runId)}`,
        params: { projectId: config.projectId },
    });
    if (!result.ok) {
            writeErr(chalk.yellow(`Could not load details for run ${runId}: ${describeTransportError(result.error)}`));
        return [];
    }
    const { status } = result.response;
    if (status !== 200) {
        writeErr(chalk.yellow(`Could not load details for run ${runId} (HTTP ${status}); showing list data only`));
        return [];
    }
    return summarizeSteps(result.response.data);
}

function summarizeSteps(body: unknown): StepSummary[] {
    if (!isRecord(body) || !isRecord(body['steps'])) return [];
    return Object.entries(body['steps'])
        .map(([name, value]) => toStepSummary(name, value))
        .filter((step): step is StepSummary => step !== null);
}

function toStepSummary(name: string, value: unknown): StepSummary | null {
    if (!isRecord(value)) return null;
    const status = typeof value['status'] === 'string' ? value['status'] : 'UNKNOWN';
    return {
        name,
        type: typeof value['type'] === 'string' ? value['type'] : 'UNKNOWN',
        status,
        durationMs: typeof value['duration'] === 'number' ? value['duration'] : null,
        error: extractStepError(value),
    };
}

function extractStepError(record: Record<string, unknown>): string | null {
    if (typeof record['errorMessage'] !== 'string' || record['errorMessage'].length === 0) return null;
    return sanitizeErrorText(record['errorMessage']);
}

function sanitizeErrorText(text: string): string {
    return text.replace(BEARER_PATTERN, REDACTED);
}

function projectRun(item: Record<string, unknown>): RunListItem | null {
    if (typeof item['id'] !== 'string' || typeof item['flowId'] !== 'string') return null;
    const status = typeof item['status'] === 'string' && isFlowRunStatus(item['status']) ? item['status'] : 'UNKNOWN';
    return {
        id: item['id'],
        flowId: item['flowId'],
        flowDisplayName: optionalString(item['flowVersion'], 'displayName'),
        projectId: typeof item['projectId'] === 'string' ? item['projectId'] : '',
        status,
        startTime: typeof item['startTime'] === 'string' ? item['startTime'] : null,
        finishTime: typeof item['finishTime'] === 'string' ? item['finishTime'] : null,
        durationMs: runDurationMs(item),
        archivedAt: typeof item['archivedAt'] === 'string' ? item['archivedAt'] : null,
        environment: typeof item['environment'] === 'string' ? item['environment'] : 'UNKNOWN',
        failedStep: projectFailedStep(item['failedStep']),
        steps: null,
    };
}

function optionalString(value: unknown, key: string): string | null {
    if (isRecord(value) && typeof value[key] === 'string') return value[key];
    return null;
}

function projectFailedStep(value: unknown): RunListItem['failedStep'] {
    if (!isRecord(value) || typeof value['name'] !== 'string' || typeof value['displayName'] !== 'string') {
        return null;
    }
    const message = typeof value['message'] === 'string' ? sanitizeErrorText(value['message']) : null;
    return { name: value['name'], displayName: value['displayName'], message };
}

function runDurationMs(item: Record<string, unknown>): number | null {
    if (typeof item['startTime'] !== 'string' || typeof item['finishTime'] !== 'string') return null;
    const started = Date.parse(item['startTime']);
    const finished = Date.parse(item['finishTime']);
    if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) return null;
    return finished - started;
}

function emit(config: FlowRunsConfig, page: RunsPage): void {
    if (config.json) {
        emitJson(page);
    } else {
        renderHuman(config, page);
    }
}

function emitJson(page: RunsPage): void {
    const payload: JsonOutput = {
        projectId: page.runs.length > 0 ? page.runs[0].projectId : '',
        pagesFetched: page.pagesFetched,
        nextCursor: page.nextCursor,
        previousCursor: page.previousCursor,
        truncated: page.truncated,
        count: page.runs.length,
        data: page.runs,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    if (page.runs.length === 0) {
        writeErr('No flow runs matched the filters.');
    } else if (page.nextCursor) {
        writeErr("More results available — re-run with --cursor '<nextCursor from above>' or --all.");
    }
}

function renderHuman(config: FlowRunsConfig, page: RunsPage): void {
    if (page.runs.length === 0) {
        writeOut(chalk.yellow('No flow runs matched the filters.'));
        return;
    }
    writeOut(chalk.bold(`Flow runs for project ${config.projectId}`));
    for (const run of page.runs) {
        const name = run.flowDisplayName ?? run.flowId;
        writeOut(`  ${statusBadge(run.status)} ${chalk.bold(name)} ${chalk.gray(`run ${run.id}`)}`);
        writeOut(`    started  : ${run.startTime ?? 'n/a'}${run.durationMs === null ? '' : chalk.gray(`   duration ${formatDuration(run.durationMs)}`)}`);
        if (run.failedStep) {
            const message = run.failedStep.message ? ` — ${truncate(run.failedStep.message, 300)}` : '';
            writeOut(`    failed at: ${run.failedStep.displayName} (${run.failedStep.name})${chalk.red(message)}`);
        }
        if (run.steps) {
            renderSteps(run.steps);
        }
    }
    writeOut(chalk.gray(`\n${page.runs.length} run(s) across ${page.pagesFetched} page(s).`));
    if (page.truncated) {
        writeErr(chalk.yellow(`Stopped at --max-pages (${config.maxPages}); narrow the time range or raise the cap, then continue with --cursor '${page.nextCursor}'.`));
    } else if (page.nextCursor) {
        writeErr(chalk.gray(`Next page: re-run with --cursor '${page.nextCursor}'${config.fetchAll ? '' : ', or use --all'} to page automatically.`));
    }
}

function renderSteps(steps: StepSummary[]): void {
    if (steps.length === 0) {
        writeOut(chalk.gray('    steps: no persisted step data (run pruned, still queued, or server predates step logs)'));
        return;
    }
    for (const step of steps) {
        const duration = step.durationMs === null ? '' : chalk.gray(` ${formatDuration(step.durationMs)}`);
        const suffix = step.error ? chalk.red(` — ${truncate(step.error, 200)}`) : '';
        writeOut(`    ${stepStatusBadge(step.status)} ${step.name} ${chalk.gray(`[${step.type}]`)}${duration}${suffix}`);
    }
}

function statusBadge(status: string): string {
    if (status === FlowRunStatus.SUCCEEDED) return chalk.green(status.padEnd(20));
    if (status === FlowRunStatus.CANCELED) return chalk.gray(status.padEnd(20));
    if (TERMINAL_STATUSES.has(status)) return chalk.red(status.padEnd(20));
    return chalk.cyan(status.padEnd(20));
}

function stepStatusBadge(status: string): string {
    switch (status) {
        case 'SUCCEEDED':
        case 'STOPPED':
            return chalk.green(status.padEnd(10));
        case 'FAILED':
            return chalk.red(status.padEnd(10));
        case 'PAUSED':
        case 'RUNNING':
            return chalk.cyan(status.padEnd(10));
        default:
            return chalk.yellow(status.padEnd(10));
    }
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(text: string, max: number): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function writeOut(message: string): void {
    process.stdout.write(`${message}\n`);
}

function writeErr(message: string): void {
    process.stderr.write(`${message}\n`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeTransportError(error: AxiosError): string {
    if (error.code === 'ECONNABORTED') return `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
    if (error.code === 'ECONNREFUSED') return 'connection refused';
    if (error.code === 'ENOTFOUND') return 'host not found (DNS)';
    if (error.code === 'ETIMEDOUT') return 'network timeout';
    return error.message;
}

function handleFailure(config: FlowRunsConfig, e: unknown): void {
    if (e instanceof AuthFailure) {
        emitError(config, EXIT_AUTH, 'AUTH_ERROR', e.message);
        return;
    }
    if (e instanceof RateLimitFailure) {
        emitError(config, EXIT_RATE_LIMITED, 'RATE_LIMITED', e.message);
        return;
    }
    if (e instanceof ServerFailure) {
        emitError(config, EXIT_SERVER, 'SERVER_ERROR', e.message);
        return;
    }
    if (e instanceof ClientFailure) {
        emitError(config, EXIT_CLIENT, 'CLIENT_ERROR', e.message);
        return;
    }
    if (e instanceof TransportFailure) {
        emitError(config, EXIT_TRANSPORT, 'NETWORK_ERROR', `Could not reach ${config.url}: ${describeTransportError(e.cause)}`);
        return;
    }
    emitError(config, EXIT_TRANSPORT, 'UNEXPECTED_ERROR', e instanceof Error ? e.message : String(e));
}

function emitError(config: FlowRunsConfig, exitCode: number, code: string, message: string): void {
    if (config.json) {
        process.stdout.write(JSON.stringify({ error: { code, message } }) + '\n');
    } else {
        writeErr(chalk.red(message));
    }
    process.exit(exitCode);
}

function failUsage(message: string): void {
    writeErr(chalk.red(message));
    process.exit(EXIT_USAGE);
}

class AuthFailure extends Error {
    constructor(readonly httpStatus: number, message: string) {
        super(message);
    }
}

class RateLimitFailure extends Error {
    constructor(readonly httpStatus: number, message: string) {
        super(message);
    }
}

class ServerFailure extends Error {
    constructor(readonly httpStatus: number, message: string) {
        super(message);
    }
}

class ClientFailure extends Error {
    constructor(readonly httpStatus: number, message: string) {
        super(message);
    }
}

class TransportFailure extends Error {
    constructor(readonly cause: AxiosError) {
        super(cause.message);
    }
}

export const flowRunsUtils = {
    normalizeOptions,
    parseSinceDuration,
    projectRun,
    summarizeSteps,
    sanitizeErrorText,
    isFlowRunStatus,
    serializeQueryParams,
    parseSeekPage,
};

type FlowRunsConfig = {
    url: string;
    apiKey: string;
    projectId: string;
    flowIds: string[];
    statuses: FlowRunStatus[];
    createdAfter?: string;
    createdBefore?: string;
    cursor?: string;
    limit?: number;
    fetchAll: boolean;
    maxPages: number;
    includeArchived: boolean;
    detail: boolean;
    json: boolean;
};

type FetchRunsParams = { client: AxiosInstance; config: FlowRunsConfig };
type GetFlowRunsPageParams = { client: AxiosInstance; config: FlowRunsConfig; params: Record<string, unknown> };
type AttachDetailsParams = { client: AxiosInstance; config: FlowRunsConfig; runs: RunListItem[] };
type FetchRunStepsParams = { client: AxiosInstance; config: FlowRunsConfig; runId: string };

type RunListItem = {
    id: string;
    flowId: string;
    flowDisplayName: string | null;
    projectId: string;
    status: string;
    startTime: string | null;
    finishTime: string | null;
    durationMs: number | null;
    archivedAt: string | null;
    environment: string;
    failedStep: { name: string; displayName: string; message: string | null } | null;
    steps: StepSummary[] | null;
};

type StepSummary = {
    name: string;
    type: string;
    status: string;
    durationMs: number | null;
    error: string | null;
};

type RunsPage = {
    runs: RunListItem[];
    nextCursor: string | null;
    previousCursor: string | null;
    pagesFetched: number;
    truncated: boolean;
};

type JsonOutput = {
    projectId: string;
    pagesFetched: number;
    nextCursor: string | null;
    previousCursor: string | null;
    truncated: boolean;
    count: number;
    data: RunListItem[];
};
