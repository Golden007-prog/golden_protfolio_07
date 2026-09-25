#!/usr/bin/env node
// The AI refresh runbook in one command. In order:
//   1. ai:corpus            rebuild src/data/ai-corpus.json
//   2. ai:embed             embed new or changed chunks        (needs the key)
//   3. ai:generate          run every scripts/ai/gen-*.mjs     (needs the key)
//   4. project-embeddings   redraw public/ai/projection.json for the /ai explorer
//   5. eval.mjs             only when a local server answers (AI_EVAL=1 npx next start)
// then prints the review checklist: which JSON files changed, reviewed:false
// counts per store, faithful and bannedPhrase rejections, and the reminder that
// claim-bearing entries stay hidden in production until approved.
//
// Without GOOGLE_AI_API_KEY it stops cleanly after the corpus step, prints the
// checklist and exits 0. A failing step stops the run, prints the checklist and
// exits 1.
//
//   node --env-file-if-exists=.env scripts/ai/refresh-all.mjs [--no-eval] [--force]
//   --force is passed to the generators.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKey, loadStore, ROOT, STORE_DIR } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const noEval = argv.includes('--no-eval');
const genArgs = argv.includes('--force') ? ['--force'] : [];
const EVAL_BASE = process.env.EVAL_BASE_URL || 'http://localhost:3000';
const toRel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

/* ---- what changed: a hash of every JSON file a step can write ---- */

function jsonFiles() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'src/data'));
  walk(path.join(ROOT, 'public/ai'));
  return out;
}

function snapshot() {
  return new Map(jsonFiles().map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]));
}

/* ---- steps ---- */

/** Runs a script with this process's environment, echoing and keeping its output. */
function run(script, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, script), ...args], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => {
      process.stdout.write(d);
      output += d;
    });
    child.stderr.on('data', (d) => {
      process.stderr.write(d);
      output += d;
    });
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), output }));
  });
}

async function serverUp() {
  try {
    const res = await fetch(new URL('/api/ai/health', EVAL_BASE), { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const before = snapshot();
const log = [];
let generatorOutput = null;
let exitCode = 0;
let stoppedFor = null;

async function step(label, script, args) {
  console.log(`\n━━ ${label} ━━`);
  const r = await run(script, args);
  log.push(`${r.code === 0 ? '✔' : '✖'} ${label}`);
  if (r.code !== 0) {
    stoppedFor = `${label} failed (exit ${r.code})`;
    exitCode = 1;
  }
  return r;
}

main: {
  await step('1. corpus (ai:corpus)', 'build-corpus.mjs');
  if (exitCode) break main;

  if (!apiKey()) {
    stoppedFor = 'no key (GOOGLE_AI_API_KEY): embed, generate, projection and eval were not run';
    log.push('– 2-5 skipped: no key');
    break main;
  }

  await step('2. embeddings (ai:embed)', 'embed-corpus.mjs');
  if (exitCode) break main;

  const gen = await step('3. generators (ai:generate)', 'run-generators.mjs', genArgs);
  generatorOutput = gen.output;
  if (exitCode) break main;

  await step('4. projection (project-embeddings)', 'project-embeddings.mjs');
  if (exitCode) break main;

  if (noEval) {
    log.push('– 5. eval skipped (--no-eval)');
  } else if (await serverUp()) {
    // An eval failure is reported but does not undo the refresh.
    const r = await run('eval.mjs');
    log.push(`${r.code === 0 ? '✔' : '✖'} 5. eval against ${EVAL_BASE}`);
  } else {
    log.push(`– 5. eval skipped: no local server at ${EVAL_BASE} (start one with AI_EVAL=1 npx next start)`);
  }
}

/* ---- the review checklist ---- */

const after = snapshot();
const changed = [...after.keys()].filter((f) => before.get(f) !== after.get(f)).map(toRel);
const removed = [...before.keys()].filter((f) => !after.has(f)).map(toRel);

console.log('\n━━ Review checklist ━━');
for (const line of log) console.log(`  ${line}`);
if (stoppedFor) console.log(`  stopped: ${stoppedFor}`);

console.log('\n  Changed JSON files:');
if (!changed.length && !removed.length) console.log('    none');
for (const f of changed) console.log(`    ${f}`);
for (const f of removed) console.log(`    ${f} (removed)`);

console.log('\n  Stores awaiting review (src/data/ai-generated):');
const stores = existsSync(STORE_DIR) ? readdirSync(STORE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
let hidden = 0;
for (const name of stores) {
  const all = Object.values(loadStore(name).entries);
  const unreviewed = all.filter((e) => e && e.reviewed !== true);
  const claims = unreviewed.filter((e) => e.claimBearing).length;
  hidden += claims;
  console.log(`    ${name.padEnd(12)} ${String(unreviewed.length).padStart(3)} reviewed:false of ${all.length}  (${claims} claim-bearing, hidden in production)`);
}

// Generators report a rejected output on one line naming the check, for example
// 'rejected (faithful): skills:LangChain …' or '… bannedPhrase …'.
const count = (re) => (generatorOutput ? generatorOutput.split('\n').filter((l) => re.test(l)).length : null);
const faithful = count(/\bfaithful\b/i);
const banned = count(/\bbanned ?phrase\b/i);
console.log('\n  Generator rejections:');
console.log(generatorOutput === null ? '    not run' : `    faithful: ${faithful}\n    bannedPhrase: ${banned}`);

console.log(
  `\n  Reminder: claim-bearing entries stay hidden in production until Oikantik approves them with \`npm run ai:review\`` +
    (hidden ? ` (${hidden} waiting).` : '.'),
);
console.log('  Then look over the changed files above before committing them.');

process.exit(exitCode);
