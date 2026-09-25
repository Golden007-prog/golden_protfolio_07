import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * The Lottie player chunk must carry lottie-web's light engine only. A namespace
 * import('lottie-react') shipped all three engines (745 kB, 18% of it executed).
 * These checks hold the source side; tests/e2e/lottie-bundle.spec.ts checks the
 * chunk a build actually serves.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const PKG_DIR = dirname(require.resolve('lottie-react/package.json'));
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
  sideEffects?: unknown;
  exports: { '.': { import: { default: string } } };
};

const STATIC_SPECIFIER = /\b(?:import|export)\s*(?:type\s+)?(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"']+)["']/g;
const DYNAMIC_SPECIFIER = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Import specifiers outside comments (lottie-react's JSDoc quotes example imports). */
function specifiers(source: string): string[] {
  source = stripComments(source);
  return [...source.matchAll(STATIC_SPECIFIER), ...source.matchAll(DYNAMIC_SPECIFIER)].map((m) => m[1]);
}

/** Every lottie-web file the module graph from `entry` reaches through static and dynamic imports. */
function lottieEnginesFrom(entry: string): string[] {
  const seen = new Set<string>();
  const engines = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) walk(resolve(dirname(file), spec));
      else if (spec === 'lottie-web' || spec.startsWith('lottie-web/')) engines.add(spec);
    }
  };
  walk(entry);
  return [...engines].sort();
}

const INDEX = join(PKG_DIR, pkg.exports['.'].import.default);

function lottieLightModule(): string {
  const match = readFileSync(INDEX, 'utf8').match(/(?:import|export)\s*\{[^}]*\bLottieLight\b[^}]*\}\s*from\s*["']([^"']+)["']/);
  assert.ok(match, "lottie-react's index no longer names the module LottieLight comes from");
  return resolve(dirname(INDEX), match[1]);
}

test('lottie-react is side-effect free, so a named re-export can drop the rest of its index', () => {
  assert.equal(pkg.sideEffects, false);
});

test("LottieLight's module graph reaches only lottie-web's light engine", () => {
  assert.deepEqual(lottieEnginesFrom(lottieLightModule()), ['lottie-web/build/player/lottie_light.js']);
});

test("the whole lottie-react index reaches all three engines, which is what a namespace import ships", () => {
  assert.deepEqual(lottieEnginesFrom(INDEX), [
    'lottie-web',
    'lottie-web/build/player/lottie_light.js',
    'lottie-web/build/player/lottie_svg.js',
  ]);
});

test('the player chunk entry is one static named re-export of LottieLight', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/lib/lottie-player.ts'), 'utf8')).trim();
  assert.equal(code, "export { LottieLight } from 'lottie-react';");
});

test("no app code calls import('lottie-react'); LottieIcon loads the player through lottie-player", () => {
  const offenders: string[] = [];
  for (const dir of ['src', 'app']) {
    for (const rel of readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })) {
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(rel) || /\.test\.ts$/.test(rel)) continue;
      const source = stripComments(readFileSync(join(ROOT, dir, rel), 'utf8'));
      if (/\bimport\s*\(\s*["']lottie-react["']\s*\)/.test(source)) offenders.push(join(dir, rel));
    }
  }
  assert.deepEqual(offenders, []);

  const icon = stripComments(readFileSync(join(ROOT, 'src/components/shared/LottieIcon.tsx'), 'utf8'));
  assert.match(icon, /\bimport\(\s*["']@\/lib\/lottie-player["']\s*\)/);
  // Types only: a value import would put lottie-react's full index in LottieIcon's own chunk.
  for (const m of icon.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s*["']lottie-react["']/gm)) {
    assert.ok(m[1], `LottieIcon imports a value from lottie-react: ${m[0].trim()}`);
  }
});
