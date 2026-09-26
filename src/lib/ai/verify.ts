/*
 * Claim checks shared by the streaming sentence filter, the structured routes
 * (jd-fit, jd-questions, brief) and every build-time generator. Each check is
 * phrased against what the data actually says about Oikantik: numbers must appear
 * in the cited evidence, employers and schools must be ones the profile lists,
 * a credential must be one certifications.json lists and the sentence must cite
 * it, a hackathon result must be worded as the cited post words it, the
 * in-progress Master's is never described as held, and no sentence states a
 * total of years of experience (the listed roles overlap, so the site withholds
 * that number).
 *
 * Pure: relative .ts imports only, no JSON, so node --test runs it directly.
 */

/** A listed credential as corpus entities() gives it. A bare string is a title and nothing more. */
export type CredentialEntity = { title: string; issuer?: string; platform?: string; kind?: string };

/** The parts of corpus entities() these checks read; fixtures can pass just these. */
export type ClaimEntities = {
  companies: readonly string[];
  institutions: readonly string[];
  /** Degree names whose status is still in progress. */
  inProgress?: readonly string[];
  /** Listed credentials; empty or absent means none is listed. */
  certifications?: readonly (string | CredentialEntity)[];
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

/*
 * A regex source whose ASCII letters match in either case; escapes (\b, \s, \w) and
 * character classes are copied as they are. The keywords below must match 'Research
 * Scientist at' and a sentence-initial 'Worked at' while ORG stays case-sensitive,
 * and the inline (?i:...) modifier is too new for some browsers that load this
 * module through fit.ts.
 */
function anyCase(src: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') {
      out += ch + (src[i + 1] ?? '');
      i += 1;
    } else if (inClass) {
      out += ch;
      if (ch === ']') inClass = false;
    } else if (ch === '[') {
      out += ch;
      inClass = true;
    } else {
      out += /[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch;
    }
  }
  return out;
}

// Capitalised word runs, allowing the lower-case lead of names like 'iHUB'.
const ORG = String.raw`((?:the\s+)?(?:[A-Z]|[a-z][A-Z])[\w&.'’@-]*(?:\s+(?:@|&|of|[A-Z][\w&.'’@-]*))*)`;
const EMPLOYER_PATTERNS: readonly RegExp[] = [
  new RegExp(
    anyCase(
      String.raw`\b(?:work(?:s|ed|ing)?|employed|intern(?:s|ed|ing|ship)?|job|role|position|specialist|engineer|scientist|researcher|developer|analyst|consultant|contractor|freelancer|staff|employee|tenure|stint|evaluat\w*|annotat\w*)\s+(?:at|for)\s+`,
    ) + ORG,
    'g',
  ),
  // The newer role titles ('Freelance AI Trainer at Outlier', 'Owner at GOLDEN's Coreforge') take
  // 'at' only: 'designer for Figma plugins' names a tool, not an employer.
  new RegExp(anyCase(String.raw`\b(?:trainer|owner|founder|co-founder|manager|designer|programmer)\s+at\s+`) + ORG, 'g'),
  new RegExp(anyCase(String.raw`\b(?:employed|hired|contracted|recruited)\s+by\s+`) + ORG, 'g'),
  new RegExp(anyCase(String.raw`\b(?:employed|interned|contracted)\s+with\s+`) + ORG, 'g'),
  new RegExp(anyCase(String.raw`\bjoin(?:s|ed)\s+`) + ORG, 'g'),
  // The role noun stays lower-case: in 'a Data Science Intern' the capitalised run is a job title, not an employer.
  new RegExp(anyCase(String.raw`\b(?:an?|former|ex-)\s+`) + ORG + String.raw`\s+(?:employee|engineer|intern|staffer|researcher|scientist)\b`, 'g'),
];
const SCHOOL_PATTERNS: readonly RegExp[] = [
  new RegExp(anyCase(String.raw`\b(?:stud(?:y|ies|ied|ying)|graduated|graduate|degree|alumn(?:us|a|i)|enrolled|B\.?Tech|Master['’]?s)\s+(?:at|from)\s+`) + ORG, 'g'),
];

