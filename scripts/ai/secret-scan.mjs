#!/usr/bin/env node
/*
 * npm run ai:scan — proves the Gemini key cannot reach the browser (#172).
 *
 * 1. Greps for the key's value pattern (a Google API key: 'AIza' + 35 characters),
 *    not just its name, across the client build (.next/static), the prerendered
 *    pages and RSC payloads (.next/server/app/**\/*.{html,rsc,body,meta}),
 *    public/ and README.md.
 * 2. Greps the client build for '@google/genai' and 'GOOGLE_AI_API_KEY'.
 * 3. Checks that next.config's env block (inlined into client code at build time)
 *    holds only the four allowed keys, in the source and in the built config.
 *
 * It never reads .env and never prints a matched value: a finding names the file,
 * the byte offset and the match length only.
 *
 * Usage: node scripts/ai/secret-scan.mjs [--root <dir>] [--source-only]
 *   --root         scan another tree with the same layout (tests use a fixture)
 *   --source-only  skip the build checks (before `next build`)
 * Exit: 0 clean, 1 findings, 2 no build to scan.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const rootArg = args.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(args[rootArg + 1] ?? '.') : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_ONLY = flag('--source-only');

const ALLOWED_ENV_KEYS = ['NEXT_PUBLIC_BUILD_TIME', 'NEXT_PUBLIC_COMMIT', 'NEXT_PUBLIC_RENDER_COUNT', 'NEXT_PUBLIC_AI_SHOW_UNREVIEWED'];

// Built from parts so this file never matches its own pattern.
const KEY_PATTERN = new RegExp(['AI', 'za', '[0-9A-Za-z_-]{35}'].join(''), 'g');
const CLIENT_FORBIDDEN = ['@google/genai', ['GOOGLE', 'AI', 'API', 'KEY'].join('_')];
const SERVER_PAGE_EXT = /\.(html|rsc|body|meta)$/;

const findings = [];
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
let scannedFiles = 0;

function* walk(dir, filter = () => true) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, filter);
    else if (entry.isFile() && filter(full)) yield full;
  }
}

/** latin1 keeps one character per byte, so offsets are byte offsets and binaries scan safely. */
function scanFile(file, { forbidden = [] } = {}) {
  scannedFiles += 1;
  const text = readFileSync(file).toString('latin1');
  for (const m of text.matchAll(KEY_PATTERN)) {
    findings.push(`${rel(file)} @${m.index}: a Google API key pattern (${m[0].length} chars, value withheld)`);
  }
  for (const needle of forbidden) {
    const at = text.indexOf(needle);
    if (at >= 0) findings.push(`${rel(file)} @${at}: client code contains '${needle}'`);
  }
}

/* ---- next.config env block ---- */

/** The source with comments blanked out; strings and template literals are kept intact. */
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const start = i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      out += src.slice(start, ++i);
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The text between the braces that open at `open`, honouring nesting and strings. */
function blockAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
    } else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Top-level entries of an object literal body, split on depth-0 commas. */
function entries(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < body.length && body[i] !== c) i += body[i] === '\\' ? 2 : 1;
    } else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function envKeysFromSource(source) {
  const src = stripComments(source);
  const blocks = [];
  for (const m of src.matchAll(/(?:^|[\s{,])env\s*:\s*\{/g)) {
    const body = blockAt(src, m.index + m[0].length - 1);
    if (body === null) return { error: 'unbalanced env block' };
    blocks.push(body);
  }
  if (!blocks.length) return { keys: [] };
  const keys = [];
  for (const body of blocks) {
    for (const entry of entries(body)) {
      if (entry.startsWith('...')) return { error: `a spread in the env block (${entry.slice(0, 40)}) can add any key` };
      if (entry.startsWith('[')) return { error: `a computed key in the env block (${entry.slice(0, 40)})` };
      const named = /^(['"]?)([A-Za-z_$][\w$]*)\1\s*:/.exec(entry) ?? /^([A-Za-z_$][\w$]*)()$/.exec(entry);
      if (!named) return { error: `an env entry that is not a plain key (${entry.slice(0, 40)})` };
      keys.push(named[2] || named[1]);
    }
  }
  return { keys };
}

function checkEnvKeys(keys, where) {
  for (const key of keys) {
    if (!ALLOWED_ENV_KEYS.includes(key)) findings.push(`${where}: env key '${key}' is not allowed (only ${ALLOWED_ENV_KEYS.join(', ')})`);
  }
}

/* ---- run ---- */

const configFile = ['next.config.ts', 'next.config.mjs', 'next.config.js'].map((f) => path.join(ROOT, f)).find((f) => existsSync(f));
if (!configFile) findings.push('no next.config.{ts,mjs,js} found');
else {
  const parsed = envKeysFromSource(readFileSync(configFile, 'utf8'));
  if (parsed.error) findings.push(`${rel(configFile)}: ${parsed.error}`);
  else checkEnvKeys(parsed.keys, rel(configFile));
}

for (const file of walk(path.join(ROOT, 'public'))) scanFile(file);
if (existsSync(path.join(ROOT, 'README.md'))) scanFile(path.join(ROOT, 'README.md'));

const NEXT = path.join(ROOT, '.next');
if (!SOURCE_ONLY) {
  if (!existsSync(path.join(NEXT, 'static'))) {
    console.error('ai:scan: no .next/static to scan. Run `next build` first, or pass --source-only.');
    process.exit(2);
  }
  for (const file of walk(path.join(NEXT, 'static'))) scanFile(file, { forbidden: CLIENT_FORBIDDEN });
  for (const file of walk(path.join(NEXT, 'server', 'app'), (f) => SERVER_PAGE_EXT.test(f))) scanFile(file);

  // The config Next.js actually built with, after plugins such as withBotId wrapped it.
  const required = path.join(NEXT, 'required-server-files.json');
  if (existsSync(required)) {
    try {
      const env = JSON.parse(readFileSync(required, 'utf8'))?.config?.env;
      if (env && typeof env === 'object') checkEnvKeys(Object.keys(env), '.next/required-server-files.json config.env');
    } catch {
      findings.push('.next/required-server-files.json is not valid JSON');
    }
  }
}

if (findings.length) {
  console.error(`✖ ai:scan found ${findings.length} problem(s):`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('If a real key leaked into a build or public/, rotate it in Google AI Studio first (README: AI incident runbook).');
  process.exit(1);
}
const scope = SOURCE_ONLY ? 'public/, README.md and next.config' : '.next/static, prerendered pages, public/, README.md and next.config';
console.log(`✔ ai:scan: ${scannedFiles} files clean (${scope}); env keys limited to ${ALLOWED_ENV_KEYS.length} allowed names.`);
