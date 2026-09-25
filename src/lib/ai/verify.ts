/*
 * Claim checks shared by the streaming sentence filter, the structured routes
 * (jd-fit, jd-questions, brief) and every build-time generator. Each check is
 * phrased against what the data actually says about Oikantik: numbers must appear
 * in the cited evidence, employers and schools must be ones the profile lists,
 * nothing is 'certified' while certifications is empty, the in-progress Master's
 * is never described as held, and no sentence states a total of years of
 * experience (the listed roles overlap, so the site withholds that number).
 *
 * Pure: relative .ts imports only, no JSON, so node --test runs it directly.
 */

/** The parts of corpus entities() these checks read; fixtures can pass just these. */
export type ClaimEntities = {
  companies: readonly string[];
  institutions: readonly string[];
  /** Degree names whose status is still in progress. */
  inProgress?: readonly string[];
  certifications?: readonly unknown[];
  projectNames?: readonly string[];
  skills?: readonly string[];
  tech?: readonly string[];
};

const CITE_MARKER = /\[c:[^\]\n]*\]|\[c:[^\]\n]*$/g;

function stripMarkers(text: string): string {
  return text.replace(CITE_MARKER, ' ');
}

/* ---------------------------------------------------------------------------
 * Numbers
 * ------------------------------------------------------------------------- */

const ND = /\p{Nd}/u;
const digitCache = new Map<number, string>();

// Unicode lays every decimal-digit script out as runs of ten, zero first, so a
// digit's value is its offset from the start of its run (mod 10 for the
// back-to-back mathematical runs).
function digitValue(cp: number): string {
  const cached = digitCache.get(cp);
  if (cached) return cached;
  let start = cp;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start -= 1;
  const value = String((cp - start) % 10);
  digitCache.set(cp, value);
  return value;
}

/** Maps every Unicode decimal digit (\p{Nd}) to its ASCII digit: '৮৬%' -> '86%', '५' -> '5'. */
export function normalizeDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0)!;
    return cp >= 48 && cp <= 57 ? ch : digitValue(cp);
  });
}

function canonNumber(n: string): string {
  const v = Number(n);
  return Number.isFinite(v) && n.length < 16 ? String(v) : n;
}

/**
 * Numeric tokens after digit normalisation, citation markers ignored:
 * '86% and R² ≈ 0.999 over 1,470 rows' -> ['86', '0.999', '1470'].
 * Superscripts such as '²' are not decimal digits and are not counted.
 */
