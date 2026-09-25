#!/usr/bin/env node
/**
 * Shrinks public/models/holo-envelope.glb (the contact section's 3D envelope) to a
 * phone-friendly budget with the glTF Transform CLI: weld + meshoptimizer
 * simplification + meshopt compression, textures kept as the existing WebP.
 *
 *   node scripts/optimize-envelope.mjs                       optimize in place (backs up the original)
 *   node scripts/optimize-envelope.mjs --in a.glb --out b.glb
 *   node scripts/optimize-envelope.mjs --check               only verify the budget
 *   node scripts/optimize-envelope.mjs --screenshot <dir>    also render before/after PNGs for a parity check
 *
 * The simplify ratio starts at 0.2 and steps down only as far as the vertex budget
 * needs: UV seams lock vertices, so 0.2 of the indices keeps more than 20% of them.
 * Exits 1 when the budget cannot be met.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MODEL = join(ROOT, 'public/models/holo-envelope.glb');
const MAX_VERTICES = 40_000;
const MAX_BYTES = 900 * 1024;
const RATIOS = [0.2, 0.16, 0.14, 0.12, 0.1, 0.08];
const SIMPLIFY_ERROR = 0.01;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
const flag = (name) => process.argv.includes(name);
const log = (msg) => console.log(`[envelope] ${msg}`);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

/** Local CLI when installed (fast), else npx. */
function cli(args) {
  const local = join(ROOT, 'node_modules/@gltf-transform/cli/bin/cli.js');
  const [cmd, cmdArgs] = existsSync(local)
    ? [process.execPath, [local, ...args]]
    : [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', '@gltf-transform/cli', ...args]];
  const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && !existsSync(local) });
  if (res.status !== 0) throw new Error(`gltf-transform ${args[0]} failed:\n${res.stderr || res.stdout}`);
  return res.stdout;
}

/** Vertex count and size as `gltf-transform inspect` reports them. */
function inspect(file) {
  const csv = cli(['inspect', file, '--format', 'csv']);
  const lines = csv.split(/\r?\n/);
  const header = lines.findIndex((l) => l.startsWith('#,name,mode'));
  let vertices = 0;
  if (header !== -1) {
    const cols = lines[header].split(',');
    const at = cols.indexOf('vertices');
    for (let i = header + 1; i < lines.length && /^\d+,/.test(lines[i]); i++) {
      vertices += Number(lines[i].split(',')[at].replace(/[^\d]/g, '')) || 0;
    }
  }
  return { vertices, bytes: statSync(file).size };
}

const withinBudget = (m) => m.vertices > 0 && m.vertices <= MAX_VERTICES && m.bytes <= MAX_BYTES;

function optimize(input, output) {
  const tmp = join(tmpdir(), `envelope-${process.pid}.glb`);
  for (const ratio of RATIOS) {
    cli([
      'optimize', input, tmp,
      '--compress', 'meshopt',
      '--simplify-ratio', String(ratio),
      '--simplify-error', String(SIMPLIFY_ERROR),
      '--texture-compress', 'false',
      '--palette', 'false',
    ]);
    const m = inspect(tmp);
    log(`ratio ${ratio}: ${m.vertices.toLocaleString('en-US')} vertices, ${kb(m.bytes)}`);
    if (withinBudget(m)) {
      mkdirSync(dirname(output), { recursive: true });
      renameSync(tmp, output);
      return m;
    }
  }
  rmSync(tmp, { force: true });
  return null;
}

/* ---- before/after render for a visual parity check ---- */

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#060609}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(640, 640);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.AmbientLight(0xffffff, 0.22));
const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(4, 5, 4); scene.add(key);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100); camera.position.set(0, 0.2, 5.5);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const file = new URLSearchParams(location.search).get('m');
loader.load('/models/' + file, (gltf) => {
  gltf.scene.scale.setScalar(1.15); gltf.scene.position.y = -0.1; gltf.scene.rotation.set(0.12, -0.35, 0);
  scene.add(gltf.scene); renderer.render(scene, camera); window.__ready = true;
}, undefined, (e) => { window.__error = String(e); });
</script></body></html>`;

const TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };

async function screenshots(before, after, outDir) {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    log('screenshots skipped: @playwright/test is not installed');
    return;
  }
  const models = { 'before.glb': before, 'after.glb': after };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE);
      return;
    }
    if (path.startsWith('/three/')) file = join(ROOT, 'node_modules/three', path.slice('/three/'.length));
    if (path.startsWith('/models/')) file = models[path.slice('/models/'.length)] ?? null;
    if (!file || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
    for (const name of ['before', 'after']) {
      await page.goto(`http://127.0.0.1:${port}/?m=${name}.glb`);
      await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 60_000 });
      const error = await page.evaluate(() => window.__error);
      if (error) throw new Error(`render ${name}: ${error}`);
      const shot = join(outDir, `envelope-${name}.png`);
      await page.locator('canvas').screenshot({ path: shot });
      log(`wrote ${shot}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const input = resolve(arg('--in') ?? DEFAULT_MODEL);
  const output = resolve(arg('--out') ?? input);
  if (!existsSync(input)) {
    log(`missing ${input}`);
    return 1;
  }
  const before = inspect(input);
  log(`input  ${input}: ${before.vertices.toLocaleString('en-US')} vertices, ${kb(before.bytes)}`);

  if (flag('--check')) {
    const ok = withinBudget(before);
    log(ok ? 'within budget' : `over budget (max ${MAX_VERTICES.toLocaleString('en-US')} vertices, ${kb(MAX_BYTES)})`);
    return ok ? 0 : 1;
  }
  if (withinBudget(before) && output === input) {
    log('already within budget; nothing to do');
    return 0;
  }

  const backup = join(tmpdir(), `holo-envelope.orig-${Date.now()}.glb`);
  copyFileSync(input, backup);
  const after = optimize(backup, output);
  if (!after) {
    log(`could not reach ${MAX_VERTICES.toLocaleString('en-US')} vertices and ${kb(MAX_BYTES)}; ${output} left unchanged`);
    return 1;
  }
  log(`output ${output}: ${after.vertices.toLocaleString('en-US')} vertices, ${kb(after.bytes)} (original kept at ${backup})`);

  const shotDir = arg('--screenshot');
  if (shotDir) await screenshots(backup, output, resolve(shotDir));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
