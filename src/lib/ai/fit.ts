/*
 * The recruiter fit check's deterministic core, shared by the four recruiter
 * routes, the fit sheet, the lens pitches and scripts/ai/gen-recruiter.mjs.
 *
 * Everything that can be decided without a model is decided here:
 *   - the no-key lexical pre-pass (techFamily + matchesTech, case-sensitive, so
 *     'ReAct' never matches 'React') and the skills matrix built on it;
 *   - years, location, remote, visa, notice, salary, relocation, start date and
 *     education rows, answered from facts.ts and never by the model;
 *   - verification of the model's rows (ids exist, quotes are verbatim, an
 *     'evidenced' row's quote names the thing) and the overall band, computed
 *     from row counts with must-haves weighted. There is no percentage;
 *   - hand-offs, exports and the lens store gate.
 *
 * Pure: relative .ts imports only, and data is passed in, so node --test runs it.
 */
import { AI_LIMITS } from './config.ts';
import type { Chunk } from './corpus.ts';
import { educationStatus, experienceSpans, logistics, type FactEducation, type FactExperience, type LogisticsKind } from './facts.ts';
import type { AiFallback, AiTarget } from './protocol.ts';
import { redact } from './redact.ts';
import { visible, type StoreEntry } from './reviewGate.ts';
import { validTarget, type KnownTargets } from './sanitize.ts';
import { numbersIn, resolveId, tripwire, unlistedAffiliation, verifyClaims, type ClaimEntities, type FactSource } from './verify.ts';
import { projectsForSkill } from '../skillProjects.ts';
import { slugify } from '../slug.ts';
import { matchesTech, techFamily } from '../tech.ts';
import { formatYearMonth } from '../../utils/dates.ts';

/* ---------------------------------------------------------------------------
 * Data shapes (structural, so profile.json and PROJECTS satisfy them)
 * ------------------------------------------------------------------------- */

export type FitRole = FactExperience & { location?: string; description?: string; highlights?: readonly string[]; metrics?: readonly { value: string; label: string }[] };

export type FitProfile = {
  name: string;
  headline: string;
  location: string;
  availability: { status: string; focus: string; openTo: string };
  skills: Readonly<Record<string, readonly string[]>>;
  experience: readonly FitRole[];
  education: readonly FactEducation[];
};

export type FitProject = { slug: string; name: string; tagline: string; techStack: readonly string[]; featured?: boolean };

export type FitData = { profile: FitProfile; projects: readonly FitProject[] };

export const REQ_KINDS = ['must', 'nice'] as const;
export type ReqKind = (typeof REQ_KINDS)[number];
export const REQ_CATEGORIES = ['skill', 'experience', 'education', 'logistics', 'other'] as const;
export type ReqCategory = (typeof REQ_CATEGORIES)[number];

export type Requirement = { text: string; kind: ReqKind; category?: ReqCategory; gloss?: string };

export type FitStatus = 'evidenced' | 'adjacent' | 'not-listed';

export type FitEvidence = { id: string; quote: string; label?: string; target?: AiTarget };

export type FitRow = {
  requirement: string;
  kind: ReqKind;
  status: FitStatus;
  evidence: FitEvidence[];
  /** The site's exact term the model mapped the requirement to: labelled 'mapped by AI'. */
  synonym?: string;
  /** 'lexical' when the keyword pass (not the model) supplied the evidence. */
  source: 'ai' | 'lexical';
};

const EDGE_BEFORE = '(?<![A-Za-z0-9])';
const EDGE_AFTER = '(?![A-Za-z0-9])';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `term` as a whole word in `text`, case-sensitively. */
function namesVerbatim(text: string, term: string): boolean {
  return new RegExp(`${EDGE_BEFORE}${escapeRegExp(term)}${EDGE_AFTER}`).test(text);
}

/** Model text without HTML or [c:id] markers: ids belong in evidence fields, not in prose. */
export function stripMarkup(s: string): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\[c:[^\]\n]*\]/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/* ---------------------------------------------------------------------------
 * Input
 * ------------------------------------------------------------------------- */

/** The JD as hashed and matched: NFKC, one space per run, at most one blank line, capped. */
export function normalizeJd(jd: string): string {
  return String(jd ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, AI_LIMITS.jd);
}

/** Lines and sentences of a JD, bullets stripped. Periods inside 'Node.js' do not split. */
export function jdSegments(jd: string): string[] {
  return normalizeJd(jd)
    .split(/\n|(?<=[.!?;])\s+|\s[•·|]\s/)
    .map((s) => s.replace(/^[\s•·*\-–—>]+/, '').trim())
    .filter((s) => s.length > 0);
}

