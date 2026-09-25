import { AI_FEATURES } from './config.ts';

/*
 * The one Vercel WAF rule the AI routes rely on for a limit that holds across
 * instances (README, "Before going live"). It cannot live in vercel.json: a
 * route's `mitigate` there only takes 'challenge' or 'deny', so the rate limit
 * is a firewall setting the owner creates and publishes by hand. This module
 * holds the rule as data, plus the checks scripts/ai/check-waf.mjs runs against
 * the project's active firewall config and against a burst of real requests.
 */

export const AI_WAF_LIMIT = 20;
export const AI_WAF_WINDOW_SEC = 60;

/** Every POST route under /api/ai that can reach a model or the embedder. */
export const AI_ROUTE_PATHS: readonly string[] = AI_FEATURES.map((f) => `/api/ai/${f}`);

/** Payload for `vercel firewall rules add --json`, or the value of a `rules.insert` PATCH. */
export const AI_WAF_RULE = {
  name: 'AI routes rate limit',
  description: `Per-IP ceiling on /api/ai before any function runs: ${AI_WAF_LIMIT} requests per ${AI_WAF_WINDOW_SEC}s, fixed window, answered with 429.`,
  active: true,
  conditionGroup: [{ conditions: [{ type: 'path', op: 'pre', value: '/api/ai' }] }],
  action: {
    mitigate: {
      action: 'rate_limit',
      rateLimit: { algo: 'fixed_window', window: AI_WAF_WINDOW_SEC, limit: AI_WAF_LIMIT, keys: ['ip'], action: 'rate_limit' },
      actionDuration: null,
    },
  },
} as const;

type Condition = { type?: unknown; op?: unknown; value?: unknown; neg?: unknown };
type Req = { path: string; method: string };

const PATH_TYPES = new Set(['path', 'raw_path', 'target_path']);

/** true or false when the condition can be decided for `req`, null when it depends on something else (geo, headers...). */
function conditionHolds(c: Condition, req: Req): boolean | null {
  const subject = PATH_TYPES.has(String(c.type)) ? req.path : c.type === 'method' ? req.method : null;
  if (subject === null) return null;
  const list = Array.isArray(c.value) ? c.value.map(String) : [String(c.value ?? '')];
  const hit = opHolds(String(c.op), subject, list);
  if (hit === null) return null;
  return c.neg === true ? !hit : hit;
}

function opHolds(op: string, subject: string, list: string[]): boolean | null {
  const one = list[0];
  if (op === 'eq') return subject === one;
  if (op === 'neq') return subject !== one;
  if (op === 'pre') return subject.startsWith(one);
  if (op === 'suf') return subject.endsWith(one);
  if (op === 'sub') return subject.includes(one);
  if (op === 'inc') return list.includes(subject);
  if (op === 'ninc') return !list.includes(subject);
  if (op === 're') {
    try {
      return new RegExp(one).test(subject);
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether the rule's condition groups (OR of ANDs) certainly match `req`. */
export function ruleCovers(rule: unknown, req: Req): boolean {
  const groups = (rule as { conditionGroup?: unknown })?.conditionGroup;
  if (!Array.isArray(groups)) return false;
  return groups.some((g) => {
    const conditions = (g as { conditions?: unknown })?.conditions;
    return Array.isArray(conditions) && conditions.length > 0 && conditions.every((c) => conditionHolds(c as Condition, req) === true);
  });
}

export type WafCheck = { ok: true; rule: string } | { ok: false; problems: string[] };

/**
 * Checks a firewall config read (GET /v1/security/firewall/config/active, or the
 * `{ active }` wrapper) for an active per-IP rate-limit rule that answers 429 on
 * every AI route, at no more than AI_WAF_LIMIT requests per AI_WAF_WINDOW_SEC.
 */
export function checkAiWafRule(config: unknown, paths: readonly string[] = AI_ROUTE_PATHS): WafCheck {
  if (!config || typeof config !== 'object') return { ok: false, problems: ['No firewall config: the project has no WAF rules at all.'] };
  const wrapped = (config as { active?: unknown }).active;
  const active = (wrapped && typeof wrapped === 'object' ? wrapped : config) as { firewallEnabled?: unknown; rules?: unknown };

  const problems: string[] = [];
  if (active.firewallEnabled !== true) problems.push('The firewall is not enabled, so no custom rule runs.');

  const rules = Array.isArray(active.rules) ? active.rules : [];
  const limiters = rules.filter((r) => (r as { action?: { mitigate?: { action?: unknown } } })?.action?.mitigate?.action === 'rate_limit');
  if (limiters.length === 0) return { ok: false, problems: [...problems, 'No rate-limit rule exists.'] };

  const perRule: string[] = [];
  for (const rule of limiters) {
    const r = rule as { name?: unknown; active?: unknown; action: { mitigate: { rateLimit?: unknown } } };
    const name = typeof r.name === 'string' && r.name ? r.name : '(unnamed)';
    const own: string[] = [];
    if (r.active !== true) own.push('it is disabled');

    const rl = r.action.mitigate.rateLimit as { window?: unknown; limit?: unknown; keys?: unknown; action?: unknown } | undefined;
    const limit = Number(rl?.limit);
    const window = Number(rl?.window);
    if (!rl || typeof rl !== 'object') {
      own.push('it has no rate-limit settings');
    } else {
      if (!Array.isArray(rl.keys) || !rl.keys.includes('ip')) own.push('it does not count per IP');
      if (!(limit > 0 && window > 0) || limit > AI_WAF_LIMIT || limit * AI_WAF_WINDOW_SEC > AI_WAF_LIMIT * window) {
        own.push(`it allows ${rl.limit} requests per ${rl.window}s, more than ${AI_WAF_LIMIT} per ${AI_WAF_WINDOW_SEC}s`);
      }
      // The client reads a non-JSON 429 as 'rate-limited'; a 403 from 'deny' or a challenge page reads as an outage.
      if (rl.action !== 'rate_limit') own.push(`it answers with '${String(rl.action)}' instead of a 429`);
    }

    const missed = paths.filter((path) => !ruleCovers(rule, { path, method: 'POST' }));
    if (missed.length) own.push(`it does not certainly match ${missed.join(', ')}`);

    if (own.length === 0 && problems.length === 0) return { ok: true, rule: name };
    if (own.length) perRule.push(`Rule "${name}": ${own.join('; ')}.`);
  }
  return { ok: false, problems: [...problems, ...perRule] };
}

export type ProbeReply = { status: number; contentType: string };
export type ProbeVerdict = { ok: boolean; message: string };

/**
 * Reads a burst of POSTs the app refuses before any model call. The AI routes
 * answer every refusal with HTTP 200, so a 429 can only come from the WAF.
 */
export function probeVerdict(replies: readonly ProbeReply[]): ProbeVerdict {
  const first429 = replies.findIndex((r) => r.status === 429);
  const odd = [...new Set(replies.filter((r) => r.status !== 200 && r.status !== 429).map((r) => r.status))];
  const note = odd.length ? ` Other statuses seen: ${odd.join(', ')}.` : '';
  if (first429 === -1) {
    return { ok: false, message: `No 429 in ${replies.length} requests: nothing limits /api/ai before the function runs.${note}` };
  }
  const html = !replies[first429].contentType.includes('application/json');
  return {
    ok: true,
    message: `Request ${first429 + 1} got a 429${html ? ' (not JSON, as the WAF sends)' : ''}: the rule is live.${note}`,
  };
}