export function numbersIn(s: string): string[] {
  const text = normalizeDigits(stripMarkers(s));
  const out: string[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const raw = m[0];
    if (/^\d{1,3}(?:,\d{2,3})+$/.test(raw)) {
      out.push(raw.replace(/,/g, ''));
    } else if (raw.includes(',')) {
      out.push(...raw.split(','));
    } else {
      out.push(raw.replace(/\.$/, ''));
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Quotes
 * ------------------------------------------------------------------------- */

function normQuote(s: string): string {
  return normalizeDigits(s)
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `quote` appears in `fact` verbatim, modulo whitespace, typographic
 * quotes and dashes, and digit script. An empty quote never passes.
 */
export function quoteOk(quote: string, fact: string): boolean {
  if (typeof quote !== 'string' || typeof fact !== 'string') return false;
  const q = normQuote(quote);
  return q.length > 0 && normQuote(fact).includes(q);
}

/* ---------------------------------------------------------------------------
 * Organisations
 * ------------------------------------------------------------------------- */

const LEGAL_SUFFIX = /\s+(?:Private Limited|Pvt\.? Ltd\.?|Limited|Ltd\.?|Inc\.?|LLC|GmbH)$/i;

/** 'iHUB DivyaSampark @ IIT Roorkee' -> itself, 'iHUB DivyaSampark', 'IIT Roorkee'. */
export function orgAliases(name: string): string[] {
  const out = new Set<string>([name.trim()]);
  for (const part of name.split(/\s*(?:@|\(|\)|,|\s-\s|\s–\s)\s*/)) {
    const p = part.trim();
    if (p.length >= 3) out.add(p);
  }
  for (const a of [...out]) {
    const bare = a.replace(LEGAL_SUFFIX, '').trim();
    if (bare.length >= 3) out.add(bare);
  }
  return [...out];
}

function normOrg(s: string): string {
  return s
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/['’]s$/, '')
    .replace(/[^a-z0-9@&]+/g, ' ')
    .trim();
}

function containsWords(hay: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${hay} `.includes(` ${needle} `);
}

function orgMatches(candidate: string, known: readonly string[]): string | null {
  const c = normOrg(candidate);
  if (!c) return null;
  for (const name of known) {
    for (const alias of orgAliases(name)) {
      const a = normOrg(alias);
      if (a && (a === c || containsWords(c, a) || containsWords(a, c))) return alias;
    }
  }
  return null;
}

// Capitalised word runs, allowing the lower-case lead of names like 'iHUB'.
const ORG = String.raw`((?:the\s+)?(?:[A-Z]|[a-z][A-Z])[\w&.'’@-]*(?:\s+(?:@|&|of|[A-Z][\w&.'’@-]*))*)`;
const EMPLOYER_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:work(?:s|ed|ing)?|employed|intern(?:s|ed|ing|ship)?|job|role|position|specialist|engineer|scientist|researcher|developer|analyst|consultant|contractor|freelancer|staff|employee|tenure|stint|evaluat\w*|annotat\w*)\s+(?:at|for)\s+${ORG}`,
    'g',
  ),
  new RegExp(String.raw`\b(?:employed|hired|contracted|recruited)\s+by\s+${ORG}`, 'g'),
  new RegExp(String.raw`\b(?:employed|interned|contracted)\s+with\s+${ORG}`, 'g'),
  new RegExp(String.raw`\bjoin(?:s|ed)\s+${ORG}`, 'g'),
  new RegExp(String.raw`\b(?:an?|former|ex-)\s+${ORG}\s+(?:employee|engineer|intern|staffer|researcher|scientist)\b`, 'g'),
];
const SCHOOL_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:stud(?:y|ies|ied|ying)|graduated|graduate|degree|alumn(?:us|a|i)|enrolled|B\.?Tech|Master['’]?s)\s+(?:at|from)\s+${ORG}`, 'g'),
];

function candidates(claim: string, patterns: readonly RegExp[]): string[] {
  const out: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    for (const m of claim.matchAll(re)) {
      for (const part of m[1].split(/\s+and\s+/)) {
        const c = part.replace(/[\s.,;:@&-]+$/, '').replace(/\s+(?:of)$/, '').trim();
        if (c) out.push(c);
      }
    }
  }
  return out;
}

function isNonOrg(candidate: string, entities: ClaimEntities): boolean {
  const names = [...(entities.projectNames ?? []), ...(entities.skills ?? []), ...(entities.tech ?? [])];
  const c = normOrg(candidate);
  return names.some((n) => normOrg(n) === c);
}

/** An employer or school named in employment/study phrasing that the profile does not list or the evidence does not mention. */
function foreignOrg(claim: string, evidence: string, entities: ClaimEntities): string | null {
  const ev = ` ${normOrg(evidence)} `;
  const check = (list: readonly string[], patterns: readonly RegExp[]) => {
    for (const cand of candidates(claim, patterns)) {
      if (isNonOrg(cand, entities)) continue;
      const alias = orgMatches(cand, list);
      if (!alias || !ev.includes(` ${normOrg(alias)} `)) return cand;
    }
    return null;
  };
  return check(entities.companies, EMPLOYER_PATTERNS) ?? check(entities.institutions, SCHOOL_PATTERNS);
}

/* ---------------------------------------------------------------------------
 * Phrasing rules
 * ------------------------------------------------------------------------- */

const NEGATION = /\b(?:no|not|none|never|without|nor)\b|n['’]t\b/i;

// Any stated total of experience, in digits or words. The site withholds it.
const YEARS_OF_EXPERIENCE = new RegExp(
  [
    String.raw`\b(?:\d+(?:\.\d+)?\s*\+?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a few|few|several|many|multiple|over a|half a)[\s-]*(?:years?|yrs?)['’]?\s+(?:of\s+)?(?:[\w-]+\s+){0,2}experience\b`,
    String.raw`\bexperience\s+(?:of|spanning|over)\s+(?:\d+(?:\.\d+)?|a|one|two|three|four|five|several|many)\s*\+?\s*(?:years?|yrs?)\b`,
  ].join('|'),
  'i',
);

const MASTERS = /\bmaster['’]?s\b|\bmasters\b|\bMDS\b|\bpost-?graduate\b|\bM\.?Sc?\.?\s+(?:in|degree)\b/i;
const HELD = /\b(?:holds?|held|holding|has|have|had|earned|completed|finished|graduated|received|obtained|awarded|attained|possesses|with)\b|\bgraduate\b|\balumn/i;
const IN_PROGRESS =
  /\b(?:pursu\w*|in[- ]progress|ongoing|currently|enrolled|studying|expected|working\s+(?:on|toward|towards)|toward|towards|underway|will|until|through|candidate|student|midway|halfway)\b/i;

/*
 * Spelled-out numbers slip past the digit check ('forty users', 'twenty-five
 * agents'). A number word passes when its value is among the evidence's numbers or
 * the evidence uses the same word; a scale word ('thousands', 'dozens') only in the
 * second case. 'one' is left out (usually a pronoun), and so are 'double', 'twice'
 * and the like, which are as often verbs and adverbs as counts.
 */
const UNITS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORD = new RegExp(
  String.raw`\b(?:(${Object.keys(TENS).join('|')})(?:[- ](${Object.keys(UNITS).slice(0, 9).join('|')}))?|(${Object.keys(UNITS).slice(1).join('|')})|(hundreds?|thousands?|millions?|billions?|dozens?))\b`,
  'gi',
);

function spelledNumber(claim: string, ev: string, have: ReadonlySet<string>): string | null {
  const said = (word: string) => new RegExp(String.raw`\b${word}\b`, 'i').test(ev);
  for (const m of claim.matchAll(NUMBER_WORD)) {
    const word = m[0].toLowerCase();
    if (m[4]) {
      if (!said(m[4])) return `number-word:${word}`;
      continue;
    }
    const value = m[1] ? TENS[m[1].toLowerCase()] + (m[2] ? UNITS[m[2].toLowerCase()] : 0) : UNITS[m[3].toLowerCase()];
    if (!have.has(String(value)) && !said(word.replace(/[- ]/g, '[- ]'))) return `number-word:${word}`;
  }
  return null;
}

function mastersAsHeld(claim: string, entities: ClaimEntities): boolean {
  const pending = (entities.inProgress ?? []).some((d) => /master/i.test(d));
  return pending && MASTERS.test(claim) && HELD.test(claim) && !IN_PROGRESS.test(claim);
}

/**
 * The reason a claim fails against its evidence, or null when it passes.
 * - 'number:<n>': a number that is not in the evidence (after digit normalisation);
 * - 'years-of-experience': any stated total of experience;
 * - 'number-word:<w>': a spelled-out number the evidence gives neither as a numeral nor in words
 *   (skipped with numberWords: false, where counting what a picture shows is fine);
 * - 'certification': 'certif…' while no certification is listed;
 * - 'degree-held': the in-progress Master's phrased as held;
 * - 'employer:<org>' / school: an organisation not listed, or not in the evidence.
 */
export function tripwire(
  text: string,
  evidence: readonly string[],
  entities: ClaimEntities,
  opts: { numberWords?: boolean } = {},
): string | null {
  // A leading list marker ('1. ', '- ') is layout, not a number to check.
  const claim = normalizeDigits(stripMarkers(text))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:\d{1,2}[.)]|[-*•])\s+/, '');
  if (!claim) return null;
  const ev = evidence.join('\n');

  const have = new Set(numbersIn(ev).map(canonNumber));
  for (const n of numbersIn(claim)) {
    if (!have.has(canonNumber(n))) return `number:${n}`;
  }
  if (YEARS_OF_EXPERIENCE.test(claim)) return 'years-of-experience';
  const word = opts.numberWords === false ? null : spelledNumber(claim, ev, have);
  if (word) return word;
  if (/certif/i.test(claim) && !NEGATION.test(claim)) {
    const listed = entities.certifications ?? [];
    if (listed.length === 0 || !/certif/i.test(ev)) return 'certification';
  }
  if (mastersAsHeld(claim, entities)) return 'degree-held';
  const org = foreignOrg(claim, ev, entities);
  return org ? `employer:${org}` : null;
}