/** The first line when it reads like a job title ('Senior ML Engineer'), else null. */
export function roleFromJd(jd: string): string | null {
  const first = normalizeJd(jd).split('\n').find((l) => l.trim()) ?? '';
  const line = first
    .replace(/^(?:job\s+title|title|role|position)\s*[:\-–]\s*/i, '')
    .replace(/^[#*\s]+|[*\s]+$/g, '')
    .trim();
  if (!line || line.length > AI_LIMITS.title || line.split(/\s+/).length > 10 || /[.!?:;]$/.test(line)) return null;
  return line;
}

/** Trimmed, capped, de-duplicated and at most 12 requirements with valid kinds and categories. */
export function cleanRequirements(list: readonly Partial<Requirement>[] | null | undefined): Requirement[] {
  const out: Requirement[] = [];
  const seen = new Set<string>();
  for (const r of list ?? []) {
    if (!r || typeof r.text !== 'string') continue;
    const text = clip(r.text, AI_LIMITS.requirement);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const req: Requirement = { text, kind: r.kind === 'nice' ? 'nice' : 'must' };
    if (r.category && (REQ_CATEGORIES as readonly string[]).includes(r.category)) req.category = r.category;
    if (typeof r.gloss === 'string' && r.gloss.trim() && r.gloss.trim() !== text) req.gloss = clip(r.gloss, AI_LIMITS.requirement);
    out.push(req);
    if (out.length >= AI_LIMITS.jdRequirements) break;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Lexical pre-pass (no AI)
 * ------------------------------------------------------------------------- */

export type VocabTerm = { term: string; category: string | null };

/** Every listed skill (with its category), then each project tech family the skills don't already cover. */
export function vocabulary(data: FitData): VocabTerm[] {
  const out = new Map<string, VocabTerm>();
  const families = new Set<string>();
  for (const [category, list] of Object.entries(data.profile.skills)) {
    for (const term of list) {
      if (out.has(term)) continue;
      out.set(term, { term, category });
      families.add(techFamily(term));
    }
  }
  for (const p of data.projects) {
    for (const entry of p.techStack) {
      const family = techFamily(entry);
      if (families.has(family)) continue;
      families.add(family);
      out.set(family, { term: family, category: null });
    }
  }
  return [...out.values()];
}

// 'Semantic chunking' may open a JD sentence or sit mid-sentence in lower case.
// Single words keep strict case: 'React' must not match 'react to feedback'.
function lowerFirstVariant(term: string): string | null {
  return /^[A-Z][a-z-]+(?: [a-z][a-z-]*)+$/.test(term) ? term[0].toLowerCase() + term.slice(1) : null;
}

/** True when the segments name `term` through techFamily/matchesTech (case-sensitive). */
export function mentions(segments: readonly string[], term: string): boolean {
  if (!segments.length || !term) return false;
  if (matchesTech(segments, term)) return true;
  const lower = lowerFirstVariant(term);
  return lower ? matchesTech(segments, lower) : false;
}

export type LexicalHit = {
  term: string;
  /** The profile skill category, or null for a project technology that is not a listed skill. */
  category: string | null;
  /** Slugs of projects whose stack uses it (projectsForSkill). */
  projects: string[];
  /** Indices of roles whose description or highlights name it verbatim. */
  roles: number[];
  evidence: FitEvidence[];
};

/** Roles that name `term` verbatim, with the chunk id that says so. */
export function rolesNaming(profile: Pick<FitProfile, 'experience'>, term: string): { index: number; id: string }[] {
  const out: { index: number; id: string }[] = [];
  profile.experience.forEach((e, i) => {
    if (e.description && namesVerbatim(e.description, term)) out.push({ index: i, id: `exp:${i}` });
    else {
      const j = (e.highlights ?? []).findIndex((h) => namesVerbatim(h, term));
      if (j >= 0) out.push({ index: i, id: `exp:${i}#h${j}` });
    }
  });
  return out;
}

/** Evidence for a site term: its skill list, up to two projects' stacks and up to two roles. */
export function termEvidence(term: string, category: string | null, data: FitData): FitEvidence[] {
  const evidence: FitEvidence[] = [];
  if (category) {
    evidence.push({ id: `skills:${slugify(category)}`, quote: term, label: `Skills · ${category}`, target: { kind: 'skill', name: term } });
  }
  for (const p of projectsForSkill(data.projects, term).slice(0, 2)) {
    const entry = p.techStack.find((s) => matchesTech([s], term)) ?? term;
    evidence.push({ id: `project:${p.slug}#stack`, quote: entry, label: `${p.name} · Stack`, target: { kind: 'project', slug: p.slug } });
  }
  for (const r of rolesNaming(data.profile, term).slice(0, 2)) {
    const role = data.profile.experience[r.index];
    evidence.push({ id: r.id, quote: term, label: `${role.company} · ${role.role}`, target: { kind: 'experience', index: r.index } });
  }
  return evidence;
}

/** Site terms the JD names exactly, strongest (most projects and roles) first. */
export function lexicalHits(jd: string, data: FitData): LexicalHit[] {
  const segments = jdSegments(jd);
  const hits: (LexicalHit & { order: number })[] = [];
  vocabulary(data).forEach((v, order) => {
    if (!mentions(segments, v.term)) return;
    const projects = projectsForSkill(data.projects, v.term).map((p) => p.slug);
    const roles = rolesNaming(data.profile, v.term).map((r) => r.index);
    hits.push({ term: v.term, category: v.category, projects, roles, evidence: termEvidence(v.term, v.category, data), order });
  });
  const strength = (h: LexicalHit) => h.projects.length + 2 * h.roles.length + (h.category ? 1 : 0);
  return hits
    .sort((a, b) => strength(b) - strength(a) || a.order - b.order)
    .map((h) => ({ term: h.term, category: h.category, projects: h.projects, roles: h.roles, evidence: h.evidence }));
}

/* ---------------------------------------------------------------------------
 * Facts: years, logistics and education, never answered by the model
 * ------------------------------------------------------------------------- */

export type FactKind = 'years' | 'education' | LogisticsKind | 'other';

const WORD_NUMBER = '(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)';
// Order matters: '5+ years with a work permit' is a years row. Degree abbreviations
// are matched case-sensitively, or 'be able to' would read as a B.E.
const FACT_PATTERNS: readonly (readonly [Exclude<FactKind, 'other'>, readonly RegExp[]])[] = [
  ['years', [new RegExp(String.raw`\b(?:\d{1,2}(?:\.\d)?\s*\+?|${WORD_NUMBER}\s*\+?)\s*(?:(?:-|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b|\byears? of (?:\w+\s+){0,3}experience\b`, 'i')]],
  ['visa', [/\bvisas?\b|\bsponsor(?:ship)?\b|\bwork authori[sz]ation\b|\bright to work\b|\bwork permit\b|\bcitizenship\b|\bgreen card\b|\bH-?1B\b/i]],
  ['salary', [/\bsalar(?:y|ies)\b|\bcompensation\b|\bCTC\b|\bpay (?:range|band|scale)\b|\bLPA\b|\bstipend\b|\b(?:hourly|day|daily) rate\b/i]],
  ['notice', [/\bnotice period\b|\bimmediate joiners?\b|\bjoin(?:ing)? immediately\b|\bserving notice\b/i]],
  ['relocation', [/\breloca(?:te|tion|ting)\b/i]],
  ['start', [/\bstart(?:ing)? date\b|\b(?:start|join)(?:ing)? (?:immediately|asap|by|on|from)\b|\bjoining date\b|\bavailable to start\b/i]],
  ['remote', [/\bremote\b|\bhybrid\b|\bon-?site\b|\bin[- ]office\b|\bwork from home\b|\bWFH\b/i]],
  ['type', [/\bfull[- ]time\b|\bpart[- ]time\b|\bcontract(?:or|ual)?\b|\bfreelance\b|\binternship\b|\bpermanent (?:role|position)\b|\bC2H\b/i]],
  ['location', [/\blocation\b|\bbased in\b|\bmust (?:be|live) in\b|\blocated in\b|\bcommut/i]],
  ['education', [/\bbachelor(?:['’]s|s)?\b|\bmaster(?:['’]s|s)\b|\bmaster of\b|\bph\.?\s?d\b|\bdegree\b|\bgraduat(?:e|ion)\b/i, /\b(?:B\.?\s?Tech|M\.?\s?Tech|B\.?\s?Sc|M\.?\s?Sc|B\.E\.|M\.S\.)/]],
];

/** Which fact tool answers a requirement, or null when it is for the matcher. */
export function classifyFact(text: string): Exclude<FactKind, 'other'> | null {
  for (const [kind, patterns] of FACT_PATTERNS) if (patterns.some((re) => re.test(text))) return kind;
  return null;
}

/** classifyFact, plus the extractor's own logistics and education categories. */
export function factKindOf(req: Pick<Requirement, 'text' | 'category'>): FactKind | null {
  return classifyFact(req.text) ?? (req.category === 'logistics' ? 'other' : req.category === 'education' ? 'education' : null);
}

export function isFactRequirement(req: Pick<Requirement, 'text' | 'category'>): boolean {
  return factKindOf(req) !== null;
}

export type FactRow = {
  requirement: string;
  kind: ReqKind;
  fact: FactKind;
  /** The site's own answer, or null: rendered 'Not stated on this site' with an 'Ask him' hand-off. */
  answer: string | null;
  lines: string[];
  sourceIds: string[];
};

export const NOT_STATED = 'Not stated on this site';

type Interval = [number, number];

function monthIndex(ym: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

function monthLabel(i: number): string {
  return formatYearMonth(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
}

/** The roles' date ranges merged where they overlap: 'Mar 2025 – present'. No month total. */
export function mergedRanges(exp: readonly FactExperience[], todayYM: string): string[] {
  const today = monthIndex(todayYM);
  const spans: Interval[] = [];
  for (const e of exp) {
    const from = e.start ? monthIndex(e.start) : null;
    const to = e.end ? monthIndex(e.end) : today;
    if (from !== null && to !== null && to >= from) spans.push([from, to]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged.map(([a, b]) => `${monthLabel(a)} – ${today !== null && b >= today ? 'present' : monthLabel(b)}`);
}

/** The deterministic row for a fact requirement. Years list each role and the merged ranges, never a total. */
export function factRow(req: Pick<Requirement, 'text' | 'kind' | 'category'>, profile: Pick<FitProfile, 'location' | 'availability' | 'experience' | 'education'>, todayYM: string): FactRow {
  const fact = factKindOf(req) ?? 'other';
  const base = { requirement: clip(req.text, AI_LIMITS.requirement), kind: req.kind, fact };
  if (fact === 'years') {
    const { rows } = experienceSpans(profile.experience, todayYM);
    const lines = rows.map((r, i) => {
      const e = profile.experience[i];
      const range = `${formatYearMonth(e.start)} – ${e.end ? formatYearMonth(e.end) : 'present'}`;
      return `${r.role}, ${r.company}: ${range}${r.label ? ` (${r.label})` : ''}`;
    });
    const ranges = mergedRanges(profile.experience, todayYM);
    if (ranges.length) lines.push(`Together the roles run ${ranges.join(', then ')}. They overlap, so the site states no total.`);
    return { ...base, answer: 'The roles listed on this site, with their dates:', lines, sourceIds: profile.experience.map((_, i) => `exp:${i}`) };
  }
  if (fact === 'education') {
    const lines = educationStatus(profile, todayYM).map((e) => `${e.degree}, ${e.institution}: ${e.label}`);
    return { ...base, answer: 'Education listed on this site:', lines, sourceIds: profile.education.map((_, i) => `edu:${i}`) };
  }
  if (fact === 'other') return { ...base, answer: null, lines: [], sourceIds: [] };
  const l = logistics(fact, profile);
  return { ...base, answer: l.answer, lines: [], sourceIds: l.sourceId ? [l.sourceId] : [] };
}

/** Fact rows found in a raw JD, one per kind, for the no-AI path. */
export function factRowsFromJd(jd: string, profile: Pick<FitProfile, 'location' | 'availability' | 'experience' | 'education'>, todayYM: string): FactRow[] {
  const seen = new Set<FactKind>();
  const out: FactRow[] = [];
  for (const seg of jdSegments(jd)) {
    const kind = classifyFact(seg);
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    out.push(factRow({ text: seg, kind: 'must' }, profile, todayYM));
    if (out.length >= 8) break;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Softeners: forbidden in the prompts and dropped by a post-check
 * ------------------------------------------------------------------------- */

/** Phrases that dress a gap up as a near-match. Named in prompts/fit.ts and prompts/brief.ts. */
export const SOFTENER_PHRASES: readonly string[] = [
  'could quickly learn',
  'can quickly pick up',
  'likely familiar with',
  'probably knows',
  'transferable skills',
  'should be able to',
  'quick learner',
];

const SOFTENER_RE =
  /\b(?:could|can|would|should|will)\s+(?:quickly|easily|readily|soon)\s+(?:learn|pick\s+up|adapt|ramp\s+up|master|get\s+up\s+to\s+speed)\b|\b(?:likely|probably|presumably|possibly|potentially)\s+(?:be\s+)?(?:familiar|knows?|has|have|comfortable|experienced|capable|proficient|able)\b|\bquick\s+learner\b|\btransferable\s+(?:skills?|experience)\b|\bshould\s+be\s+able\s+to\b|\bwould\s+(?:likely|probably)\b|\bis\s+likely\s+to\b|\beasily\s+(?:learn|pick\s+up|transfer)\b/i;

export function hasSoftener(text: string): boolean {
  return SOFTENER_RE.test(text);
}

// verify.tripwire checks digits only, so 'eighty-six percent' would pass unchecked.
// Small words ('one of', 'two roles') are left alone; tens, hundreds and 'percent' are not.
const SPELLED_NUMBER = /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen)s?\b|\bper\s?cent\b/i;

/** True when a claim spells out a number the digit tripwire cannot check. */
export function spellsNumber(text: string): boolean {
  return SPELLED_NUMBER.test(text);
}

/** Drops every sentence that softens a gap. Removing just the phrase could turn a hedge into a claim. */
export function stripSofteners(text: string): string {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim() && !hasSoftener(s))
    .join(' ')
    .trim();
}

/* ---------------------------------------------------------------------------
 * Extraction (POST /api/ai/jd-extract)
 * ------------------------------------------------------------------------- */

export type ExtractModelOut = {
  isJobDescription: boolean;
  language: string;
  title?: string;
  requirements: { text: string; kind: string; category: string; gloss?: string }[];
};

export const NOT_A_JD = "This doesn't look like a job description";

export type ExtractResponse =
  | { isJobDescription: true; language: string; title: string | null; requirements: Requirement[]; redacted: number }
  | { isJobDescription: false; message: typeof NOT_A_JD };

type Generate<T> = (text: string) => Promise<{ data?: T } | AiFallback>;

function isFallbackResult(x: unknown): x is AiFallback {
  return typeof x === 'object' && x !== null && (x as { mode?: unknown }).mode === 'fallback';
}

/**
 * The extraction route's body: cap, redact, one cheap-tier call, then clean the
 * reply. Only redacted text reaches `generate`. A reply saying the text is not a
 * job description ends here, so no match call can follow.
 */
export async function runExtract(jd: string, deps: { generate: Generate<ExtractModelOut> }): Promise<ExtractResponse | AiFallback> {
  const { text, removed } = redact(normalizeJd(jd));
  if (!text) return { mode: 'fallback', reason: 'bad-request' };
  const out = await deps.generate(text);
  if (isFallbackResult(out)) return out;
  const data = out.data;
  if (!data || typeof data.isJobDescription !== 'boolean') return { mode: 'fallback', reason: 'unverified' };
  if (!data.isJobDescription) return { isJobDescription: false, message: NOT_A_JD };
  const requirements = cleanRequirements(
    (Array.isArray(data.requirements) ? data.requirements : []).map((r) => ({
      text: r?.text,
      kind: r?.kind === 'nice' ? 'nice' : 'must',
      category: (REQ_CATEGORIES as readonly string[]).includes(r?.category) ? (r.category as ReqCategory) : 'other',
      gloss: r?.gloss,
    })),
  );
  if (!requirements.length) return { mode: 'fallback', reason: 'unverified' };
  const language = typeof data.language === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/i.test(data.language.trim()) ? data.language.trim().toLowerCase() : 'en';
  const english = language === 'en' || language.startsWith('en-');
  const title = typeof data.title === 'string' && data.title.trim() ? clip(data.title, AI_LIMITS.title) : null;
  return {
    isJobDescription: true,
    language,
    title,
    requirements: english ? requirements.map((r) => ({ text: r.text, kind: r.kind, ...(r.category ? { category: r.category } : {}) })) : requirements,
    redacted: removed,
  };
}

/**
 * What the fit sheet does after extraction: stop on a refusal (no match call),
 * pause for chip review, or match straight away when 'Skip review' is on.
 */
export function nextStage(res: ExtractResponse | AiFallback, skipReview: boolean): 'fallback' | 'refused' | 'review' | 'match' {
  if (isFallbackResult(res)) return 'fallback';
  if (!res.isJobDescription) return 'refused';
  return skipReview ? 'match' : 'review';
}

/* ---------------------------------------------------------------------------
 * Matching (POST /api/ai/jd-fit): verification and the band
 * ------------------------------------------------------------------------- */

export type ModelFitRow = { index: number; status: string; evidence: { id: string; quote: string }[]; synonym?: string };

const STOPWORDS = new Set(
  'about above ability able across also and any applied are background based basic building candidate candidates closely comfortable concepts deep demonstrated design develop developing development ensure environment excellent experience experienced exposure expertise familiarity familiar field good great hands hands-on have highly ideal ideally including into knowledge least like looking must nice other plus preferred proficiency proficient proven qualifications related relevant required requirements responsibilities role should skills solid some strong such team teams their them these this through tools understanding using various well will with within work working years'.split(
    ' ',
  ),
);

/** What an 'evidenced' quote must name: the site terms the requirement names, else its content words. */
export function requirementTerms(text: string, vocab: readonly VocabTerm[]): { exact: string[]; words: string[] } {
  const exact = vocab.filter((v) => mentions([text], v.term)).map((v) => v.term);
  if (exact.length) return { exact, words: [] };
  const words = [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .map((w) => w.replace(/\.+$/, ''))
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
        .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
    ),
  ];
  return { exact, words };
}

function quoteNames(quote: string, terms: { exact: string[]; words: string[] }, synonym?: string): boolean {
  if (terms.exact.some((t) => mentions([quote], t))) return true;
  if (synonym && namesVerbatim(quote, synonym)) return true;
  const q = quote.toLowerCase();
  return terms.words.some((w) => q.includes(w));
}

/**
 * 'ok' for an exact site term the requirement does not already name; 'direct'
 * when the requirement names it itself (no mapping to show); 'rejected' for
 * anything else, including a case-only collision such as 'React' -> 'ReAct'.
 */
export function checkSynonym(requirement: string, synonym: string | undefined, vocab: readonly VocabTerm[]): 'ok' | 'direct' | 'rejected' {
  const s = typeof synonym === 'string' ? synonym.trim() : '';
  if (!s || s.length > 60) return 'rejected';
  const known = vocab.find((v) => v.term === s || techFamily(v.term) === s);
  if (!known) return 'rejected';
  const loose = new RegExp(`${EDGE_BEFORE}${escapeRegExp(s)}${EDGE_AFTER}`, 'gi');
  for (const m of requirement.matchAll(loose)) if (m[0] !== s) return 'rejected';
  // A JD term that differs from the synonym only by case (e.g. 'React' vs 'ReAct') is a different thing.
  const lower = s.toLowerCase();
  if (vocab.some((v) => v.term !== s && v.term.toLowerCase() === lower && namesVerbatim(requirement, v.term))) return 'rejected';
  return namesVerbatim(requirement, s) ? 'direct' : 'ok';
}

export type VerifyFitResult = { rows: FitRow[]; dropped: number; discarded: boolean };

// Words a requirement may put around a site term and still ask for only that term:
// 'Python programming', 'RAG pipelines', 'LangGraph agents'.
const TERM_FILLER = new Set(
  'a an as at be by e.g eg etc for from i.e ie in is it of on or our the to we you agent api apis application framework language library libraries model pipeline platform programming coding scripting service solution stack system tool tooling ecosystem similar equivalent'.split(
    ' ',
  ),
);

/** Lower-case words, each with its singular; bare numbers and versions ('3.10', '10+') are dropped. */
function coverWords(text: string): string[][] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w && !/^[\d.]+\+?$/.test(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? [w, w.slice(0, -1)] : [w]));
}

/**
 * True when a requirement asks for nothing beyond the site terms it names:
 * 'Python', 'Strong Python skills', 'Python and SQL', 'RAG pipelines'. 'Prior
 * employment at OpenAI doing RLHF' and 'TensorFlow Developer Certificate' name a
 * site term inside a larger ask, so an exact keyword alone cannot evidence them.
 */
export function onlySiteTerms(text: string, vocab: readonly VocabTerm[]): boolean {
  const { exact } = requirementTerms(text, vocab);
  if (!exact.length) return false;
  const covered = new Set(exact.flatMap((t) => [...coverWords(t), ...coverWords(techFamily(t))].flat()));
  return coverWords(text).every((forms) => forms.some((w) => covered.has(w) || STOPWORDS.has(w) || TERM_FILLER.has(w)));
}

// A credential ('TensorFlow Developer Certificate', 'AWS Certified ...', 'licensed').
const CREDENTIAL = /\bcertif\w*|\blicen[cs](?:e|ed)\b|\baccredit\w*/i;

/**
 * Why a requirement cannot be evidenced or adjacent whatever the evidence says, or
 * null: it asks for an employer, school or venue the profile doesn't list, or for a
 * credential while no certification is listed (or none of the cited text mentions one).
 */
export function requirementCap(req: Pick<Requirement, 'text' | 'gloss'>, evidenceTexts: readonly string[], entities: ClaimEntities): string | null {
  const texts = [req.text, req.gloss ?? ''].filter(Boolean);
  for (const t of texts) {
    const org = unlistedAffiliation(t, entities);
    if (org) return `affiliation:${org}`;
  }
  if (texts.some((t) => CREDENTIAL.test(t))) {
    const listed = (entities.certifications ?? []).length > 0;
    if (!listed || !evidenceTexts.some((t) => CREDENTIAL.test(t))) return 'credential';
  }
  return null;
}

/**
 * Keeps the model's rows whose every evidence id is a known fact with a verbatim
 * quote (verifyClaims), downgrades an 'evidenced' row whose quotes name neither
 * the requirement's term nor a displayed synonym to 'adjacent', and fills a
 * requirement from the keyword pass: 'evidenced' when the model skipped it, lost it
 * to verification, or called it 'not-listed' and the requirement is nothing but site
 * terms; 'adjacent' when the model skipped or lost a requirement that asks for more
 * than the term it names. A model's 'not-listed' on a larger ask stands. Last, a
 * requirement for an unlisted employer, school, venue or credential is capped at
 * 'not-listed', keeping one piece of evidence as the closest thing on the site.
 * More than 30% dropped discards the answer.
 */
export function verifyFitRows(opts: {
  rows: readonly ModelFitRow[];
  requirements: readonly Requirement[];
  facts: FactSource;
  entities: ClaimEntities;
  vocab: readonly VocabTerm[];
  /** Keyword evidence for a requirement, from the lexical pass. */
  lexical?: (req: Requirement) => FitEvidence[];
  maxDrop?: number;
}): VerifyFitResult {
  const { requirements, vocab } = opts;
  const byIndex = new Map<number, FitRow>();
  let dropped = 0;
  const total = opts.rows.length;

  for (const raw of opts.rows) {
    const index = raw?.index;
    const req = typeof index === 'number' && Number.isInteger(index) ? requirements[index] : undefined;
    const status = raw?.status;
    if (!req || byIndex.has(index) || (status !== 'evidenced' && status !== 'adjacent' && status !== 'not-listed')) {
      dropped += 1;
      continue;
    }
    const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
      .filter((e) => e && typeof e.id === 'string' && typeof e.quote === 'string')
      .slice(0, 3)
      .map((e) => ({ id: resolveId(e.id, opts.facts), quote: e.quote }));
    if (evidence.length === 0) {
      if (status !== 'not-listed') {
        dropped += 1;
        continue;
      }
      byIndex.set(index, { requirement: req.text, kind: req.kind, status, evidence: [], source: 'ai' });
      continue;
    }
    const verdict = checkSynonym(req.text, raw.synonym, vocab);
    const synonym = verdict === 'ok' ? raw.synonym!.trim() : undefined;
    const check = verifyClaims([{ text: synonym ?? '', evidence }], opts.facts, opts.entities, 1);
    if (check.kept.length === 0) {
      dropped += 1;
      continue;
    }
    let finalStatus: FitStatus = status;
    if (status === 'evidenced') {
      const terms = requirementTerms(req.text, vocab);
      if (!evidence.some((e) => quoteNames(e.quote, terms, synonym))) finalStatus = 'adjacent';
    }
    const row: FitRow = { requirement: req.text, kind: req.kind, status: finalStatus, evidence: evidence.map((e) => ({ id: e.id, quote: e.quote.trim() })), source: 'ai' };
    if (synonym) row.synonym = synonym;
    byIndex.set(index, row);
  }

  const factText = (id: string): string => {
    const f = opts.facts instanceof Map ? opts.facts.get(id) : (opts.facts as Readonly<Record<string, string>>)[id];
    return typeof f === 'string' ? f : '';
  };
  const rows: FitRow[] = [];
  requirements.forEach((req, i) => {
    const model = byIndex.get(i);
    const lexical = opts.lexical?.(req) ?? [];
    let row: FitRow;
    const whole = lexical.length > 0 && onlySiteTerms(req.text, vocab);
    if (lexical.length && (!model || (model.status === 'not-listed' && whole))) {
      row = { requirement: req.text, kind: req.kind, status: whole ? 'evidenced' : 'adjacent', evidence: lexical.slice(0, 3), source: 'lexical' };
    } else if (model) row = model;
    else row = { requirement: req.text, kind: req.kind, status: 'not-listed', evidence: [], source: 'lexical' };
    if (row.status !== 'not-listed' && requirementCap(req, row.evidence.map((e) => factText(e.id)), opts.entities)) {
      row = { requirement: row.requirement, kind: row.kind, status: 'not-listed', evidence: row.evidence.slice(0, 1), source: row.source };
    }
    rows.push(row);
  });
  const maxDrop = opts.maxDrop ?? 0.3;
  return { rows, dropped, discarded: total > 0 && dropped / total > maxDrop };
}

/** Keyword evidence for one requirement: the site terms it names, their evidence. */
export function lexicalEvidenceFor(req: Pick<Requirement, 'text'>, data: FitData, vocab: readonly VocabTerm[] = vocabulary(data)): FitEvidence[] {
  const out: FitEvidence[] = [];
  for (const v of vocab) {
    if (!mentions([req.text], v.term)) continue;
    for (const e of termEvidence(v.term, v.category, data)) if (!out.some((x) => x.id === e.id)) out.push(e);
  }
  return out;
}

export type Band = 'Strong' | 'Partial' | 'Limited';
export type FitCounts = { evidenced: number; adjacent: number; notListed: number };

export function countRows(rows: readonly Pick<FitRow, 'status'>[]): FitCounts {
  const c: FitCounts = { evidenced: 0, adjacent: 0, notListed: 0 };
  for (const r of rows) {
    if (r.status === 'evidenced') c.evidenced += 1;
    else if (r.status === 'adjacent') c.adjacent += 1;
    else c.notListed += 1;
  }
  return c;
}

/**
 * The overall band from row counts alone. Must-haves weigh 2, nice-to-haves 1;
 * evidenced scores 1, adjacent 0.5, not listed 0. Strong needs 75% and no
 * must-have missing; Partial needs 40%. There is deliberately no percentage.
 */
export function computeBand(rows: readonly Pick<FitRow, 'kind' | 'status'>[]): { band: Band; counts: FitCounts } | null {
  if (!rows.length) return null;
  let got = 0;
  let max = 0;
  let mustMissing = 0;
  for (const r of rows) {
    const w = r.kind === 'must' ? 2 : 1;
    max += w;
    got += w * (r.status === 'evidenced' ? 1 : r.status === 'adjacent' ? 0.5 : 0);
    if (r.kind === 'must' && r.status === 'not-listed') mustMissing += 1;
  }
  const ratio = got / max;
  const band: Band = ratio >= 0.75 && mustMissing === 0 ? 'Strong' : ratio >= 0.4 ? 'Partial' : 'Limited';
  return { band, counts: countRows(rows) };
}

/** '6 evidenced, 2 adjacent, 3 not listed'. */
export function summaryText(c: FitCounts): string {
  return `${c.evidenced} evidenced, ${c.adjacent} adjacent, ${c.notListed} not listed`;
}

/** Ids a response may cite, checked against the site's own structure (a second line of defence on the client). */
export function plausibleId(id: string, data: FitData): boolean {
  if (typeof id !== 'string') return false;
  if (id === 'profile:about' || id === 'profile:availability' || id === 'copy:roles' || id === 'copy:hero' || id === 'copy:contact') return true;
  let m = /^exp:(\d+)(?:#([hm])(\d+))?$/.exec(id);
  if (m) {
    const e = data.profile.experience[Number(m[1])];
    if (!e) return false;
    if (!m[2]) return true;
    const list = m[2] === 'h' ? e.highlights : e.metrics;
    return Number(m[3]) < (list?.length ?? 0);
  }
  m = /^edu:(\d+)$/.exec(id);
  if (m) return Number(m[1]) < data.profile.education.length;
  m = /^skills:([a-z0-9-]+)$/.exec(id);
  if (m) return Object.keys(data.profile.skills).some((c) => slugify(c) === m![1]);
  m = /^(?:project:([a-z0-9-]+)#(?:tagline|summary|full|problem|solution|lessons|stack)|facts:([a-z0-9-]+))$/.exec(id);
  if (m) return data.projects.some((p) => p.slug === (m![1] ?? m![2]));
  return /^(?:reading|tool):\d+$|^copy:philosophy#\d+$/.test(id);
}

/* ---------------------------------------------------------------------------
 * Response shapes
 * ------------------------------------------------------------------------- */

/**
 * The byte cap for the JD routes' bodies: an 8,000-character JD in a script that
 * needs three UTF-8 bytes a character, plus twelve requirements, plus JSON.
 */
export const JD_BODY_BYTES = 40_000;

/** Evidence with the chunk's own label and a target the action runner accepts. */
export function withLabels(
  evidence: readonly { id: string; quote: string }[],
  byId: ReadonlyMap<string, Pick<Chunk, 'label' | 'target'>>,
  known: KnownTargets,
): FitEvidence[] {
  return evidence.map((e) => {
    const chunk = byId.get(e.id);
    const target = chunk ? validTarget(chunk.target, known) : null;
    return { id: e.id, quote: e.quote, ...(chunk ? { label: chunk.label } : {}), ...(target ? { target } : {}) };
  });
}

export type TopProject = { slug: string; quote: string | null; id: string | null; overlap?: string[] };

export type FitResponse = {
  rows: FitRow[];
  projects: TopProject[];
  rankedBy: 'embedding' | 'lexical';
  dropped: number;
  model: string | null;
};

/** Drops rows citing ids the site cannot have; more than 30% dropped reads as unverified. */
export function checkFitResponse(res: FitResponse, data: FitData): { res: FitResponse; discarded: boolean } {
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  const kept = rows.filter((r) => r && Array.isArray(r.evidence) && r.evidence.every((e) => plausibleId(e.id, data)));
  const dropped = rows.length - kept.length;
  const projects = (Array.isArray(res?.projects) ? res.projects : []).filter((p) => data.projects.some((x) => x.slug === p?.slug)).slice(0, 3);
  return { res: { ...res, rows: kept, projects, dropped: (res?.dropped ?? 0) + dropped }, discarded: rows.length > 0 && dropped / rows.length > 0.3 };
}

/* ---------------------------------------------------------------------------
 * Top projects and the skills matrix
 * ------------------------------------------------------------------------- */

/** Projects by how many of their tech families the JD names, then featured, then site order. */
export function rankProjectsByOverlap(jd: string, projects: readonly FitProject[]): { slug: string; overlap: string[] }[] {
  const segments = jdSegments(jd);
  return projects
    .map((p, order) => {
      const overlap = [...new Set(p.techStack.map(techFamily))].filter((f) => mentions(segments, f));
      return { slug: p.slug, overlap, order, featured: p.featured ? 1 : 0 };
    })
    .filter((r) => r.overlap.length > 0)
    .sort((a, b) => b.overlap.length - a.overlap.length || b.featured - a.featured || a.order - b.order)
    .map(({ slug, overlap }) => ({ slug, overlap }));
}

export type MatrixRow = {
  /** The JD's wording: the term itself, or the requirement a synonym came from. */
  jdTerm: string;
  siteTerm: string;
  category: string | null;
  projects: string[];
  roles: number[];
  mappedByAi: boolean;
};

/** Exact matches first, then AI synonyms that pass checkSynonym. Counts come from projectsForSkill, never the model. */
export function buildMatrix(hits: readonly LexicalHit[], rows: readonly FitRow[], data: FitData, vocab: readonly VocabTerm[] = vocabulary(data)): MatrixRow[] {
  const out: MatrixRow[] = hits.map((h) => ({ jdTerm: h.term, siteTerm: h.term, category: h.category, projects: h.projects, roles: h.roles, mappedByAi: false }));
  const seen = new Set(out.map((r) => r.siteTerm));
  for (const r of rows) {
    if (!r.synonym || seen.has(r.synonym) || checkSynonym(r.requirement, r.synonym, vocab) !== 'ok') continue;
    const v = vocab.find((x) => x.term === r.synonym || techFamily(x.term) === r.synonym);
    seen.add(r.synonym);
    out.push({
      jdTerm: clip(r.requirement, 80),
      siteTerm: r.synonym,
      category: v?.category ?? null,
      projects: projectsForSkill(data.projects, r.synonym).map((p) => p.slug),
      roles: rolesNaming(data.profile, r.synonym).map((x) => x.index),
      mappedByAi: true,
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * The assembled result, hand-offs and exports
 * ------------------------------------------------------------------------- */

export type FitView = {
  mode: 'ai' | 'lexical';
  role: string | null;
  rows: readonly FitRow[];
  facts: readonly FactRow[];
  lexical: readonly LexicalHit[];
  projects: readonly { slug: string; name: string; quote: string | null }[];
  band: { band: Band; counts: FitCounts } | null;
};

export type SiteLinks = { url: string; cvUrl: string; builtAt: string | null };

/** The strongest evidenced matches: must-haves with the most evidence first, topped up from exact keyword matches. */
export function strongestMatches(view: FitView, n: number): { label: string; evidence: string | null }[] {
  const ai = view.rows
    .filter((r) => r.status === 'evidenced')
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.kind === b.r.kind ? 0 : a.r.kind === 'must' ? -1 : 1) || b.r.evidence.length - a.r.evidence.length || a.i - b.i)
    .map(({ r }) => ({ label: r.requirement, evidence: r.evidence[0]?.label ?? null }));
  const out = ai.slice(0, n);
  for (const h of view.lexical) {
    if (out.length >= n) break;
    if (out.some((m) => m.label === h.term)) continue;
    out.push({ label: h.term, evidence: h.evidence[0]?.label ?? null });
  }
  return out;
}

/** The requirements the check found nothing for, exactly as the rows show them. */
export function gapRows(view: FitView): string[] {
  return view.rows.filter((r) => r.status === 'not-listed').map((r) => r.requirement);
}

export const PREFILL_MAX = 2000;

function subjectFor(role: string | null): string {
  return role ? `Portfolio inquiry: ${clip(role, AI_LIMITS.title)}` : 'Portfolio inquiry';
}

type LineList = { header: string[]; items: string[] };

/** Joins the parts, dropping items from the end of the longest list (never a header) until the text fits. */
function fitLines(head: readonly string[], lists: LineList[], tail: readonly string[], max: number): string {
  const build = () => [...head, ...lists.flatMap((l) => (l.items.length ? [...l.header, ...l.items] : [])), ...tail].join('\n');
  let text = build();
  while (text.length > max) {
    const longest = lists.reduce<LineList | null>((a, b) => (!a || b.items.length > a.items.length ? b : a), null);
    if (!longest || longest.items.length <= 1) break;
    longest.items.pop();
    text = build();
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 'Reach out about this role': the subject, the top 3 evidenced matches and the gaps, at most 2000 characters. */
export function reachOutPrefill(view: FitView): { subject: string; message: string } {
  const matches = strongestMatches(view, 3).map((m) => `- ${m.label}${m.evidence ? ` (see ${m.evidence})` : ''}`);
  const gaps = gapRows(view).map((g) => `- ${g}`);
  const head = ['Hi Oikantik,', '', `I'm hiring for ${view.role ? `a ${clip(view.role, AI_LIMITS.title)} role` : 'a role'} and ran the fit check on your site.`];
  const lists: LineList[] = [
    { header: ['', 'What it matched on your site:'], items: matches },
    { header: ['', 'Not listed on the site, so I would like to ask about:'], items: gaps },
  ];
  return { subject: subjectFor(view.role), message: fitLines(head, lists, ['', 'Could we talk?'], PREFILL_MAX) };
}

/** 'Ask Oikantik about these gaps': exactly the not-listed rows. Null when there are none. */
export function gapPrefill(view: FitView): { subject: string; message: string } | null {
  const gaps = gapRows(view);
  if (!gaps.length) return null;
  const head = ["Hi Oikantik, the fit check on your site didn't find these, so I'd like to ask about them:"];
  return { subject: subjectFor(view.role), message: fitLines(head, [{ header: [], items: gaps.map((g) => `- ${g}`) }], [], PREFILL_MAX) };
}

/** 'Ask him' for a logistics row the site doesn't answer. */
export function askAboutFact(row: Pick<FactRow, 'requirement'>, role: string | null): { subject: string; message: string } {
  return { subject: subjectFor(role), message: `Hi Oikantik, your site doesn't say, so I'd like to ask: ${clip(row.requirement, AI_LIMITS.requirement)}` };
}

export const BLURB_SHORT_MAX = 280;

/** 'Copy blurb for your team': a short (at most 280 characters) and a full version, from the data and the strongest matches. */
export function teamBlurbs(view: FitView, profile: Pick<FitProfile, 'name' | 'headline' | 'location' | 'availability'>, site: SiteLinks): { short: string; full: string } {
  const title = profile.headline.split('|')[0].trim();
  const top = strongestMatches(view, 2).map((m) => m.label);
  const links = `${site.url} · CV ${site.cvUrl}`;
  const shortOf = (matches: string[]) =>
    `${profile.name}, ${title} (${profile.availability.status}). Focus: ${profile.availability.focus}.${matches.length ? ` Matches: ${matches.join('; ')}.` : ''} ${links}`;
  let short = shortOf(top.map((m) => clip(m, 60)));
  if (short.length > BLURB_SHORT_MAX) short = shortOf(top.slice(0, 1).map((m) => clip(m, 40)));
  if (short.length > BLURB_SHORT_MAX) short = shortOf([]);
  if (short.length > BLURB_SHORT_MAX) short = clip(short, BLURB_SHORT_MAX);
  const full = [
    `${profile.name}: ${title}, based in ${profile.location}.`,
    `Availability: ${profile.availability.status}. Open to: ${profile.availability.openTo}.`,
    `Focus: ${profile.availability.focus}.`,
    ...(top.length ? [`Strongest matches for this role: ${top.join('; ')}.`] : []),
    `Portfolio: ${site.url}`,
    `CV: ${site.cvUrl}`,
    view.mode === 'ai' ? 'Matches come from an AI-assisted check of his site (it may be wrong).' : 'Matches come from exact keyword matching on his site.',
  ].join('\n');
  return { short, full };
}

/** The ?tech value for 'Show matches on the page': a family name the projects grid knows. */
export function filterTechFor(view: FitView, data: FitData): string | null {
  const terms = [...view.lexical.map((h) => h.term), ...view.rows.flatMap((r) => (r.synonym ? [r.synonym] : []))];
  let best: { family: string; n: number } | null = null;
  for (const term of terms) {
    const projects = projectsForSkill(data.projects, term);
    if (!projects.length) continue;
    const entry = projects[0].techStack.find((s) => matchesTech([s], term));
    const family = entry ? techFamily(entry) : techFamily(term);
    if (!best || projects.length > best.n) best = { family, n: projects.length };
  }
  return best?.family ?? null;
}

/** The listed skill to focus in the Skills section: the strongest exact match with a category. */
export function focusSkillFor(view: FitView): string | null {
  return view.lexical.find((h) => h.category)?.term ?? view.rows.find((r) => r.synonym)?.synonym ?? null;
}

const STATUS_LABEL: Record<FitStatus, string> = { evidenced: 'Evidenced', adjacent: 'Adjacent', 'not-listed': 'Not listed on this site' };

/** The status as a copied report states it. The table's keyword hint does not survive a copy, so the label carries it. */
export function statusLabel(r: Pick<FitRow, 'status' | 'source'>): string {
  if (r.source === 'lexical' && r.status === 'evidenced') return 'Evidenced (exact keyword match)';
  if (r.source === 'lexical' && r.status === 'adjacent') return 'Adjacent (keyword match, not the whole requirement)';
  return STATUS_LABEL[r.status];
}

/** A not-listed row's evidence is the closest thing on the site, never a match. */
function evidenceLead(r: Pick<FitRow, 'status'>): string {
  return r.status === 'not-listed' ? 'closest on the site: ' : '';
}

function factAnswer(f: FactRow): string {
  return f.answer === null ? NOT_STATED : [f.answer, ...f.lines].join(' ');
}

function disclosure(view: FitView): string {
  return view.mode === 'ai'
    ? 'AI-generated · may be wrong. Every match cites text on the site.'
    : 'Exact keyword matches only (no AI-generated text) · may be incomplete.';
}

/** 'Copy report': plain text, with the disclosure, the site URL, /cv and the data date. */
export function reportText(view: FitView, site: SiteLinks): string {
  const lines: string[] = [`Fit check: Oikantik Basu${view.role ? ` for ${view.role}` : ''}`, disclosure(view)];
  if (view.band) lines.push(`Overall: ${view.band.band} (${summaryText(view.band.counts)})`);
  if (view.rows.length) {
    lines.push('', 'Requirements');
    for (const r of view.rows) {
      const ev = r.evidence.map((e) => `"${e.quote}" (${e.label ?? e.id})`).join('; ');
      lines.push(`- [${r.kind === 'must' ? 'Must' : 'Nice'}] ${r.requirement}: ${statusLabel(r)}${r.synonym ? ` (mapped by AI to ${r.synonym})` : ''}${ev ? ` — ${evidenceLead(r)}${ev}` : ''}`);
    }
  }
  if (view.facts.length) {
    lines.push('', 'From the site’s facts');
    for (const f of view.facts) lines.push(`- ${f.requirement}: ${factAnswer(f)}`);
  }
  if (view.lexical.length) {
    lines.push('', 'Exact keyword matches (no AI)');
    for (const h of view.lexical) lines.push(`- ${h.term}${h.category ? ` · ${h.category}` : ''} · ${h.projects.length} project${h.projects.length === 1 ? '' : 's'}${h.roles.length ? ` · ${h.roles.length} role${h.roles.length === 1 ? '' : 's'}` : ''}`);
  }
  if (view.projects.length) {
    lines.push('', 'Top projects for this JD');
    for (const p of view.projects) lines.push(`- ${p.name}${p.quote ? `: "${p.quote}"` : ''}`);
  }
  lines.push('', `Site: ${site.url}`, `CV: ${site.cvUrl}`, `Checked against site data built ${site.builtAt ?? 'recently'}.`);
  return lines.join('\n');
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** 'Copy as Markdown' for ATS notes: the same content as reportText, with a table. */
export function reportMarkdown(view: FitView, site: SiteLinks): string {
  const out: string[] = [`## Fit check: Oikantik Basu${view.role ? ` for ${cell(view.role)}` : ''}`, '', `_${disclosure(view)}_`];
  if (view.band) out.push('', `**Overall: ${view.band.band}** (${summaryText(view.band.counts)})`);
  if (view.rows.length) {
    out.push('', '| Requirement | Must/Nice | Status | Evidence on the site |', '| --- | --- | --- | --- |');
    for (const r of view.rows) {
      const listed = r.evidence.map((e) => `“${cell(e.quote)}” (${cell(e.label ?? e.id)})`).join('; ');
      const ev = listed ? `${evidenceLead(r)}${listed}` : '—';
      out.push(`| ${cell(r.requirement)} | ${r.kind === 'must' ? 'Must' : 'Nice'} | ${statusLabel(r)}${r.synonym ? ` (mapped by AI: ${cell(r.synonym)})` : ''} | ${ev} |`);
    }
  }
  if (view.facts.length) {
    out.push('', '**From the site’s facts**');
    for (const f of view.facts) out.push(`- ${cell(f.requirement)}: ${cell(factAnswer(f))}`);
  }
  if (view.lexical.length) {
    out.push('', '**Exact keyword matches (no AI)**', '', '| Term | Category | Projects | Roles |', '| --- | --- | --- | --- |');
    for (const h of view.lexical) out.push(`| ${cell(h.term)} | ${cell(h.category ?? 'Project stack')} | ${h.projects.length} | ${h.roles.length} |`);
  }
  if (view.projects.length) {
    out.push('', '**Top projects for this JD**');
    for (const p of view.projects) out.push(`- ${cell(p.name)}${p.quote ? `: “${cell(p.quote)}”` : ''}`);
  }
  out.push('', `Site: ${site.url} · CV: ${site.cvUrl}`, '', `Checked against site data built ${site.builtAt ?? 'recently'}.`);
  return out.join('\n');
}

/* ---------------------------------------------------------------------------
 * Screening questions (POST /api/ai/jd-questions)
 * ------------------------------------------------------------------------- */

export type Question = { question: string; id: string };

export const QUESTIONS_MAX = 5;

export type QuestionsResponse = { questions: (Question & { label: string })[] };

/**
 * The server check: each question is tied to one sent id, has no softener, and
 * its premise passes the number/employer/degree tripwire against that chunk.
 */
export function verifyQuestions(qs: readonly Question[], sent: ReadonlyMap<string, string>, entities: ClaimEntities): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  for (const q of qs ?? []) {
    const text = typeof q?.question === 'string' ? clip(stripMarkup(q.question), 300) : '';
    const id = typeof q?.id === 'string' ? resolveId(q.id, sent) : '';
    const fact = id ? sent.get(id) : undefined;
    if (text.length < 10 || !fact || hasSoftener(text) || spellsNumber(text) || seen.has(text.toLowerCase())) continue;
    if (tripwire(text, [fact], entities) !== null) continue;
    seen.add(text.toLowerCase());
    out.push({ question: text, id });
    if (out.length >= QUESTIONS_MAX) break;
  }
  return out;
}

/** The client's cheaper re-check: the id was sent and every number appears in what was sent for it. */
export function clientCheckQuestions<Q extends Question>(qs: readonly Q[], sent: ReadonlyMap<string, string>): Q[] {
  return (qs ?? [])
    .filter((q) => {
      const known = typeof q?.id === 'string' ? sent.get(q.id) : undefined;
      if (!known || typeof q.question !== 'string' || !q.question.trim()) return false;
      const have = new Set(numbersIn(known));
      return numbersIn(q.question).every((n) => have.has(n));
    })
    .slice(0, QUESTIONS_MAX);
}

/* ---------------------------------------------------------------------------
 * Role lenses (precomputed, review-gated) and the custom brief
 * ------------------------------------------------------------------------- */

export const LENS_IDS = ['llm-agents', 'data-science', 'freelance'] as const;
export type LensId = (typeof LENS_IDS)[number];
export const LENS_AUDIENCES = ['plain', 'manager', 'engineer'] as const;
export type LensAudience = (typeof LENS_AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<LensAudience, string> = { plain: 'Plain', manager: 'Hiring manager', engineer: 'Engineer' };

export type LensDef = {
  id: LensId;
  label: string;
  /** Skill categories the lens stands on. */
  categories: readonly string[];
  /** The role it stands on, matched by company. */
  company: RegExp;
  /** Whether availability (focus, openTo) is part of it. */
  availability: boolean;
};

/** Only lenses the data backs: each names the skills and the role that support it. */
export const LENSES: readonly LensDef[] = [
  { id: 'llm-agents', label: 'LLM agents & RAG', categories: ['GenAI & LLMs', 'Agentic AI'], company: /iHUB/, availability: true },
  { id: 'data-science', label: 'Data science & analytics', categories: ['Data Science & ML', 'Analytics & Viz'], company: /Unified Mentor/, availability: false },
  { id: 'freelance', label: 'Freelance & contract', categories: [], company: /Mindrift/, availability: true },
];

export function lensParam(value: string | null | undefined): LensId | null {
  return typeof value === 'string' && (LENS_IDS as readonly string[]).includes(value) ? (value as LensId) : null;
}

export const lensKey = (id: LensId) => `lens:${id}`;

/** The chunk ids a lens may cite: availability, its skill lists, and its role with highlights and metrics. */
export function lensSources(lens: LensDef, data: FitData): string[] {
  const ids: string[] = [];
  if (lens.availability) ids.push('profile:availability');
  for (const c of lens.categories) if (data.profile.skills[c]) ids.push(`skills:${slugify(c)}`);
  data.profile.experience.forEach((e, i) => {
    if (!lens.company.test(e.company)) return;
    ids.push(`exp:${i}`);
    (e.highlights ?? []).forEach((_, j) => ids.push(`exp:${i}#h${j}`));
    (e.metrics ?? []).forEach((_, j) => ids.push(`exp:${i}#m${j}`));
  });
  return ids;
}

/** The lens's top 3 projects, counted in code: stacks using its skills (or its role's named skills), featured first on ties. */
export function lensProjects(lens: LensDef, data: FitData): string[] {
  const skills = lens.categories.flatMap((c) => data.profile.skills[c] ?? []);
  if (!skills.length) {
    const role = data.profile.experience.find((e) => lens.company.test(e.company));
    const text = [role?.description ?? '', ...(role?.highlights ?? [])].join(' ');
    for (const s of Object.values(data.profile.skills).flat()) if (namesVerbatim(text, s)) skills.push(s);
  }
  return data.projects
    .map((p, order) => ({ slug: p.slug, n: skills.filter((s) => matchesTech(p.techStack, s)).length, featured: p.featured ? 1 : 0, order }))
    .sort((a, b) => b.n - a.n || b.featured - a.featured || a.order - b.order)
    .slice(0, 3)
    .map((p) => p.slug);
}

export type LensSentence = { text: string; cites: string[] };
export type LensValue = { id: LensId; label: string; versions: Record<LensAudience, LensSentence[]>; projects: string[] };
export type LensStore = { version: 1; entries: Record<string, StoreEntry<LensValue>> };

export function wordCount(sentences: readonly LensSentence[]): number {
  return sentences.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
}

function isLensValue(v: unknown): v is LensValue {
  const x = v as Partial<LensValue> | null;
  return (
    !!x &&
    typeof x === 'object' &&
    !!x.versions &&
    LENS_AUDIENCES.every((a) => Array.isArray(x.versions![a]) && x.versions![a].length > 0 && x.versions![a].every((s) => typeof s?.text === 'string' && Array.isArray(s.cites))) &&
    Array.isArray(x.projects)
  );
}

/** Lenses with an entry that may render: reviewed, or any draft where drafts are shown. Unknown shapes are skipped. */
export function visibleLenses(store: LensStore | null | undefined, showUnreviewed: boolean): { def: LensDef; entry: StoreEntry<LensValue> }[] {
  const out: { def: LensDef; entry: StoreEntry<LensValue> }[] = [];
  for (const def of LENSES) {
    const entry = store?.entries?.[lensKey(def.id)];
    if (entry && visible(entry, showUnreviewed) && isLensValue(entry.value)) out.push({ def, entry });
  }
  return out;
}

const LENS_HINTS: readonly (readonly [LensId, RegExp])[] = [
  ['freelance', /\b(?:freelanc\w*|contract\w*|consult\w*|part[- ]time|gig|temporary|project[- ]based)\b/i],
  ['data-science', /\b(?:data|analy\w*|scien\w*|statistic\w*|machine learning|ML|BI|insights?|forecast\w*|dashboards?|SQL)\b/i],
  ['llm-agents', /\b(?:LLM|GenAI|gen ai|generative|agent\w*|RAG|NLP|AI|prompt\w*|retrieval|chatbot)\b/i],
];

/** The preset lens closest to a free-text role title; LLM agents when nothing matches. */
export function nearestLens(title: string, available: readonly LensId[] = LENS_IDS): LensId | null {
  if (!available.length) return null;
  for (const [id, re] of LENS_HINTS) if (available.includes(id) && re.test(title)) return id;
  return available.includes('llm-agents') ? 'llm-agents' : available[0];
}

export type BriefClaim = { text: string; evidence: FitEvidence[] };
export type BriefModelOut = { claims: { text: string; evidence: { id: string; quote: string }[] }[]; projects: string[] };
export type BriefResponse = { claims: BriefClaim[]; projects: string[]; dropped: number; model: string | null };

/**
 * Only verified sentences survive: softened ones go first, then verifyClaims
 * (verbatim quotes, numbers, employers, degree status). Discarded when more than
 * 30% fail or nothing is left, and the client then shows the nearest preset lens.
 */
export function verifyBrief(out: BriefModelOut, facts: FactSource, entities: ClaimEntities, slugs: readonly string[]): { claims: BriefClaim[]; projects: string[]; dropped: number; discarded: boolean } {
  const claims = (Array.isArray(out?.claims) ? out.claims : [])
    .filter((c) => c && typeof c.text === 'string')
    .map((c) => ({
      text: stripMarkup(c.text),
      evidence: (Array.isArray(c.evidence) ? c.evidence.slice(0, 3) : []).map((e) => (e && typeof e.id === 'string' ? { ...e, id: resolveId(e.id, facts) } : e)),
    }));
  const unsoftened = claims.filter((c) => !hasSoftener(c.text) && !spellsNumber(c.text));
  const check = verifyClaims(unsoftened, facts, entities);
  const dropped = claims.length - check.kept.length;
  const discarded = claims.length === 0 || check.kept.length === 0 || dropped / claims.length > 0.3;
  const projects = [...new Set((Array.isArray(out?.projects) ? out.projects : []).filter((s) => slugs.includes(s)))].slice(0, 3);
  return { claims: check.kept.map((c) => ({ text: c.text, evidence: c.evidence.map((e) => ({ id: e.id, quote: e.quote })) })), projects, dropped, discarded };
}

/** A pitch built only from profile fields, for when no reviewed lens exists. Not AI-written. */
export function dataPitch(profile: Pick<FitProfile, 'name' | 'headline' | 'location' | 'availability' | 'experience' | 'education'>, todayYM: string): string[] {
  const title = profile.headline.split('|')[0].trim();
  const current = profile.experience.filter((e) => e.end === null).map((e) => `${e.role} (${e.company})`);
  const pending = educationStatus(profile, todayYM).filter((e) => !e.held);
  return [
    `${profile.name}: ${title}, based in ${profile.location}.`,
    `Status: ${profile.availability.status}. Focus: ${profile.availability.focus}. Open to: ${profile.availability.openTo}.`,
    ...(current.length ? [`Current: ${current.join('; ')}.`] : []),
    ...pending.map((e) => `${e.degree}: ${e.label}.`),
  ];
}
