import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { Server } from 'http';
import { FlowRunStatus } from '@activepieces/shared';
import { flowRunsUtils } from './flow-runs';

const baseOpts = {
    url: 'http://example.com/',
    apiKey: 'test-key',
    project: '01234567890123456789',
};

describe('flowRunsUtils.normalizeOptions', () => {
    afterEach(() => {
        delete process.env.AP_API_KEY;
    });

    it('parses required options and strips the trailing slash', () => {
        const config = flowRunsUtils.normalizeOptions(baseOpts);
        expect(config.url).toBe('http://example.com');
        expect(config.projectId).toBe(baseOpts.project);
        expect(config.flowIds).toEqual([]);
        expect(config.statuses).toEqual([]);
        expect(config.fetchAll).toBe(false);
        expect(config.detail).toBe(false);
        expect(config.json).toBe(false);
        expect(config.includeArchived).toBe(false);
    });

    it('falls back to AP_API_KEY when --api-key is absent', () => {
        process.env.AP_API_KEY = 'env-key';
        const config = flowRunsUtils.normalizeOptions({ ...baseOpts, apiKey: undefined });
        expect(config.apiKey).toBe('env-key');
    });

    it('fails without any API key', () => {
        expect(() => flowRunsUtils.normalizeOptions({ ...baseOpts, apiKey: undefined })).toThrow(/API key/);
    });

    it('accepts repeatable and comma-separated status values and uppercases them', () => {
        const repeated = flowRunsUtils.normalizeOptions({ ...baseOpts, status: ['failed', 'TIMEOUT'] });
        expect(repeated.statuses).toEqual([FlowRunStatus.FAILED, FlowRunStatus.TIMEOUT]);
        const csv = flowRunsUtils.normalizeOptions({ ...baseOpts, status: 'failed,timeout' });
        expect(csv.statuses).toEqual([FlowRunStatus.FAILED, FlowRunStatus.TIMEOUT]);
    });

    it('rejects unknown status values', () => {
        expect(() => flowRunsUtils.normalizeOptions({ ...baseOpts, status: ['BOGUS'] })).toThrow(/Invalid --status/);
    });

    it('accepts repeatable flow ids', () => {
        const config = flowRunsUtils.normalizeOptions({
            ...baseOpts,
            flow: ['AAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBB'],
        });
        expect(config.flowIds).toEqual(['AAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBB']);
    });

    it('rejects malformed flow ids', () => {
        expect(() => flowRunsUtils.normalizeOptions({ ...baseOpts, flow: ['not-an-id'] })).toThrow(/--flow/);
    });

    it('parses limit and enforces the 1-100 range', () => {
        expect(flowRunsUtils.normalizeOptions({ ...baseOpts, limit: '50' }).limit).toBe(50);
        expect(() => flowRunsUtils.normalizeOptions({ ...baseOpts, limit: '0' })).toThrow(/--limit/);
        expect(() => flowRunsUtils.normalizeOptions({ ...baseOpts, limit: '101' })).toThrow(/at most 100/);
    });

    it('parses ISO timestamps for --after/--before', () => {
        const config = flowRunsUtils.normalizeOptions({
            ...baseOpts,
            after: '2026-09-01T10:00:00Z',
            before: '2026-09-02',
        });
        expect(config.createdAfter).toBe('2026-09-01T10:00:00.000Z');
        expect(config.createdBefore).toBe('2026-09-02T00:00:00.000Z');
    });

    it('rejects unparseable timestamps and inverted ranges', () => {
        expect(() => flowRunsUtils.normalizeOptions({ ...baseOpts, after: 'yesterday' })).toThrow(/ISO-8601/);
        expect(() => flowRunsUtils.normalizeOptions({
            ...baseOpts,
            after: '2026-09-02T00:00:00Z',
            before: '2026-09-01T00:00:00Z',
        })).toThrow(/earlier than/);
    });

    it('parses --since durations', () => {
        expect(flowRunsUtils.parseSinceDuration('30m').ms).toBe(30 * 60_000);
        expect(flowRunsUtils.parseSinceDuration('24h').ms).toBe(24 * 3_600_000);
        expect(flowRunsUtils.parseSinceDuration('7d').ms).toBe(7 * 86_400_000);
        expect(flowRunsUtils.parseSinceDuration('2w').ms).toBe(14 * 86_400_000);
        expect(() => flowRunsUtils.parseSinceDuration('3x')).toThrow(/--since/);
    });
});

describe('flowRunsUtils.serializeQueryParams', () => {
    it('repeats keys for arrays and skips nullish values', () => {
        const serialized = flowRunsUtils.serializeQueryParams({
            projectId: 'p1',
            status: ['FAILED', 'TIMEOUT'],
            cursor: undefined,
            includeArchived: true,
            limit: 50,
        });
        expect(serialized).toBe('projectId=p1&status=FAILED&status=TIMEOUT&includeArchived=true&limit=50');
    });
});

