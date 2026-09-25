#!/usr/bin/env node
/*
 * Checks the Vercel WAF rate-limit rule the AI routes depend on for a limit that
 * holds across instances (README, "Before going live"; src/lib/ai/waf.ts). It
 * never writes to Vercel: creating the rule is the owner's change.
 *
 * Usage:
 *   node scripts/ai/check-waf.mjs --print
 *       Prints the rule as JSON. Create it in the project's Firewall settings with
 *       the same values, or with the Vercel CLI and then publish it (CLI firewall
 *       changes stay staged until published):
 *         vercel firewall rules add --json "$(node scripts/ai/check-waf.mjs --print)" --yes
 *         vercel firewall publish --yes
 *   node --env-file-if-exists=.env scripts/ai/check-waf.mjs --config
 *       Reads the project's active firewall config and checks the rule. Needs
 *       VERCEL_TOKEN (never printed) and VERCEL_PROJECT_ID plus VERCEL_TEAM_ID (or
 *       VERCEL_ORG_ID), or the .vercel/project.json that `vercel link` writes.
 *   node scripts/ai/check-waf.mjs --config-file <file>
 *       The same check on a saved read, for example the output of
 *         vercel api "/v1/security/firewall/config/active?projectId=<id>"
 *   node scripts/ai/check-waf.mjs --probe <origin>
 *       Sends up to 25 POSTs to <origin>/api/ai/ask with a text/plain body. The
 *       guard refuses them before any model call with HTTP 200, so a 429 can only
 *       come from the rule. Each one still starts a function: run it once.
 * Exit: 0 the rule is in place, 1 it is missing or wrong, 2 the check could not run.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_WAF_LIMIT, AI_WAF_RULE, checkAiWafRule, probeVerdict } from '../../src/lib/ai/waf.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// process.exit() can trip a libuv assertion on Windows while fetch sockets close,
// so every path ends by setting process.exitCode instead.
class CannotCheck extends Error {}

function cannot(message) {
  throw new CannotCheck(message);
}

function report(result) {
  if (result.ok) {
    console.log(`WAF rule in place: "${result.rule}" limits every AI route.`);
    return 0;
  }
  console.log('The AI routes have no working WAF rate limit:');
  for (const problem of result.problems) console.log(`  - ${problem}`);
  console.log('Create it with the values from `node scripts/ai/check-waf.mjs --print`, publish it, then run this again.');
  return 1;
}

function projectScope() {
  let projectId = process.env.VERCEL_PROJECT_ID;
  let teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID;
  const linked = path.join(ROOT, '.vercel', 'project.json');
  if (!projectId && existsSync(linked)) {
    const link = JSON.parse(readFileSync(linked, 'utf8'));
    projectId = link.projectId;
    teamId ||= link.orgId;
  }
  if (!projectId) cannot('set VERCEL_PROJECT_ID (and VERCEL_TEAM_ID), or run `vercel link` first.');
  return { projectId, teamId: teamId?.startsWith('team_') ? teamId : undefined };
}

async function readActiveConfig() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) cannot('VERCEL_TOKEN is not set.');
  const { projectId, teamId } = projectScope();
  const url = new URL('https://api.vercel.com/v1/security/firewall/config/active');
  url.searchParams.set('projectId', projectId);
  if (teamId) url.searchParams.set('teamId', teamId);

  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    cannot(`the Vercel API could not be reached (${err?.name ?? 'error'}).`);
  }
  // A project that never had a firewall rule has no config at all.
  if (res.status === 404) return null;
  if (!res.ok) {
    const code = await res.json().then((b) => b?.error?.code, () => undefined);
    cannot(`the Vercel API answered ${res.status}${code ? ` (${code})` : ''}.`);
  }
  return res.json();
}

async function probe(origin) {
  let target;
  try {
    target = new URL('/api/ai/ask', origin);
  } catch {
    cannot(`"${origin}" is not an origin like https://www.basuoikantik.in`);
  }
  const replies = [];
  for (let i = 0; i < AI_WAF_LIMIT + 5; i++) {
    let res;
    try {
      res = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'waf probe',
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      cannot(`request ${i + 1} failed (${err?.name ?? 'error'}).`);
    }
    await res.arrayBuffer().catch(() => {});
    if (res.status >= 300 && res.status < 400) {
      cannot(`${target.origin} redirects (${res.status} to ${res.headers.get('location') ?? '?'}); probe the origin it redirects to.`);
    }
    replies.push({ status: res.status, contentType: res.headers.get('content-type') ?? '' });
    if (res.status === 429) break;
  }
  const verdict = probeVerdict(replies);
  console.log(verdict.message);
  return verdict.ok ? 0 : 1;
}

async function main() {
  if (args.includes('--print')) {
    console.log(JSON.stringify(AI_WAF_RULE));
    return 0;
  }
  if (args.includes('--config-file')) {
    const file = valueOf('--config-file');
    if (!file || !existsSync(file)) cannot('--config-file needs a saved firewall config read.');
    return report(checkAiWafRule(JSON.parse(readFileSync(file, 'utf8'))));
  }
  if (args.includes('--config')) return report(checkAiWafRule(await readActiveConfig()));
  if (args.includes('--probe')) {
    const origin = valueOf('--probe');
    if (!origin) cannot('--probe needs an origin, e.g. --probe https://www.basuoikantik.in');
    return probe(origin);
  }
  cannot('pass --print, --config, --config-file <file> or --probe <origin> (see the header of this file).');
}

try {
  process.exitCode = await main();
} catch (err) {
  if (!(err instanceof CannotCheck)) throw err;
  console.error(`check-waf: ${err.message}`);
  process.exitCode = 2;
}
