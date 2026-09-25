#!/usr/bin/env node
// Runs every scripts/ai/gen-*.mjs in name order, each in its own process with
// the same environment. Generators write src/data/ai-generated/<store>.json
// through lib.mjs (hash-gated, so unchanged sources are skipped) and exit 0 on a
// 429 with a notice. Without a key nothing runs: the generators are listed as
// skipped and the exit code is 0, so keyless CI never fails here.
//
//   npm run ai:generate            (node --env-file-if-exists=.env scripts/ai/run-generators.mjs)
//   npm run ai:generate -- --force  extra arguments are passed to every generator

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKey } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const generators = readdirSync(here)
  .filter((f) => /^gen-[\w-]+\.mjs$/.test(f))
  .sort();

if (!apiKey()) {
  console.log(`skipped: no key (GOOGLE_AI_API_KEY). Generators not run: ${generators.join(', ') || 'none found'}`);
  process.exit(0);
}
if (!generators.length) {
  console.log('No generators found (scripts/ai/gen-*.mjs).');
  process.exit(0);
}

const failed = [];
for (const file of generators) {
  console.log(`\n▶ ${file}`);
  const r = spawnSync(process.execPath, [path.join(here, file), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed.push(`${file} (${r.status ?? r.signal})`);
}
console.log(failed.length ? `\n✖ ${failed.length} of ${generators.length} generators failed: ${failed.join(', ')}` : `\n✔ ${generators.length} generators ran.`);
process.exit(failed.length ? 1 : 0);