describe('flowRunsUtils.parseSeekPage', () => {
    it('maps a SeekPage body and tolerates non-object rows', () => {
        const page = flowRunsUtils.parseSeekPage({ data: [{ id: 'r1' }, 'junk', null], next: 'cur1', previous: null });
        expect(page).toEqual({ data: [{ id: 'r1' }], next: 'cur1', previous: null });
    });

    it('rejects bodies without a data array', () => {
        expect(flowRunsUtils.parseSeekPage({ foo: 1 })).toBeNull();
    });
});

describe('flowRunsUtils.projectRun', () => {
    it('projects list rows into the CLI shape and computes duration', () => {
        const run = flowRunsUtils.projectRun({
            id: 'run1',
            projectId: 'proj1',
            flowId: 'flow1',
            flowVersion: { displayName: 'My Flow' },
            status: 'FAILED',
            startTime: '2026-09-12T10:00:00.000Z',
            finishTime: '2026-09-12T10:00:01.500Z',
            environment: 'PRODUCTION',
            failedStep: { name: 'step_1', displayName: 'Do Thing', message: 'boom' },
        });
        expect(run).not.toBeNull();
        expect(run?.flowDisplayName).toBe('My Flow');
        expect(run?.durationMs).toBe(1500);
        expect(run?.status).toBe(FlowRunStatus.FAILED);
        expect(run?.steps).toBeNull();
        expect(run?.failedStep).toEqual({ name: 'step_1', displayName: 'Do Thing', message: 'boom' });
    });

    it('returns null for rows missing required ids', () => {
        expect(flowRunsUtils.projectRun({ flowId: 'flow1' })).toBeNull();
    });

    it('masks token-shaped strings inside failed step messages', () => {
        const run = flowRunsUtils.projectRun({
            id: 'run1',
            flowId: 'flow1',
            status: 'FAILED',
            failedStep: { name: 's', displayName: 'S', message: 'failed with Bearer abcdefghijklmnopqrstuvwxyz123456' },
        });
        expect(run?.failedStep?.message).not.toContain('abcdefghijklmnopqrstuvwxyz');
        expect(run?.failedStep?.message).toContain('[REDACTED]');
    });
});

describe('flowRunsUtils.summarizeSteps', () => {
    it('keeps only name/type/status/duration/errorMessage and drops inputs, outputs and auth', () => {
        const steps = flowRunsUtils.summarizeSteps({
            id: 'run1',
            steps: {
                trigger: {
                    type: 'WEBHOOK',
                    status: 'SUCCEEDED',
                    duration: 12,
                    input: { auth: { access_token: 'super-secret', apiKey: 'k' } },
                    output: { token: 'super-secret', nested: { password: 'p' } },
                },
                step_1: {
                    type: 'PIECE',
                    status: 'FAILED',
                    duration: 5,
                    errorMessage: '401 Authorization: Bearer abcdefghijABCDEFGHIJklmnopqrstuvwxyz12',
                    input: { auth: { client_secret: 'shh' } },
                },
            },
        });
        const serialized = JSON.stringify(steps);
        expect(steps).toHaveLength(2);
        expect(steps[0]).toEqual({ name: 'trigger', type: 'WEBHOOK', status: 'SUCCEEDED', durationMs: 12, error: null });
        expect(serialized).not.toContain('super-secret');
        expect(serialized).not.toContain('client_secret');
        expect(serialized).not.toContain('shh');
        expect(serialized).toContain('[REDACTED]');
    });

    it('returns an empty list when steps are absent (pruned or queued run)', () => {
        expect(flowRunsUtils.summarizeSteps({ id: 'run1', steps: null })).toEqual([]);
        expect(flowRunsUtils.summarizeSteps({})).toEqual([]);
    });
});

type MockHandler = (url: URL, req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

async function startMockServer(handler: MockHandler): Promise<{ server: Server; baseUrl: string }> {
    const server = http.createServer((req, res) => {
        handler(new URL(req.url ?? '/', 'http://127.0.0.1'), req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
        throw new Error('mock server failed to bind');
    }
    return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopMockServer(server: Server): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function runCommand(args: string[], baseUrl: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const { createFlowRunsCommand } = await import('./flow-runs');
    const program = createFlowRunsCommand()
        .exitOverride()
        .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    let stdout = '';
    let stderr = '';
    const writeOut = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        stdout += String(chunk);
        return true;
    });
    const writeErr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderr += String(chunk);
        return true;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        throw new ExitSentinel(Number(code ?? 0));
    });
    let code = 0;
    try {
        await program.parseAsync(['node', 'test', ...args, '--url', baseUrl]);
    } catch (e) {
        if (e instanceof ExitSentinel) {
            code = e.code;
        } else {
            const exitCode = isErrorWithExitCode(e) ? e.exitCode : undefined;
            code = typeof exitCode === 'number' ? exitCode : 99;
        }
    } finally {
        writeOut.mockRestore();
        writeErr.mockRestore();
        exitSpy.mockRestore();
    }
    return { code, stdout, stderr };
}

