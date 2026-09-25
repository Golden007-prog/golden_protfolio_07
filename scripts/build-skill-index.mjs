#!/usr/bin/env node
// Splits src/data/skills-detailed.json (the research source, ~170 KB gzipped) into
//   src/data/skills-index.json      what the page needs up front: name, category and
//                                    the one-line definition for every skill;
//   public/data/skills/<slug>.json  the full write-up, fetched when a skill opens.
// Slugs and hero image paths are derived at runtime from the name with slugify, so
// the eager bundle carries no per-skill path strings.
//
//   node scripts/build-skill-index.mjs        (npm run skills:index)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { slugify } from '../src/lib/slug.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src/data/skills-detailed.json');
const PROFILE = path.join(ROOT, 'src/data/profile.json');
const INDEX_OUT = path.join(ROOT, 'src/data/skills-index.json');
const DETAIL_DIR = path.join(ROOT, 'public/data/skills');
const HERO_DIR = path.join(ROOT, 'public/skills');

export const MAX_SOURCES = 8;

// Vertex AI grounding redirects are short-lived: every one of the 887 in the source
// returned 404 when checked on 2026-09-25, and all show the same hostname anyway.
const EXPIRED_SOURCE = /^https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\//;

export function isShippableSource(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url) && !EXPIRED_SOURCE.test(url);
}

export function readSkills() {
  return JSON.parse(readFileSync(SOURCE, 'utf8'));
}

/** '<b>RAG</b> is an AI framework…' -> { term: 'RAG', def: ' is an AI framework…' } */
export function splitShortDef(shortDef, name) {
  const m = /^<b>(.*?)<\/b>([\s\S]*)$/.exec(shortDef ?? '');
  if (!m) return { term: name, def: stripTags(shortDef ?? '') };
  return { term: stripTags(m[1]), def: stripTags(m[2]) };
}

function stripTags(s) {
  if (/&[#a-z0-9]+;/i.test(s)) throw new Error(`HTML entity in a skill definition; decode it in the source: ${s}`);
  return s.replace(/<[^>]*>/g, '');
}

function nonEmpty(list) {
  return Array.isArray(list) && list.length > 0 ? list : undefined;
}

export function toIndexEntry(skill) {
  const slug = slugify(skill.name);
  const { term, def } = splitShortDef(skill.shortDef, skill.name);
  let hero = false;
  if (skill.heroImage) {
    if (skill.heroImage !== `/skills/${slug}.webp`) {
      throw new Error(`${skill.name}: heroImage ${skill.heroImage} is not /skills/${slug}.webp`);
    }
    hero = existsSync(path.join(HERO_DIR, `${slug}.webp`));
    if (!hero) console.warn(`warn  ${skill.name}: ${skill.heroImage} is missing from public/, shipping without it`);
  }
  return { name: skill.name, category: skill.category, term, def, hero };
}

/** The on-demand payload: empty lists, the dead videoDemo field and expired sources dropped. */
export function toDetail(skill) {
  const detail = {
    name: skill.name,
    category: skill.category,
    purpose: skill.purpose || undefined,
    coreComponents: nonEmpty(skill.coreComponents),
    keyCapabilities: nonEmpty(skill.keyCapabilities),
    integrations: nonEmpty(skill.integrations),
    useCases: nonEmpty(skill.useCases),
    officialDocs: skill.officialDocs || undefined,
    researchPapers: nonEmpty(skill.researchPapers),
    sources: nonEmpty((skill.sources ?? []).filter(isShippableSource).slice(0, MAX_SOURCES)),
  };
  return Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined));
}

/** Every link a skill page can show, with where it came from. */
export function collectShippedUrls(skills = readSkills()) {
  const out = [];
  for (const skill of skills) {
    const d = toDetail(skill);
    if (d.officialDocs) out.push({ url: d.officialDocs, where: `${skill.name} · officialDocs` });
    for (const p of d.researchPapers ?? []) out.push({ url: p.url, where: `${skill.name} · paper "${p.title}"` });
    for (const s of d.sources ?? []) out.push({ url: s, where: `${skill.name} · source` });
  }
  return out;
}

function main() {
  const skills = readSkills();
  const profile = JSON.parse(readFileSync(PROFILE, 'utf8'));

  const slugs = new Set();
  for (const s of skills) {
    const slug = slugify(s.name);
    if (!slug || slugs.has(slug)) throw new Error(`Empty or duplicate skill slug "${slug}" (${s.name})`);
    slugs.add(slug);
  }
  const known = new Set(skills.map((s) => s.name));
  const missing = Object.values(profile.skills)
    .flat()
    .filter((name) => !known.has(name));
  if (missing.length) throw new Error(`profile.json skills without a write-up: ${missing.join(', ')}`);

  const index = skills.map(toIndexEntry);
  writeFileSync(INDEX_OUT, `${JSON.stringify(index, null, 2)}\n`);

  mkdirSync(DETAIL_DIR, { recursive: true });
  for (const file of readdirSync(DETAIL_DIR)) {
    if (file.endsWith('.json')) rmSync(path.join(DETAIL_DIR, file));
  }
  let bytes = 0;
  for (const skill of skills) {
    const json = JSON.stringify(toDetail(skill));
    bytes += json.length;
    writeFileSync(path.join(DETAIL_DIR, `${slugify(skill.name)}.json`), json);
  }

  const indexBytes = readFileSync(INDEX_OUT).length;
  console.log(
    `skills-index.json: ${index.length} skills, ${(indexBytes / 1024).toFixed(1)} KB\n` +
      `public/data/skills: ${skills.length} files, ${(bytes / 1024).toFixed(1)} KB total`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