/* ---------------------------------------------------------------------------
 * Structured claims
 * ------------------------------------------------------------------------- */

export type Evidence = { id: string; quote: string };

function factOf(facts: ReadonlyMap<string, string> | Readonly<Record<string, string>>, id: string): string | undefined {
  if (facts instanceof Map) return facts.get(id);
  const rec = facts as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(rec, id) ? rec[id] : undefined;
}

/**
 * Keeps the claims whose every evidence quote appears verbatim in its fact and
 * whose text passes the tripwire against those facts. A claim without evidence
 * is dropped. `discarded` is true when more than `maxDrop` of the claims fail,
 * which callers treat as an unverified answer.
 */
export function verifyClaims<C extends { text: string; evidence: readonly Evidence[] }>(
  claims: readonly C[],
  facts: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  entities: ClaimEntities,
  maxDrop = 0.3,
): { kept: C[]; dropped: number; discarded: boolean } {
  const kept: C[] = [];
  for (const claim of claims) {
    const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
    if (!claim || typeof claim.text !== 'string' || evidence.length === 0) continue;
    const texts: string[] = [];
    let ok = true;
    for (const e of evidence) {
      const fact = e && typeof e.id === 'string' ? factOf(facts, e.id) : undefined;
      if (!fact || !quoteOk(e.quote, fact)) {
        ok = false;
        break;
      }
      texts.push(fact);
    }
    if (ok && tripwire(claim.text, texts, entities) === null) kept.push(claim);
  }
  const dropped = claims.length - kept.length;
  return { kept, dropped, discarded: claims.length > 0 && dropped / claims.length > maxDrop };
}