class ExitSentinel extends Error {
    constructor(readonly code: number) {
        super(`exit ${code}`);
    }
}

function isErrorWithExitCode(value: unknown): value is { exitCode: number } {
    if (typeof value !== 'object' || value === null || !('exitCode' in value)) return false;
    return typeof value['exitCode'] === 'number';
}

const RUN_ROW = {
    id: 'AAAAAAAAAAAAAAAAAAAA',
    projectId: 'BBBBBBBBBBBBBBBBBBBB',
    flowId: 'CCCCCCCCCCCCCCCCCCCC',
    flowVersion: { displayName: 'Nightly Sync' },
    status: 'SUCCEEDED',
    startTime: '2026-09-12T09:00:00.000Z',
    finishTime: '2026-09-12T09:00:02.000Z',
    environment: 'PRODUCTION',
};

describe('flow runs command (HTTP)', () => {
    it('prints a human-readable summary and exits 0', async () => {
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            expect(req.headers['authorization']).toBe('Bearer env-key');
            expect(url.searchParams.get('projectId')).toBe('BBBBBBBBBBBBBBBBBBBB');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: [RUN_ROW], next: null, previous: null }));
        });
        process.env.AP_API_KEY = 'env-key';
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB'], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Nightly Sync');
        expect(result.stdout).toContain('SUCCEEDED');
        expect(result.stdout).toContain('2.0s');
        expect(result.stderr).toBe('');
    });

    it('emits pure JSON on stdout with repeated status/flow query keys', async () => {
        const seen: string[] = [];
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            seen.push(url.search);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: [], next: null, previous: null }));
        });
        const result = await runCommand([
            '--project', 'BBBBBBBBBBBBBBBBBBBB',
            '--status', 'FAILED', '--status', 'TIMEOUT',
            '--flow', 'CCCCCCCCCCCCCCCCCCCC',
            '--json',
        ], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(0);
        expect(seen[0]).toContain('status=FAILED&status=TIMEOUT');
        expect(seen[0]).not.toContain('status%5B%5D');
        expect(seen[0]).toContain('flowId=CCCCCCCCCCCCCCCCCCCC');
        const payload = JSON.parse(result.stdout);
        expect(payload.count).toBe(0);
        expect(payload.data).toEqual([]);
        expect(payload.nextCursor).toBeNull();
        expect(result.stdout.trimStart().startsWith('{')).toBe(true);
        expect(result.stdout).not.toContain('No flow runs');
        expect(result.stderr).toContain('No flow runs');
    });

    it('follows nextCursor with --all until the last page', async () => {
        const requests: string[] = [];
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            requests.push(url.searchParams.get('cursor') ?? '');
            const cursor = url.searchParams.get('cursor');
            res.setHeader('content-type', 'application/json');
            if (cursor === null) {
                res.end(JSON.stringify({ data: [{ ...RUN_ROW, id: '11111111111111111111' }], next: 'page2' }));
            } else {
                res.end(JSON.stringify({ data: [{ ...RUN_ROW, id: '22222222222222222222' }], next: null }));
            }
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--all', '--json'], baseUrl);
        await stopMockServer(server);
        expect(requests).toEqual(['', 'page2']);
        const payload = JSON.parse(result.stdout);
        expect(payload.count).toBe(2);
        expect(payload.pagesFetched).toBe(2);
        expect(payload.nextCursor).toBeNull();
        expect(result.stdout.endsWith('}\n')).toBe(true);
    });

    it('exits 3 on 401 with a JSON error envelope and no data leak', async () => {
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            res.statusCode = 401;
            res.end(JSON.stringify({ message: 'invalid api key' }));
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--api-key', 'bad', '--json'], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(3);
        const payload = JSON.parse(result.stdout);
        expect(payload.error.code).toBe('AUTH_ERROR');
        expect(result.stdout).not.toContain('bad');
    });

    it('exits 3 on 403', async () => {
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            res.statusCode = 403;
            res.end(JSON.stringify({}));
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--api-key', 'bad', '--json'], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(3);
        const payload = JSON.parse(result.stdout);
        expect(payload.error.code).toBe('AUTH_ERROR');
        expect(payload.error.message).toContain('403');
    });

    it('retries on 429 honoring Retry-After, then succeeds', async () => {
        let calls = 0;
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            calls += 1;
            if (calls === 1) {
                res.statusCode = 429;
                res.setHeader('retry-after', '0');
                res.end();
                return;
            }
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: [RUN_ROW], next: null }));
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--json'], baseUrl);
        await stopMockServer(server);
        expect(calls).toBe(2);
        expect(result.code).toBe(0);
        expect(result.stderr).toContain('429');
    });

    it('exits 6 on connection refused', async () => {
        const { server, baseUrl } = await startMockServer(() => undefined);
        await stopMockServer(server);
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--api-key', 'k', '--json'], baseUrl);
        expect(result.code).toBe(6);
        const payload = JSON.parse(result.stdout);
        expect(payload.error.code).toBe('NETWORK_ERROR');
    });

    it('includes redacted step summaries with --detail and never prints auth values', async () => {
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            res.setHeader('content-type', 'application/json');
            if (url.pathname === '/api/v1/flow-runs') {
                res.end(JSON.stringify({ data: [RUN_ROW], next: null }));
                return;
            }
            res.end(JSON.stringify({
                id: RUN_ROW.id,
                steps: {
                    step_1: {
                        type: 'PIECE',
                        status: 'SUCCEEDED',
                        duration: 42,
                        input: { auth: { oauth_token: 'topsecret-token-value', client_secret: 'shh' } },
                        output: { Authorization: 'Bearer zzzzzzzzzzzzzzzzzzzzzz' },
                        errorMessage: undefined,
                    },
                },
            }));
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--detail', '--json'], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.stdout);
        expect(payload.data[0].steps).toEqual([
            { name: 'step_1', type: 'PIECE', status: 'SUCCEEDED', durationMs: 42, error: null },
        ]);
        expect(result.stdout).not.toContain('topsecret-token-value');
        expect(result.stdout).not.toContain('shh');
        expect(result.stdout).not.toContain('zzzzzzzzzzzzzzzzzzzzzz');
    });

    it('passes the cursor, limit, time range and includeArchived through to the API', async () => {
        const seen: string[] = [];
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            seen.push(url.search);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: [], next: null, previous: null }));
        });
        const result = await runCommand([
            '--project', 'BBBBBBBBBBBBBBBBBBBB',
            '--cursor', 'opaque-cursor',
            '--limit', '50',
            '--after', '2026-09-01T00:00:00Z',
            '--before', '2026-09-10T00:00:00Z',
            '--include-archived',
            '--json',
        ], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(0);
        expect(seen[0]).toContain('cursor=opaque-cursor');
        expect(seen[0]).toContain('limit=50');
        expect(seen[0]).toContain('includeArchived=true');
        expect(seen[0]).toContain('createdAfter=2026-09-01T00%3A00%3A00.000Z');
        expect(seen[0]).toContain('createdBefore=2026-09-10T00%3A00%3A00.000Z');
    });

    it('exposes nextCursor after a single page without --all', async () => {
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: [RUN_ROW], next: 'page2', previous: null }));
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--json'], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.stdout);
        expect(payload.pagesFetched).toBe(1);
        expect(payload.nextCursor).toBe('page2');
    });

    it('marks truncated=true when --all hits --max-pages and keeps the next cursor', async () => {
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: [{ ...RUN_ROW, id: 'DDDDDDDDDDDDDDDDDDDD' }], next: 'always-more' }));
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--all', '--max-pages', '2', '--json'], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.stdout);
        expect(payload.pagesFetched).toBe(2);
        expect(payload.truncated).toBe(true);
        expect(payload.nextCursor).toBe('always-more');
    });

    it('exits 5 on a 500 response', async () => {
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            res.statusCode = 503;
            res.end(JSON.stringify({ message: 'db down' }));
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--api-key', 'k', '--json'], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(5);
        const payload = JSON.parse(result.stdout);
        expect(payload.error.code).toBe('SERVER_ERROR');
    });

    it('exits 7 on a 400 response with CLIENT_ERROR', async () => {
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            res.statusCode = 400;
            res.end(JSON.stringify({ message: 'invalid query' }));
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--api-key', 'k', '--json', '--limit', '50'], baseUrl);
        await stopMockServer(server);
        expect(result.code).toBe(7);
        const payload = JSON.parse(result.stdout);
        expect(payload.error.code).toBe('CLIENT_ERROR');
    });

    it('gives up after 4 rate-limited attempts and exits 4', async () => {
        let calls = 0;
        const { server, baseUrl } = await startMockServer((url, req, res) => {
            calls += 1;
            res.statusCode = 429;
            res.setHeader('retry-after', '0');
            res.end();
        });
        const result = await runCommand(['--project', 'BBBBBBBBBBBBBBBBBBBB', '--api-key', 'k', '--json'], baseUrl);
        await stopMockServer(server);
        expect(calls).toBe(4);
        expect(result.code).toBe(4);
        const payload = JSON.parse(result.stdout);
        expect(payload.error.code).toBe('RATE_LIMITED');
    });
});