/*
 * A denial ('he has not worked at OpenAI', 'he is not a Google DeepMind engineer',
 * 'the site does not list any role at Anthropic') names an organisation without
 * claiming it, so a match whose own verb phrase is negated is not a candidate.
 * The negation must sit right before the match, with only these words between;
 * 'not only', 'not just' and 'It's not surprising he worked at' therefore still
 * count as claims.
 */
const NEGATED_FILLER = [
  'ever', 'been', 'be', 'currently', 'actually', 'formally', 'officially', 'previously', 'once', 'yet', 'really', 'directly',
  'work', 'works', 'worked', 'working', 'serve', 'serves', 'served', 'as', 'a', 'an', 'any', 'the',
  'list', 'lists', 'listed', 'mention', 'mentions', 'mentioned', 'show', 'shows', 'include', 'includes', 'state', 'states',
  'name', 'names', 'have', 'has', 'had', 'hold', 'holds', 'held',
].join('|');
const NEGATED_LEAD = new RegExp(String.raw`(?:\b(?:not|never|no)|n['’]t)(?:\s+(?:${NEGATED_FILLER}))*\s*$`, 'i');
const NEGATION_WORD = /\b(?:no|not|never|none|nor|neither|nobody|nothing)\b|n['’]t\b/gi;
// 'hasn't worked at X since 2023' and 'doesn't work at X anymore' say he did.
const PRESUPPOSES_TENURE = /^[^.;!?]*?\b(?:since|until|till|anymore|any\s+longer)\b/i;
// 'not at X but at Y': the contrast names an organisation in bare prepositional form.
const CONTRAST = /\b(?:but|instead|rather)\b/i;
const CONTRAST_ORG = new RegExp(String.raw`\b(?:at|for|by)\s+${ORG}`, 'g');

function negatedAt(claim: string, start: number, end: number): boolean {
  const before = claim.slice(0, start);
  if (!NEGATED_LEAD.test(before)) return false;
  if (PRESUPPOSES_TENURE.test(claim.slice(end))) return false;
  // Two negations in the clause ('it is not true that he has not worked at') cancel
  // out, except a leading 'No' that answers the question ('No he has not worked at').
  const clause = before.slice(Math.max(...[',', ';', ':', '—', '–', '('].map((b) => before.lastIndexOf(b))) + 1);
  const count = (clause.match(NEGATION_WORD) ?? []).length;
  return (/^\s*no\b/i.test(clause) && count > 1 ? count - 1 : count) === 1;
}

function splitOrgs(raw: string, out: string[]): void {
  for (const part of raw.split(/\s+and\s+/)) {
    const c = part.replace(/[\s.,;:@&-]+$/, '').replace(/\s+(?:of)$/, '').trim();
    if (c) out.push(c);
  }
}

function candidates(claim: string, patterns: readonly RegExp[]): string[] {
  const out: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    for (const m of claim.matchAll(re)) {
      const end = m.index + m[0].length;
      if (!negatedAt(claim, m.index, end)) {
        splitOrgs(m[1], out);
        continue;
      }
      const tail = claim.slice(end);
      const contrast = CONTRAST.exec(tail);
      if (!contrast) continue;
      CONTRAST_ORG.lastIndex = 0;
      for (const c of tail.slice(contrast.index).matchAll(CONTRAST_ORG)) splitOrgs(c[1], out);
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

/*
 * A job requirement names an affiliation in noun phrases as well as in the sentence
 * forms above: 'Prior employment at OpenAI', 'Research Scientist experience at
 * Google DeepMind', 'Ex-Google', 'Published at NeurIPS'. 'experience with' and
 * 'experience in' are left out: they name tools ('experience with Kubernetes').
 */
const AFFILIATION_PATTERNS: readonly RegExp[] = [
  ...EMPLOYER_PATTERNS,
  new RegExp(anyCase(String.raw`\b(?:employment|tenure|stint|career)\s+(?:at|with|in|for)\s+`) + ORG, 'g'),
  new RegExp(anyCase(String.raw`\b(?:experience|background)\s+at\s+`) + ORG, 'g'),
  new RegExp(anyCase(String.raw`\b(?:publish(?:ed|ing)?|papers?|publications?)\s+(?:at|in)\s+`) + ORG, 'g'),
  new RegExp(anyCase(String.raw`\bex-`) + ORG, 'g'),
];

/**
 * The first organisation a job requirement asks him to have worked at, studied at
 * or published in that the profile does not list, else null. The site can never
 * evidence such a requirement, whatever skill it also names.
 */
export function unlistedAffiliation(requirement: string, entities: ClaimEntities): string | null {
  const text = normalizeDigits(String(requirement ?? '')).replace(/\s+/g, ' ').trim();
  for (const cand of [...candidates(text, AFFILIATION_PATTERNS), ...candidates(text, SCHOOL_PATTERNS)]) {
    if (isNonOrg(cand, entities)) continue;
    if (!orgMatches(cand, entities.companies) && !orgMatches(cand, entities.institutions)) return cand;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Phrasing rules
 * ------------------------------------------------------------------------- */

// Any stated total of experience, in digits or words. The site withholds it.
const YEARS_OF_EXPERIENCE = new RegExp(
  [
    String.raw`\b(?:\d+(?:\.\d+)?\s*\+?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a few|few|several|many|multiple|over a|half a)[\s-]*(?:years?|yrs?)['’]?\s+(?:of\s+)?(?:[\w-]+\s+){0,2}experience\b`,
    String.raw`\bexperience\s+(?:of|spanning|over)\s+(?:\d+(?:\.\d+)?|a|one|two|three|four|five|several|many)\s*\+?\s*(?:years?|yrs?)\b`,
  ].join('|'),
  'i',
);

const MASTERS = /\bmaster['’]?s\b|\bmasters\b|\bMDS\b|\bpost-?graduate\b|\bM\.?Sc?\.?\s+(?:in|degree)\b/i;
const HELD = /\b(?:holds?|held|holding|has|have|had|earned|complete|completed|finished|graduated|received|obtained|awarded|attained|possesses|with|conferred)\b|\bgraduate\b|\balumn/i;
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

/* ---------------------------------------------------------------------------
 * Negation scope for credentials and hackathon results
 * ------------------------------------------------------------------------- */

const NEG_WORD = /\b(?:no|not|never|none|nor|neither|without)\b|n['’]t\b/gi;
// A contrast starts a new claim: 'He has no AWS certification; he holds the Google AI Professional Certificate'.
const CONTRAST_MARK = /\b(?:but|however|though|although|whereas|instead|rather)\b|;/gi;

/**
 * True when the words before a mention negate it: an odd number of negations
 * since the last contrast, not counting 'not only' / 'not just', and not counting
 * a leading answer particle ('No, he is AWS certified' still claims it). 'The site
 * lists no AWS, PMP or Google Cloud certification' negates all three.
 */
function negatedBefore(before: string): boolean {
  let s = before.replace(/^\s*(?:no|yes)\s*[,.!:—–-]\s*/i, '');
  let cut = 0;
  for (const m of s.matchAll(CONTRAST_MARK)) cut = m.index + m[0].length;
  s = s.slice(cut);
  let count = 0;
  for (const m of s.matchAll(NEG_WORD)) {
    if (!/^\s+(?:only|just|merely)\b/i.test(s.slice(m.index + m[0].length))) count += 1;
  }
  return count % 2 === 1;
}

/* ---------------------------------------------------------------------------
 * Credentials
 *
 * A sentence that calls him certified, or names a certificate, credential, badge
 * or Specialization, passes only when what it names is listed and cited:
 *   - every listed title it names appears in the evidence, and so does every
 *     issuer or platform it names;
 *   - any other capitalised name next to the credential word ('AWS', 'PMP',
 *     'Google Cloud Professional', 'Stanford', 'Statistics with Python') must be
 *     words of one listed title that the evidence contains; anything else is an
 *     unlisted credential;
 *   - an issuer alone ('Google certified') is not enough: it needs a title, a
 *     platform, or title words of one of that issuer's credentials;
 *   - with nothing named, the evidence must be a credential chunk (or use the same
 *     word, as MCQ Tech Challenge's 'certification prep' does);
 *   - 'certif…' wording for credentials that are all course-completion badges
 *     (the Claude Academy items) is inflation.
 * A negated mention ('He is not AWS certified') claims nothing and passes. With no
 * credential listed at all, every mention that is not negated fails, as before.
 * ------------------------------------------------------------------------- */

type Tok = { raw: string; low: string; at: number; ph?: { kind: 'title' | 'issuer' | 'platform'; name: string; exact: boolean } };

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’&+#./-]*|[,;:()!?-]/gu;
const PUNCT = /^[,;:()!?-]$/;

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of normQuote(text).matchAll(TOKEN_RE)) {
    const raw = PUNCT.test(m[0]) ? m[0] : m[0].replace(/[.'/-]+$/, '').replace(/'s$/i, '');
    if (raw) out.push({ raw, low: raw.toLowerCase(), at: m.index });
  }
  return out;
}

/** The word tokens a name is matched by, lower-cased, without trailing punctuation. */
function nameWords(name: string): string[] {
  const toks = tokenize(name).map((t) => t.low);
  while (toks.length && PUNCT.test(toks[toks.length - 1])) toks.pop();
  return toks;
}

/**
 * A title, plus the forms a sentence shortens it to: no '(beta)' tail, no long
 * subtitle after a colon. Each form is a prefix of the title's own tokens, so the
 * case-sensitive check can compare token by token.
 */
function titleForms(title: string): string[][] {
  const full = nameWords(title);
  const forms = [full];
  const paren = full.lastIndexOf('(');
  if (paren > 1) forms.push(full.slice(0, paren));
  const colon = full.indexOf(':');
  if (colon >= 4) forms.push(full.slice(0, colon));
  return forms.filter((f) => f.length > 0);
}

/** 'University of Michigan' is also 'Michigan'. */
function nameForms(name: string): string[][] {
  const full = nameWords(name);
  return full.length >= 3 ? [full, full.slice(-1)] : [full];
}

function hasForm(hay: readonly string[], forms: readonly string[][]): boolean {
  return forms.some((f) => f.length > 0 && hay.some((_, i) => f.every((w, j) => hay[i + j] === w)));
}

function credentialList(entities: ClaimEntities): CredentialEntity[] {
  const out: CredentialEntity[] = [];
  for (const c of entities.certifications ?? []) {
    if (typeof c === 'string') {
      if (c.trim()) out.push({ title: c });
    } else if (c && typeof c.title === 'string' && c.title.trim()) {
      out.push(c);
    }
  }
  return out;
}

type Namer = { kind: 'title' | 'issuer' | 'platform'; name: string; forms: string[][]; exact: string[][] };

function nameCase(name: string): string[] {
  const toks = tokenize(name).map((t) => t.raw);
  while (toks.length && PUNCT.test(toks[toks.length - 1])) toks.pop();
  return toks;
}

// The streaming filter checks every sentence against the same entities, so the
// matchers are built once per certifications list.
const namerCache = new WeakMap<object, Namer[]>();

function namers(entities: ClaimEntities, list: readonly CredentialEntity[]): Namer[] {
  const key = entities.certifications;
  const cached = key ? namerCache.get(key) : undefined;
  if (cached) return cached;
  const out: Namer[] = [];
  const seen = new Set<string>();
  const add = (kind: Namer['kind'], name: string | undefined, forms: string[][]) => {
    if (!name || seen.has(`${kind}:${name}`)) return;
    seen.add(`${kind}:${name}`);
    // Case-sensitive forms: a title named without a credential word must keep its capitals
    // ('AI for Data Analysis' is the course; 'AI for data analysis' is an ordinary phrase).
    const raw = nameCase(name);
    const exact = kind === 'title' ? forms.map((f) => f.map((_, i) => raw[i] ?? '')) : [];
    out.push({ kind, name, forms, exact });
  };
  for (const c of list) {
    add('title', c.title, titleForms(c.title));
    add('platform', c.platform, nameForms(c.platform ?? ''));
    add('issuer', c.issuer, nameForms(c.issuer ?? ''));
  }
  // Longest first, so 'Programiz PRO' wins over 'Programiz' and a title over the issuer inside it.
  out.sort((a, b) => Math.max(...b.forms.map((f) => f.length)) - Math.max(...a.forms.map((f) => f.length)));
  if (key) namerCache.set(key, out);
  return out;
}

/** The sentence with every listed title, issuer and platform folded into one placeholder token. */
function foldNames(toks: readonly Tok[], list: readonly Namer[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; ) {
    let hit: { n: Namer; len: number; exact: boolean } | null = null;
    for (const n of list) {
      for (const [k, f] of n.forms.entries()) {
        if (f.length && f.every((w, j) => toks[i + j]?.low === w)) {
          const exact = n.kind !== 'title' || (n.exact[k] ?? []).every((w, j) => toks[i + j]?.raw === w);
          if (!hit || f.length > hit.len) hit = { n, len: f.length, exact };
        }
      }
    }
    if (hit) {
      out.push({ raw: '⟦name⟧', low: '⟦name⟧', at: toks[i].at, ph: { kind: hit.n.kind, name: hit.n.name, exact: hit.exact } });
      i += hit.len;
    } else {
      out.push(toks[i]);
      i += 1;
    }
  }
  return out;
}

const CRED_WORD = /^(?:certif\w*|credentials?|badges?)$/i;
const SPECIALIZATION = /^speciali[sz]ations?$/i;
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
// Capitalised words that are grammar, dates or his own name, never a credential's name.
const CAP_STOP = new RegExp(
  String.raw`^(?:he|his|him|she|her|they|their|it|its|the|this|that|these|those|a|an|and|or|but|in|on|at|by|for|from|with|of|to|as|also|all|both|each|every|some|several|many|most|no|not|yes|none|here|there|oikantik|basu|currently|recently|together|after|before|since|while|when|where|which|what|who|how|why|including|plus|via|over|under|among|between|through|across|today|i|we|you|your|our|my|is|are|was|were|course|courses|verify|verified|page|id|ids|online|free|${MONTHS})$`,
);
// A walk left from a credential word ends at these: the name it qualifies starts after them.
const LEFT_STOP = new RegExp(
  String.raw`^(?:the|a|an|his|her|their|its|this|that|these|those|and|or|but|nor|as|any|some|several|many|all|both|each|every|no|not|never|he|she|they|it|who|which|is|are|was|were|be|been|being|has|have|had|holds?|held|holding|earned|earns?|completed|completes?|received|receives?|obtained|got|gained|lists?|listed|shows?|includes?|including|took|takes?|passed|pass|finished|achieved|also)$`,
);
const RIGHT_LINK = /^(?:in|of|from|by|on|via|for|with|the|and|&|at)$/;

function capitalised(raw: string): boolean {
  return /^\p{Lu}/u.test(raw) || /^\p{Ll}+\p{Lu}/u.test(raw);
}

/** Capitalised words beside the credential word at `i` that name no listed title, issuer or platform. */
function residueAround(toks: readonly Tok[], i: number): string[] {
  const out: string[] = [];
  // 'Professional' stays a name word: 'IBM Data Science Professional Certificate' is a
  // programme he did not complete, however many of its courses he did.
  const take = (t: Tok) => {
    if (!t.ph && !CRED_WORD.test(t.raw) && capitalised(t.raw) && !CAP_STOP.test(t.low)) out.push(t.low);
  };
  for (let j = i - 1, n = 0; j >= 0 && n < 6; j -= 1, n += 1) {
    const t = toks[j];
    if (PUNCT.test(t.raw) || LEFT_STOP.test(t.low)) break;
    take(t);
  }
  for (let j = i + 1, n = 0; j < toks.length && n < 8; j += 1, n += 1) {
    const t = toks[j];
    if (PUNCT.test(t.raw)) break;
    if (!t.ph && !capitalised(t.raw) && !/^\d/.test(t.raw) && !RIGHT_LINK.test(t.low)) break;
    take(t);
  }
  return out;
}

function isMention(toks: readonly Tok[], i: number): boolean {
  const t = toks[i];
  if (t.ph) return false;
  if (CRED_WORD.test(t.raw)) return true;
  if (!SPECIALIZATION.test(t.raw)) return false;
  // 'the Statistics with Python Specialization' names one; 'his specialization is AI' does not.
  if (/^\p{Lu}/u.test(t.raw) && i > 0) return true;
  const prev = toks[i - 1];
  return Boolean(prev && (prev.ph || (capitalised(prev.raw) && !CAP_STOP.test(prev.low))));
}

/**
 * Why a sentence's credential claim fails against its evidence, or null when it
 * names only listed credentials that the evidence contains (or makes no credential
 * claim). The rules are in the block comment above.
 */
export function credentialIssue(text: string, evidence: readonly string[], entities: ClaimEntities): string | null {
  // Normalised once here so token offsets and the negation slices index the same string.
  const claim = normQuote(stripMarkers(String(text ?? '')));
  if (!claim) return null;
  const list = credentialList(entities);
  const toks = foldNames(tokenize(claim), namers(entities, list));
  const mentions = toks.map((_, i) => i).filter((i) => isMention(toks, i));
  const titles = toks.filter((t) => t.ph?.kind === 'title' && (t.ph.exact || mentions.length > 0));
  if (!mentions.length && !titles.length) return null;

  const evToks = tokenize(evidence.join('\n')).map((t) => t.low);
  const inEvidence = (name: string, kind: Namer['kind']) => hasForm(evToks, kind === 'title' ? titleForms(name) : nameForms(name));
  for (const t of titles) if (!inEvidence(t.ph!.name, 'title')) return 'certification';

  const open = mentions.filter((i) => !negatedBefore(claim.slice(0, toks[i].at)));
  if (!open.length) return null;
  if (!list.length) return 'certification';

  const named = (kind: Namer['kind']) => [...new Set(toks.filter((t) => t.ph?.kind === kind).map((t) => t.ph!.name))];
  const issuers = named('issuer');
  const platforms = named('platform');
  for (const n of [...issuers, ...platforms]) if (!inEvidence(n, issuers.includes(n) ? 'issuer' : 'platform')) return 'certification';

  const evidenced = list.filter((c) => inEvidence(c.title, 'title'));
  const byTitle = new Map(list.map((c) => [c.title, c]));
  // A credential can only excuse name words the sentence attributes to its own issuer and
  // platform: the Vertex AI badge does not make 'a Google Cloud certificate from Coursera'.
  const fits = (c: CredentialEntity) =>
    (!issuers.length || issuers.includes(c.issuer ?? '')) && (!platforms.length || platforms.includes(c.platform ?? ''));
  for (const i of open) {
    const residue = residueAround(toks, i);
    let excused: CredentialEntity[] = [];
    if (residue.length) {
      excused = evidenced.filter((c) => {
        const words = new Set(nameWords(c.title));
        return fits(c) && residue.every((w) => words.has(w));
      });
      if (!excused.length) return 'certification';
    }
    const titled = titles.length > 0 || platforms.length > 0;
    if (!titled && issuers.length && !excused.length) return 'certification';
    if (!titled && !excused.length && !issuers.length) {
      const stem = toks[i].low.slice(0, 5);
      if (!evidenced.length && !evidence.some((e) => e.toLowerCase().includes(stem))) return 'certification';
    }
    if (/^certif/i.test(toks[i].raw)) {
      const refs = titles.length
        ? titles.map((t) => byTitle.get(t.ph!.name)).filter((c): c is CredentialEntity => Boolean(c))
        : platforms.length || issuers.length
          ? list.filter((c) => (!platforms.length || platforms.includes(c.platform ?? '')) && (!issuers.length || issuers.includes(c.issuer ?? '')))
          : excused.length
            ? excused
            : evidenced;
      if (refs.length && refs.every((c) => c.kind === 'course-completion-badge')) return 'certification';
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Hackathon results
 * ------------------------------------------------------------------------- */

// Each result word, and the evidence that supports it. 'win' and 'wins' are left
// out: 'helps shopkeepers win customers' is not a result.
const HONOURS: readonly (readonly [RegExp, RegExp])[] = [
  [/\b(?:won(?!['’]t)|winners?|winning\s+(?:entry|entries|team|project|submission|solution|app|idea|pitch))\b/i, /\b(?:won|winn\w*)\b/i],
  [/\bprizes?\b/i, /\bprize/i],
  [/\b(?:awards?|awarded|award-winning)\b/i, /\baward/i],
  [/\bchampion(?:s|ship|ships)?\b/i, /\bchampion/i],
  [/\bmedall?(?:s|ists?)?\b/i, /\bmedal/i],
  [/\bpodium\b/i, /\bpodium\b/i],
  [/\brunners?-up\b/i, /\brunners?-up\b/i],
  [/\b(?:first|1st)\s+place\b/i, /\b(?:first|1st)\s+place\b/i],
  [/\b(?:second|2nd)\s+place\b/i, /\b(?:second|2nd)\s+place\b/i],
  [/\b(?:third|3rd)\s+place\b/i, /\b(?:third|3rd)\s+place\b/i],
  [/\bshortlisted\b/i, /\bshortlist/i],
  [/\bsemi-?finalists?\b/i, /\bsemi-?finalist/i],
  [/(?<!semi-?)\bfinalists?\b/i, /(?<!semi-?)\bfinalists?\b/i],
  [/\bhonou?rable\s+mentions?\b/i, /\bhonou?rable\s+mention/i],
];

/**
 * 'honour:<word>' when the sentence gives him or a project a result (won, winner,
 * prize, award, finalist, first place …) that the cited evidence does not word the
 * same way, else null. Negated results ('VyaparGyan did not win') pass.
 */
export function honourIssue(text: string, evidence: readonly string[]): string | null {
  const claim = stripMarkers(String(text ?? '')).replace(/\s+/g, ' ');
  const ev = evidence.join('\n');
  for (const [said, backed] of HONOURS) {
    const re = new RegExp(said.source, 'gi');
    for (const m of claim.matchAll(re)) {
      if (negatedBefore(claim.slice(0, m.index))) continue;
      if (!backed.test(ev)) return `honour:${m[0].toLowerCase()}`;
    }
  }
  return null;
}

/**
 * The reason a claim fails against its evidence, or null when it passes.
 * - 'number:<n>': a number that is not in the evidence (after digit normalisation);
 * - 'years-of-experience': any stated total of experience;
 * - 'number-word:<w>': a spelled-out number the evidence gives neither as a numeral nor in words
 *   (skipped with numberWords: false, where counting what a picture shows is fine);
 * - 'certification': a credential that is not listed, not cited, or a badge called a certification
 *   (credentialIssue);
 * - 'honour:<word>': a hackathon result the cited evidence does not state (honourIssue);
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
  const credential = credentialIssue(claim, evidence, entities) ?? honourIssue(claim, evidence);
  if (credential) return credential;
  if (mastersAsHeld(claim, entities)) return 'degree-held';
  const org = foreignOrg(claim, ev, entities);
  return org ? `employer:${org}` : null;
}

/* ---------------------------------------------------------------------------
 * Structured claims
 * ------------------------------------------------------------------------- */

export type Evidence = { id: string; quote: string };

/**
 * A chunk id as the corpus keys it. The prompt shows each chunk as '[c:<id>]', and
 * the model sometimes copies that marker into a JSON id: 'c:exp:0' and '[c:exp:0]'
 * both mean 'exp:0'. No chunk kind is 'c', so the strip cannot change a real id.
 */
export function canonicalId(id: string): string {
  return String(id).trim().replace(/^\[?c:/i, '').replace(/\]$/, '');
}

export type FactSource = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

function lookup(facts: FactSource, key: string): string | undefined {
  if (facts instanceof Map) return facts.get(key);
  const rec = facts as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}

/**
 * The known id a model-written id names. Past the 'c:' marker, the model sometimes
 * drops the chunk kind too ('content-storyteller#stack' for
 * project:content-storyteller#stack). That form resolves only when exactly one known
 * id is it with a kind in front and it starts with a letter, so an ambiguous '0'
 * (exp:0, edu:0, tool:0) or an invented slug stays unknown and fails the lookup. The
 * quote must still appear verbatim in the chunk the id resolves to.
 */
export function resolveId(raw: string, facts: FactSource): string {
  const id = canonicalId(raw);
  if (!id || lookup(facts, id) !== undefined || !/^[a-z]/i.test(id)) return id;
  const keys = facts instanceof Map ? [...facts.keys()] : Object.keys(facts);
  const hits = keys.filter((k) => k.indexOf(':') > 0 && k.slice(k.indexOf(':') + 1) === id);
  return hits.length === 1 ? hits[0] : id;
}

function factOf(facts: FactSource, id: string): string | undefined {
  return lookup(facts, resolveId(id, facts));
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