/* ---------------------------------------------------------------------------
 * Build-time generator checks (re-exported by scripts/ai/lib.mjs)
 * ------------------------------------------------------------------------- */

/** Inflation words a generator may use only when the source says them verbatim. */
export const BANNED_PHRASES: readonly string[] = [
  'expert',
  'proficient',
  'extensive experience',
  'led',
  'architected',
  'senior',
  'production-scale',
  'world-class',
];

function phraseRe(phrase: string, flags = 'i'): RegExp {
  const body = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+');
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, flags);
}

/** The first banned inflation phrase in `output` that `source` does not contain, else null. */
export function bannedPhrase(output: string, source: string): string | null {
  for (const phrase of BANNED_PHRASES) {
    if (phraseRe(phrase).test(output) && !phraseRe(phrase).test(source)) return phrase;
  }
  return null;
}

/** Organisations a generator might plausibly invent as employers or affiliations. */
export const KNOWN_ORGS: readonly string[] = [
  'Google DeepMind',
  'DeepMind',
  'Google',
  'OpenAI',
  'Anthropic',
  'Microsoft',
  'Amazon',
  'AWS',
  'Meta',
  'IBM',
  'Apple',
  'NVIDIA',
  'Nvidia',
  'Coursera',
  'TCS',
  'Netflix',
];

export type FaithEntities = ClaimEntities & { extraNames?: readonly string[] };

/**
 * Null when every number, organisation and technology name in `output` also
 * appears in `source`; otherwise the first offender ('number:99', 'name:OpenAI').
 * Names match case-sensitively in the output and case-insensitively in the source.
 */
export function faithful(output: string, source: string, entities: FaithEntities): string | null {
  const have = new Set(numbersIn(source).map(canonNumber));
  for (const n of numbersIn(output)) {
    if (!have.has(canonNumber(n))) return `number:${n}`;
  }
  const names = new Set<string>([
    ...entities.companies.flatMap(orgAliases),
    ...entities.institutions.flatMap(orgAliases),
    ...KNOWN_ORGS,
    ...(entities.projectNames ?? []),
    ...(entities.skills ?? []),
    ...(entities.tech ?? []),
    ...(entities.extraNames ?? []),
  ]);
  for (const name of names) {
    if (name.length < 2) continue;
    if (phraseRe(name, '').test(output) && !phraseRe(name, 'i').test(source)) return `name:${name}`;
  }
  return null;
}
