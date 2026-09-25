#!/usr/bin/env node
// Rebuilds the research paper citations in src/data/skills-detailed.json from registry
// metadata instead of the generator's free text. For each paper:
//   verified    the link's arXiv / Crossref / PMC record carries the claimed title (or
//               carried it in arXiv v1); title and authors become the registry's
//   repointed   the link resolves to another paper, to nothing, or to a publisher page,
//               but the claimed title is in a registry; the citation moves to that record
//   dropped     the link is wrong and the claimed title is in no registry
//   unverified  a publisher page whose title no registry has; kept, minus a placeholder
//               author line, and reported
//
//   node scripts/verify-skill-papers.mjs                  report only
//   node scripts/verify-skill-papers.mjs --write          rewrite the source
//   node scripts/verify-skill-papers.mjs --only=sql,rag   limit to these skill slugs
// Then run `npm run skills:index` to regenerate public/data/skills.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatAuthors, isPlaceholderAuthors, paperRef, splitAuthors, titleSimilarity, titlesMatch, unlistedAuthors } from '../src/lib/paperMeta.ts';
import { slugify } from '../src/lib/slug.ts';
import { arxivFirstTitle, arxivRecords, arxivSearchTitle, canonicalUrl, crossrefSearchTitle, lookup, pmcSearchTitle } from './paper-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src/data/skills-detailed.json');

// Moving a citation to a different record needs a closer title match than confirming one.
const REPOINT_MATCH = 0.85;

function fromRecord(kind, rec, url) {
  const authors = formatAuthors(rec.authors);
  return { title: rec.title, url: url ?? canonicalUrl[kind](rec.id), ...(authors ? { authors } : {}) };
}

const registrant = (doi) => doi.split('/')[0];

/**
 * Among records with the claimed title, the likeliest one: the same DOI registrant as
 * the broken link (PNAS's "Veridical data science", not the WSDM keynote of that name),
 * then the most claimed authors on it.
 */
function rank(hits, paper, ref) {
  const claimed = paper.authors && !isPlaceholderAuthors(paper.authors) ? splitAuthors(paper.authors) : [];
  const score = (h) => {
    let s = h.sim;
    if (ref?.kind === 'doi' && h.kind === 'doi' && registrant(ref.id) === registrant(h.rec.id)) s += 0.2;
    if (claimed.length) s += (0.1 * (claimed.length - unlistedAuthors(paper.authors, h.rec.authors).length)) / claimed.length;
    return s;
  };
  return hits.sort((a, b) => score(b) - score(a));
}

async function findByTitle(paper, ref) {
  const hint = paper.authors && !isPlaceholderAuthors(paper.authors) ? paper.authors : undefined;
  const searches = {
    arxiv: async () => (await arxivSearchTitle(paper.title)).map((rec) => ({ kind: 'arxiv', rec })),
    doi: async () => (await crossrefSearchTitle(paper.title, hint)).map((rec) => ({ kind: 'doi', rec })),
    pmc: async () => (await pmcSearchTitle(paper.title)).map((rec) => ({ kind: 'pmc', rec })),
  };
  const order = ref?.kind === 'pmc' ? ['pmc', 'doi'] : ref?.kind === 'doi' ? ['doi', 'arxiv'] : ['arxiv', 'doi'];
  for (const kind of order) {
    const hits = (await searches[kind]())
      .map((h) => ({ ...h, sim: titleSimilarity(paper.title, h.rec.title) }))
      .filter((h) => h.sim >= REPOINT_MATCH);
    if (hits.length) return rank(hits, paper, ref)[0];
  }
  return null;
}

/** What the citation should become, with the reason. */
export async function resolvePaper(paper, cache = {}) {
  const ref = paperRef(paper.url);
  let rec = null;
  if (ref) {
    rec = await lookup(ref, cache.arxiv);
    if (rec && titlesMatch(paper.title, rec.title)) {
      return { verdict: 'verified', paper: fromRecord(ref.kind, rec, paper.url) };
    }
    if (rec && ref.kind === 'arxiv') {
      const first = await arxivFirstTitle(ref.id, cache.arxivV1);
      if (first && titlesMatch(paper.title, first)) {
        return { verdict: 'verified', paper: fromRecord(ref.kind, rec, paper.url), note: `renamed since v1 ("${first}")` };
      }
    }
  }
  const found = await findByTitle(paper, ref);
  const was = !ref ? 'publisher page' : rec ? `${ref.kind}:${ref.id} is "${rec.title}"` : `${ref.kind}:${ref.id} is not registered`;
  if (found) {
    return { verdict: 'repointed', paper: fromRecord(found.kind, found.rec), note: `${was}; found as ${found.kind}:${found.rec.id}` };
  }
  if (ref) return { verdict: 'dropped', note: `${was}; the claimed title is in no registry` };
  const { authors, ...rest } = paper;
  const keep = authors && !isPlaceholderAuthors(authors) ? paper : rest;
  return { verdict: 'unverified', paper: keep, note: keep === paper ? was : `${was}; dropped author line "${authors}"` };
}

async function main() {
  const write = process.argv.includes('--write');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;

  const skills = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const inScope = skills.filter((s) => !only || only.has(slugify(s.name)));
  if (only) {
    const unknown = [...only].filter((slug) => !skills.some((s) => slugify(s.name) === slug));
    if (unknown.length) throw new Error(`--only names no skill: ${unknown.join(', ')}`);
  }
  const arxivIds = inScope.flatMap((s) => (s.researchPapers ?? []).map((p) => paperRef(p.url)).filter((r) => r?.kind === 'arxiv').map((r) => r.id));
  const cache = { arxiv: await arxivRecords(arxivIds) };

  const tally = { verified: 0, repointed: 0, dropped: 0, unverified: 0 };
  let changedSkills = 0;
  for (const skill of inScope) {
    const before = skill.researchPapers ?? [];
    const after = [];
    for (const paper of before) {
      const r = await resolvePaper(paper, cache);
      tally[r.verdict]++;
      if (r.verdict !== 'verified' || r.note || JSON.stringify(r.paper) !== JSON.stringify(paper)) {
        console.log(`${r.verdict.padEnd(10)} ${slugify(skill.name)} · "${paper.title}"${r.note ? `\n           ${r.note}` : ''}`);
        if (r.verdict === 'verified' && r.paper.authors !== paper.authors) {
          console.log(`           authors "${paper.authors ?? ''}" -> "${r.paper.authors ?? ''}"`);
        }
      }
      if (r.paper && !after.some((p) => p.url === r.paper.url)) after.push(r.paper);
    }
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      changedSkills++;
      skill.researchPapers = after;
    }
  }

  console.log(
    `\n${tally.verified} verified, ${tally.repointed} repointed, ${tally.dropped} dropped, ${tally.unverified} unverified; ` +
      `${changedSkills} of ${inScope.length} skills change`,
  );
  if (write && changedSkills) {
    writeFileSync(SOURCE, JSON.stringify(skills, null, 2));
    console.log(`wrote ${path.relative(ROOT, SOURCE)}; run npm run skills:index next`);
  } else if (!write && changedSkills) {
    console.log('dry run; pass --write to apply');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
