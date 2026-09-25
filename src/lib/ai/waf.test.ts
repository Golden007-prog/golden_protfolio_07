import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { AI_ROUTE_PATHS, AI_WAF_RULE, checkAiWafRule, probeVerdict, ruleCovers } from './waf.ts';

const withRule = (overrides: Record<string, unknown> = {}, rateLimit: Record<string, unknown> = {}) => ({
  firewallEnabled: true,
  rules: [
    {
      id: 'rule_1',
      ...AI_WAF_RULE,
      action: { mitigate: { ...AI_WAF_RULE.action.mitigate, rateLimit: { ...AI_WAF_RULE.action.mitigate.rateLimit, ...rateLimit } } },
      ...overrides,
    },
  ],
});

const failsWith = (config: unknown, pattern: RegExp) => {
  const result = checkAiWafRule(config);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.problems.join(' '), pattern);
};

test('the launch state fails: no firewall config, or one without a rate-limit rule', () => {
  failsWith(null, /no WAF rules/);
  failsWith({ firewallEnabled: false, rules: [] }, /not enabled.*No rate-limit rule/);
  failsWith({ firewallEnabled: true, rules: [{ name: 'Block bots', active: true, action: { mitigate: { action: 'deny' } } }] }, /No rate-limit rule/);
});

test('the committed rule passes its own check, bare or wrapped in { active }', () => {
  assert.deepEqual(checkAiWafRule(withRule()), { ok: true, rule: 'AI routes rate limit' });
  assert.equal(checkAiWafRule({ active: withRule(), draft: null }).ok, true);
});

test('a disabled rule, or any rule while the firewall is off, is refused', () => {
  failsWith({ ...withRule(), firewallEnabled: false }, /not enabled/);
  failsWith(withRule({ active: false }), /disabled/);
});

test('every AI route directory is limited by the rule and checked by the script', () => {
  const dirs = readdirSync(new URL('../../../app/api/ai/', import.meta.url), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `/api/ai/${d.name}`);
  assert.ok(dirs.length >= 10);
  for (const path of dirs) assert.equal(ruleCovers(AI_WAF_RULE, { path, method: 'POST' }), true, path);
  for (const path of dirs.filter((p) => p !== '/api/ai/health')) assert.ok(AI_ROUTE_PATHS.includes(path), `${path} is not checked`);
});

test('looser, softer or narrower rules are refused with the reason', () => {
  failsWith(withRule({}, { limit: 100 }), /allows 100 requests per 60s/);
  failsWith(withRule({}, { limit: 20, window: 30 }), /allows 20 requests per 30s/);
  failsWith(withRule({}, { action: 'deny' }), /'deny' instead of a 429/);
  failsWith(withRule({}, { keys: ['header:x-forwarded-for'] }), /per IP/);
  failsWith(withRule({ conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/api/ai/ask' }] }] }), /\/api\/ai\/jd-fit/);
  failsWith(
    withRule({ conditionGroup: [{ conditions: [{ type: 'path', op: 'pre', value: '/api/ai' }, { type: 'geo_country', op: 'eq', value: 'IN' }] }] }),
    /does not certainly match/,
  );
  failsWith(withRule({ conditionGroup: [{ conditions: [{ type: 'path', op: 'pre', value: '/api/ai', neg: true }] }] }), /does not certainly match/);
});

test('an equivalent or tighter rule passes', () => {
  assert.equal(checkAiWafRule(withRule({}, { limit: 10, window: 30 })).ok, true);
  assert.equal(checkAiWafRule(withRule({}, { keys: ['ip', 'ja4'], algo: 'token_bucket' })).ok, true);
  assert.equal(checkAiWafRule(withRule({ conditionGroup: [{ conditions: [{ type: 'path', op: 'pre', value: '/api/' }] }] })).ok, true);
  assert.equal(checkAiWafRule(withRule({ conditionGroup: [{ conditions: [{ type: 'path', op: 're', value: '^/api/ai/' }, { type: 'method', op: 'eq', value: 'POST' }] }] })).ok, true);
});

test('the rule payload fits the firewall API limits', () => {
  assert.ok(AI_WAF_RULE.name.length <= 160);
  assert.ok(AI_WAF_RULE.description.length <= 256);
});

test('a burst with no 429 means nothing limits the routes', () => {
  const replies = Array.from({ length: 25 }, () => ({ status: 200, contentType: 'application/json' }));
  const verdict = probeVerdict(replies);
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /No 429 in 25 requests/);
});

test('a non-JSON 429 after the window fills means the rule is live', () => {
  const replies = [
    ...Array.from({ length: 20 }, () => ({ status: 200, contentType: 'application/json' })),
    ...Array.from({ length: 5 }, () => ({ status: 429, contentType: 'text/html; charset=utf-8' })),
  ];
  const verdict = probeVerdict(replies);
  assert.equal(verdict.ok, true);
  assert.match(verdict.message, /Request 21 got a 429 \(not JSON/);
});
