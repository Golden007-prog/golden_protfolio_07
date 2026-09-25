/**
 * Research paper citations in the skill write-ups came from Gemini's free text, which
 * pointed titles at unrelated arXiv IDs and made up author lists. These helpers let
 * scripts/verify-skill-papers.mjs and scripts/check-skill-links.mjs hold every
 * citation to what the registry (arXiv, Crossref, NCBI) says the link resolves to,
 * and let the dialog refuse to print a generator note as an author line.
 */

export type PaperRef = { kind: 'arxiv' | 'doi' | 'pmc'; id: string };

const ARXIV_ID = String.raw`(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})`;
const ARXIV_URL = new RegExp(String.raw`^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/${ARXIV_ID}(?:v\d+)?(?:\.pdf)?\/?(?:[?#].*)?$`, 'i');
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;
const DOI_URL = /^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^?#\s]+)/i;
const PUBLISHER_DOI = /\/doi\/(?:abs\/|full\/|pdf\/|epdf\/)?(10\.\d{4,9}\/[^?#\s]+)/i;
const PMC_URL = /^https?:\/\/(?:www\.)?(?:ncbi\.nlm\.nih\.gov\/pmc\/articles|pmc\.ncbi\.nlm\.nih\.gov\/articles)\/PMC(\d+)/i;

/** The registry record a paper link can be checked against, or null for any other host. */
export function paperRef(url: string): PaperRef | null {
  const arxiv = ARXIV_URL.exec(url);
  if (arxiv) return { kind: 'arxiv', id: arxiv[1] };
  const pmc = PMC_URL.exec(url);
  if (pmc) return { kind: 'pmc', id: pmc[1] };
  const doi = DOI_URL.exec(url) ?? PUBLISHER_DOI.exec(url);
  if (doi) {
    const id = decodeURIComponent(doi[1]).replace(/\/+$/, '');
    const onArxiv = ARXIV_DOI.exec(id);
    return onArxiv ? { kind: 'arxiv', id: onArxiv[1] } : { kind: 'doi', id: id.toLowerCase() };
  }
  return null;
}

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const STOPWORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'is', 'of', 'on', 'the', 'to', 'via', 'with']);

/** The title's content words, lower-case ASCII, markup and function words dropped. */
export function titleWords(title: string): Set<string> {
  const plain = fold(title)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\$|\\[a-z]+|[{}]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ');
  return new Set(plain.split(' ').filter((w) => (w.length > 1 || /\d/.test(w)) && !STOPWORDS.has(w)));
}

