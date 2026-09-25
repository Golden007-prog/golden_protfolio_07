import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import type { AiFakeStats, AiFallbackReason, AiFrame, AiHealth } from '../../src/lib/ai/protocol';

/*
 * Shared helpers for every AI spec (#170). The mocks answer inside the browser, so
 * a mocked request never reaches the server. Anything that does reach the server
 * must run against the fake model: call assertSafeServer first. Packages add their
 * own helpers in their own specs rather than editing this file.
 */

const AI_API = /\/api\/ai\//;

/** '/api/ai/ask', 'api/ai/ask' or 'ask' -> a matcher for exactly that route (any query string). */
function routeMatcher(path: string): RegExp {
  const name = path.replace(/^\/?(api\/ai\/)?/, '').replace(/\/+$/, '');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/api/ai/${escaped}(?:\\?.*)?$`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every AI POST answers the always-200 fallback body, as the real routes do when a
 * key is missing, the quota is spent or the guard refuses. GET /api/ai/health still
 * reaches the server, so AiNotice keeps its real tier.
 */
export async function mockAiFallback(page: Page, reason: AiFallbackReason = 'quota', opts: { retryAfterSec?: number } = {}): Promise<void> {
  await page.route(AI_API, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(opts.retryAfterSec ? { mode: 'fallback', reason, retryAfterSec: opts.retryAfterSec } : { mode: 'fallback', reason }),
    });
  });
}

/**
 * Answers `path` with an NDJSON stream of `frames`, one per line, the way
 * respond.server's ndjson() writes them. The body arrives in one piece: use a
 * fake-model route (ai-server.spec) when chunk timing matters.
 */
export async function mockAiStream(
  page: Page,
  path: string,
  frames: readonly AiFrame[],
  opts: { delayMs?: number; model?: string } = {},
): Promise<void> {
  await page.route(routeMatcher(path), async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    if (opts.delayMs) await sleep(opts.delayMs);
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: { 'cache-control': 'no-store, no-transform', 'x-ai-model': opts.model ?? 'gemini-test' },
      body: frames.map((f) => JSON.stringify(f)).join('\n') + '\n',
    });
  });
}

/** Answers `path` with a JSON success body (the structured routes). */
export async function mockAiJson(page: Page, path: string, body: unknown, opts: { delayMs?: number } = {}): Promise<void> {
  await page.route(routeMatcher(path), async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    if (opts.delayMs) await sleep(opts.delayMs);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
  });
}

/**
 * Counts every request to /api/ai/* the page makes from now on, mocked or not and
 * including GET /api/ai/health. Call before page.goto to cover the page load.
 */
export function countAiRequests(page: Page): () => number {
  let n = 0;
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/ai/')) n += 1;
  });
  return () => n;
}

/* ---- the server under test ---- */

/** The origin Playwright's baseURL points at; the guard only accepts same-origin POSTs. */
export function testOrigin(): string {
  const base = test.info().project.use.baseURL ?? `http://127.0.0.1:${process.env.PW_PORT ?? 3100}`;
  return new URL(base).origin;
}

export async function aiHealth(request: APIRequestContext): Promise<AiHealth> {
  const res = await request.get('/api/ai/health', { headers: { 'cache-control': 'no-store' } });
  if (!res.ok()) throw new Error(`GET /api/ai/health answered ${res.status()}`);
  const text = await res.text();
  // The health body echoes model ids; a pasted key there would be a leak.
  if (/AIza[0-9A-Za-z_-]{20,}/.test(text)) throw new Error('GET /api/ai/health contains a Google API key pattern');
  return JSON.parse(text) as AiHealth;
}

/**
 * Fails fast unless the server runs the fake model or has AI switched off. That
 * catches a reused local `next start` that loaded the real key from .env, which
 * reuseExistingServer would otherwise hand to the suite without the webServer env
 * override, so no AI spec can spend real quota.
 */
export async function assertSafeServer(request: APIRequestContext): Promise<AiHealth> {
  const health = await aiHealth(request);
  if (health.fake !== true && health.enabled !== false) {
    throw new Error(
      'assertSafeServer: /api/ai/health reports fake:false and enabled:true, so this server would call the real Gemini API. ' +
        'A reused `next start` (reuseExistingServer) probably loaded GOOGLE_AI_API_KEY from .env. Stop it and let Playwright ' +
        "start its own server (the webServer env sets AI_FAKE_MODEL=1), or start one with AI_FAKE_MODEL=1 or AI_ENABLED=0.",
    );
  }
  return health;
}

/** The fake model's counters; throws when the server is not running the fake. */
export async function fakeStats(request: APIRequestContext): Promise<AiFakeStats> {
  const health = await aiHealth(request);
  if (!health.fake || !health.fakeStats) throw new Error('fakeStats: the server is not running the fake model');
  return health.fakeStats;
}

/** Model attempts across every model id. */
export function totalCalls(stats: AiFakeStats): number {
  return Object.values(stats.calls).reduce((n, c) => n + c, 0);
}

/**
 * POSTs JSON to an AI route the way the site's own client does: same Origin and
 * application/json. Without both the guard answers 'origin' or 'bad-request'.
 */
export async function aiPost(
  request: APIRequestContext,
  path: string,
  data: unknown,
  opts: { headers?: Record<string, string>; timeout?: number } = {},
): Promise<APIResponse> {
  const url = path.startsWith('/') ? path : `/api/ai/${path}`;
  return request.post(url, {
    headers: { origin: testOrigin(), 'content-type': 'application/json', ...opts.headers },
    data: typeof data === 'string' ? data : JSON.stringify(data),
    timeout: opts.timeout,
    failOnStatusCode: false,
  });
}

/** Parses an NDJSON body into frames; a malformed line throws, naming it. */
export function parseFrames(body: string): AiFrame[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as AiFrame;
      } catch {
        throw new Error(`not an NDJSON frame: ${line.slice(0, 120)}`);
      }
    });
}

/** The visible answer a client would render: every delta's text, in order. */
export function answerText(frames: readonly AiFrame[]): string {
  return frames.map((f) => (f.type === 'delta' ? f.text : '')).join('');
}

/* ---- a second server with other AI settings ---- */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Starts another `next start` over the same build with extra env (AI_ENABLED=0, no
 * key, ...) on a free port, for checks the suite's fake-model server cannot make.
 * `next start` still loads .env, so pass GOOGLE_AI_API_KEY: '' to keep the real key
 * out: an empty value beats .env. Needs a local build, so callers skip under
 * PW_BASE_URL. Server output is kept only for a startup failure message.
 */
export async function startNextServer(env: Record<string, string>, opts: { timeoutMs?: number } = {}): Promise<{ baseURL: string; stop(): Promise<void> }> {
  if (!existsSync(path.join(REPO_ROOT, '.next', 'BUILD_ID'))) throw new Error('startNextServer: no build in .next; run `next build` first');
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const keep = (d: Buffer) => {
    output = (output + d.toString('utf8')).slice(-2000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await Promise.race([exited, sleep(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };

  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${baseURL}/api/ai/health`, { cache: 'no-store' });
      if (res.ok) return { baseURL, stop };
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  await stop();
  throw new Error(`startNextServer: no answer on ${baseURL}. Last output:\n${output}`);
}
