// Read-only lookups against the registries a research paper link can be checked
// against: the arXiv export API, Crossref (DOIs) and NCBI eutils (PubMed Central).
// Used by scripts/verify-skill-papers.mjs and scripts/check-skill-links.mjs.

import { plainText } from '../src/lib/paperMeta.ts';

const AGENT = 'skill-link-checker/1.0 (+https://www.basuoikantik.in)';
const TIMEOUT_MS = 30_000;
// arXiv asks API clients for one request every three seconds.
const ARXIV_GAP_MS = 3_100;
const ARXIV_BATCH = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { json = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return json ? await res.json() : await res.text();
    } catch (err) {
      lastError = err;
      await sleep(2_000 * (attempt + 1));
    }
  }
  throw new Error(`registry lookup failed: ${url}: ${lastError?.message ?? lastError}`);
}

let arxivLast = 0;
async function arxivGet(query) {
  const wait = arxivLast + ARXIV_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    return await get(`https://export.arxiv.org/api/query?${query}`);
  } finally {
    arxivLast = Date.now();
  }
}

function parseArxivFeed(xml) {
  const out = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = /<id>https?:\/\/arxiv\.org\/abs\/(.+?)(?:v\d+)?<\/id>/.exec(entry)?.[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1];
    if (!id || !title) continue;
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => plainText(m[1]));
    out.push({ id, title: plainText(title), authors });
  }
  return out;
}

/**
 * id -> { title, authors } for every ID arXiv knows; unknown IDs are absent. With
 * `version`, the record as that version had it, still keyed by the bare ID: papers
 * get renamed, and a citation made from v1 names the v1 title.
 */
export async function arxivRecords(ids, { version } = {}) {
  const found = new Map();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += ARXIV_BATCH) {
    const batch = unique.slice(i, i + ARXIV_BATCH).map((id) => (version ? `${id}v${version}` : id));
    const xml = await arxivGet(`id_list=${batch.map(encodeURIComponent).join(',')}&max_results=${batch.length}`);
    for (const rec of parseArxivFeed(xml ?? '')) found.set(rec.id, rec);
  }
  return found;
}

const SEARCH_WORDS = 8;

/**
 * Candidates for a title: the exact phrase; then every one of its longest words, since a
 * phrase query splits "Gemini 1.5" apart; then any of them, ranked by relevance, since
 * arXiv keeps authors' typos ("Presidental") that an all-words query cannot match.
 */
export async function arxivSearchTitle(title) {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return [];
  const phrase = parseArxivFeed((await arxivGet(`search_query=${encodeURIComponent(`ti:"${words.join(' ')}"`)}&max_results=5`)) ?? '');
  if (phrase.length) return phrase;
  const keys = [...new Set(words.filter((w) => w.length > 3).map((w) => w.toLowerCase()))].sort((a, b) => b.length - a.length);
  if (keys.length < 2) return [];
  for (const [join, count] of [
    [' AND ', SEARCH_WORDS],
    [' OR ', keys.length],
  ]) {
    const query = keys.slice(0, count).map((w) => `ti:${w}`).join(join);
    const hits = parseArxivFeed((await arxivGet(`search_query=${encodeURIComponent(query)}&sortBy=relevance&max_results=10`)) ?? '');
    if (hits.length) return hits;
  }
  return [];
}

function crossrefRecord(msg) {
  const title = plainText(msg?.title?.[0] ?? '');
  if (!msg?.DOI || !title) return null;
  const authors = (msg.author ?? [])
    .map((a) => plainText(a.name ?? [a.given, a.family].filter(Boolean).join(' ')))
    .filter(Boolean);
  return { id: msg.DOI.toLowerCase(), title, authors };
}

/** { id, title, authors } for a DOI Crossref has registered, else null. */
export async function crossrefWork(doi) {
  const body = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { json: true });
  return body ? crossrefRecord(body.message) : null;
}

/**
 * Crossref records for a title. `authors`, when given, is a second query's hint: a
 * common title ("Veridical data science") has namesakes that outrank the paper itself.
 */
export async function crossrefSearchTitle(title, authors) {
  const base = `https://api.crossref.org/works?select=DOI,title,author&query.bibliographic=${encodeURIComponent(title)}`;
  const queries = [`${base}&rows=10`];
  if (authors) queries.push(`${base}&rows=5&query.author=${encodeURIComponent(authors)}`);
  const seen = new Map();
  for (const url of queries) {
    const body = await get(url, { json: true });
    for (const rec of (body?.message?.items ?? []).map(crossrefRecord)) if (rec && !seen.has(rec.id)) seen.set(rec.id, rec);
  }
  return [...seen.values()];
}

function pmcRecords(summary) {
  const result = summary?.result ?? {};
  return (result.uids ?? [])
    .map((uid) => result[uid])
    .filter((r) => r && !r.error && r.title)
    .map((r) => ({ id: String(r.uid), title: plainText(r.title), authors: (r.authors ?? []).map((a) => plainText(a.name)).filter(Boolean) }));
}

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/** { id, title, authors } for a PMC article number, else null. */
export async function pmcRecord(id) {
  const body = await get(`${EUTILS}/esummary.fcgi?db=pmc&retmode=json&id=${encodeURIComponent(id)}`, { json: true });
  return pmcRecords(body)[0] ?? null;
}

export async function pmcSearchTitle(title) {
  const search = await get(`${EUTILS}/esearch.fcgi?db=pmc&retmode=json&retmax=5&term=${encodeURIComponent(`${title}[Title]`)}`, {
    json: true,
  });
  const ids = search?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  await sleep(400);
  const body = await get(`${EUTILS}/esummary.fcgi?db=pmc&retmode=json&id=${ids.join(',')}`, { json: true });
  return pmcRecords(body);
}

/** The registry record behind a paper reference, or null when the registry has none. */
export async function lookup(ref, arxivCache) {
  if (ref.kind === 'arxiv') return arxivCache?.get(ref.id) ?? (await arxivRecords([ref.id])).get(ref.id) ?? null;
  if (ref.kind === 'doi') return crossrefWork(ref.id);
  return pmcRecord(ref.id);
}

/** The title an arXiv paper had in its first version, when it has been renamed since. */
export async function arxivFirstTitle(id, cache) {
  if (cache?.has(id)) return cache.get(id)?.title ?? null;
  return (await arxivRecords([id], { version: 1 })).get(id)?.title ?? null;
}

export const canonicalUrl = {
  arxiv: (id) => `https://arxiv.org/abs/${id}`,
  doi: (id) => `https://doi.org/${id}`,
  pmc: (id) => `https://pmc.ncbi.nlm.nih.gov/articles/PMC${id}/`,
};