function overlap(a: string, b: string) {
  const A = titleWords(a);
  const B = titleWords(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return { shared, larger: Math.max(A.size, B.size), smaller: Math.min(A.size, B.size) };
}

/** Shared words over the longer title's word count: 1 for the same title, near 0 for unrelated ones. */
export function titleSimilarity(a: string, b: string): number {
  const { shared, larger, smaller } = overlap(a, b);
  return smaller ? shared / larger : 0;
}

export const TITLE_MATCH = 0.8;
/** A shortened title ("Automatic Chain of Thought Prompting") still names the paper if it has this many words. */
const MIN_CONTAINED_WORDS = 4;

/**
 * Whether two titles name the same paper: nearly the same words, or one is a
 * shortening of the other. Unrelated papers share almost nothing, so both tests
 * sit far from them.
 */
export function titlesMatch(a: string, b: string): boolean {
  const { shared, larger, smaller } = overlap(a, b);
  if (!smaller) return false;
  if (shared / larger >= TITLE_MATCH) return true;
  return smaller >= MIN_CONTAINED_WORDS && shared / smaller >= TITLE_MATCH;
}

// What the generator wrote when it had no names: "Various (… not highlighted in snippet …)",
// "Not specified in snippet", "Not directly available in snippets, typically found on arXiv page".
const PLACEHOLDER =
  /snippet|not (?:specified|directly|explicitly|available|listed|provided|mentioned)|various|unknown|typically found|\bn\/a\b|anonymous|multiple authors|authors? (?:not|unavailable)/i;
const INITIALS_ONLY = /^(?:\s*[A-Z]\.?\s*)+$/;

/**
 * True when an author line is not a list of names: a generator note, a run of bare
 * initials ("S. A. M. S. M. S. A. S. A.") or the same name repeated.
 */
export function isPlaceholderAuthors(authors: string | undefined | null): boolean {
  if (!authors || !authors.trim()) return true;
  if (PLACEHOLDER.test(authors)) return true;
  if (INITIALS_ONLY.test(authors.replace(/,/g, ' '))) return true;
  const names = splitAuthors(authors).map((n) => fold(n).replace(/[^a-z]+/g, ' ').trim());
  return new Set(names).size < names.length;
}

/** 'A, B and C et al.' -> ['A', 'B', 'C']; 'A and 4 other authors' -> ['A'] */
export function splitAuthors(authors: string): string[] {
  return authors
    .replace(/\bet al\.?/gi, '')
    .replace(/\band \d+ (?:other )?(?:authors|others)\b/gi, '')
    .split(/,|;|\band\b|&/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const MAX_AUTHORS = 3;

/** The author line the dialog shows: every name up to three, else the first three and "et al." */
export function formatAuthors(names: string[]): string {
  const clean = names.map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (clean.length <= MAX_AUTHORS) return clean.join(', ');
  return `${clean.slice(0, MAX_AUTHORS).join(', ')} et al.`;
}

function nameTokens(name: string): string[] {
  return fold(name)
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1);
}

/**
 * The names in `shown` that the registry does not list. A shown name passes when every
 * part longer than an initial appears in one registry name, so "Sergey Zeltyn" passes
 * and an invented "Shai Zeltyn" does not.
 */
export function unlistedAuthors(shown: string, registry: string[]): string[] {
  const real = registry.map((n) => new Set(nameTokens(n)));
  return splitAuthors(shown).filter((name) => {
    const parts = nameTokens(name);
    if (!parts.length) return false;
    return !real.some((r) => parts.every((p) => r.has(p)));
  });
}

/** A paper as a registry describes it. */
export interface PaperRecord {
  id: string;
  title: string;
  authors: string[];
}

export type CitationProblem = { kind: 'missing' | 'title' | 'authors'; message: string };

/**
 * What is wrong with a shipped citation, judged against the record its link resolves
 * to: `null` when the link has a registry ID the registry does not know, `undefined`
 * for a publisher page no registry covers (only the author line can be judged then).
 */
export function citationProblems(
  paper: { title: string; url: string; authors?: string },
  record: PaperRecord | null | undefined,
): CitationProblem[] {
  const problems: CitationProblem[] = [];
  if (record === null) problems.push({ kind: 'missing', message: 'the registry has no record for this link' });
  if (record && !titlesMatch(paper.title, record.title)) {
    problems.push({ kind: 'title', message: `the link opens "${record.title}"` });
  }
  if (paper.authors !== undefined) {
    if (isPlaceholderAuthors(paper.authors)) {
      problems.push({ kind: 'authors', message: `author line "${paper.authors}" is not a list of names` });
    } else if (record?.authors.length && !problems.some((p) => p.kind === 'title')) {
      // Against the wrong paper every name would be "unlisted"; the title problem says enough.
      const unlisted = unlistedAuthors(paper.authors, record.authors);
      if (unlisted.length) problems.push({ kind: 'authors', message: `${unlisted.join(', ')} not among the paper's authors` });
    }
  }
  return problems;
}

/** The author line to print under a paper, or nothing when it is a generator note. */
export function paperByline(authors: string | undefined): string | undefined {
  return authors && !isPlaceholderAuthors(authors) ? authors : undefined;
}

/** Registry text to plain: XML entities decoded, tags dropped, whitespace collapsed. */
export function plainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
