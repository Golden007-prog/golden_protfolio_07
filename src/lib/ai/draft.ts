/*
 * Writing help for the contact form (#230-#233): the hand-off prefill contract,
 * the server-side filter a streamed draft passes through, the enum-only message
 * check, the no-AI template and keyword check both fall back to, and the tone
 * and length constants the UI and the route share.
 *
 * A draft is the visitor's message to Oikantik, so the filter holds it to the
 * visitor's own notes: it must address him, it may name only his real projects
 * (or what the notes name), it carries no URL, email or phone number, and a
 * sentence that states a number, credential, total of years, degree or employer
 * that neither the notes nor the site give is dropped.
 *
 * Pure: relative .ts imports only, no JSON, so node --test runs it directly.
 */
import { AI_LIMITS } from './config.ts';
import { cleanText, scrubContacts } from './sanitize.ts';
import { KNOWN_ORGS, normalizeDigits, numbersIn, orgAliases } from './verify.ts';
import { MESSAGE_MAX, SUBJECT_MAX } from './prefill.ts';

export { MESSAGE_MIN, MESSAGE_MAX, SUBJECT_MAX, applyPrefill, appendText, type PrefillFields } from './prefill.ts';

/* ---------------------------------------------------------------------------
 * Limits and choices
 * ------------------------------------------------------------------------- */

export const NOTES_MAX = AI_LIMITS.draftInput;

/** Drafts one tab may request. A template insert costs nothing and doesn't count. */
export const DRAFT_SESSION_CAP = 5;
/** sessionStorage key for the count above. */
export const DRAFT_COUNT_KEY = 'ob-ai-draft-count';

export const DRAFT_TONES = [
  { id: 'concise', label: 'Concise' },
  { id: 'warm', label: 'Warm' },
  { id: 'formal', label: 'Formal' },
] as const;
export type DraftTone = (typeof DRAFT_TONES)[number]['id'];
export const DRAFT_TONE_IDS = DRAFT_TONES.map((t) => t.id) as [DraftTone, ...DraftTone[]];

/**
 * Length variants. maxChars is the hard cap on the message body (the email's
 * subject line is separate); the server stops there and the client truncates
 * there too. Edit these numbers to change a variant.
 */
export const DRAFT_LENGTHS = {
  email: { label: 'Email with subject', maxChars: 1200 },
  note: { label: 'Short note', maxChars: 480 },
  chat: { label: 'One-line chat', maxChars: 160 },
} as const satisfies Record<string, { label: string; maxChars: number }>;
export type DraftLength = keyof typeof DRAFT_LENGTHS;
export const DRAFT_LENGTH_IDS = Object.keys(DRAFT_LENGTHS) as [DraftLength, ...DraftLength[]];

/** The form's topic chips, plus 'general' when none is picked. */
export const DRAFT_INTENTS = ['research', 'fulltime', 'freelance', 'general'] as const;
export type DraftIntent = (typeof DRAFT_INTENTS)[number];

const INTENT_PHRASES: Record<DraftIntent, string> = {
  research: 'a research collaboration',
  fulltime: 'a full-time AI/ML role',
  freelance: 'a freelance project',
  general: 'your work',
};

const INTENT_SUBJECTS: Record<DraftIntent, string> = {
  research: 'Research collaboration',
  fulltime: 'Full-time AI/ML role',
  freelance: 'Freelance project',
  general: 'Hello from [your company]',
};

/** How the prompt describes an intent. */
export function intentPhrase(intent: DraftIntent): string {
  return INTENT_PHRASES[intent];
}

export type DraftRequest = { mode: 'draft'; notes: string; intent: DraftIntent; tone: DraftTone; length: DraftLength };

/* ---------------------------------------------------------------------------
 * The message check: enums only, so the route can't be used as a free LLM
 * ------------------------------------------------------------------------- */

export const CHECK_MISSING = ['role', 'timeline', 'how to reach you'] as const;
export type CheckMissing = (typeof CHECK_MISSING)[number];
// 'none' first: the fake model answers with each enum's first member.
export const CHECK_INTENTS = ['none', 'research', 'fulltime', 'freelance'] as const;
export type CheckIntent = (typeof CHECK_INTENTS)[number];
export const CHECK_QUESTIONS = ['none', 'availability'] as const;
export type CheckQuestion = (typeof CHECK_QUESTIONS)[number];

export type CheckRequest = { mode: 'check'; message: string };
export type CheckResult = { missing: CheckMissing[]; suggestedIntent: CheckIntent; question: CheckQuestion };
export type CheckResponse = { mode: 'check' } & CheckResult;

const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === 'string' && (list as readonly string[]).includes(x);

/** A check result rebuilt from untrusted JSON (model output or a response body), or null. */
export function normalizeCheck(x: unknown): CheckResult | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.missing) || !oneOf(CHECK_INTENTS, o.suggestedIntent) || !oneOf(CHECK_QUESTIONS, o.question)) return null;
  const said = new Set(o.missing.filter((m): m is CheckMissing => oneOf(CHECK_MISSING, m)));
  return { missing: CHECK_MISSING.filter((m) => said.has(m)), suggestedIntent: o.suggestedIntent, question: o.question };
}

const HAS_ROLE =
  /\b(?:roles?|positions?|jobs?|openings?|vacanc\w*|hir(?:e|ing)|recruit\w*|intern(?:ship)?s?|contracts?|freelanc\w*|projects?|collaborat\w*|research|consult\w*|gigs?|engineers?|developers?|scientists?|partner\w*|team|build(?:ing)?|help with|looking for)\b/i;
const HAS_TIMELINE =
  /\b(?:timelines?|deadlines?|start(?:ing|s)?|asap|soon|immediately|urgent\w*|this (?:week|month|quarter|year)|next (?:week|month|quarter|year)|weeks?|months?|days?|q[1-4]|by (?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|20\d\d|when (?:can|could|would)|availability)\b/i;
const HAS_REACH =
  /[^\s@]+@[^\s@]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d|\b(?:reach me|contact me|call me|email me|write to me|text me|ping me|linkedin|whatsapp|telegram|signal|calendly|cal\.com|my (?:number|phone|email|cell)|schedule|book (?:a|some) (?:call|time|slot)|a (?:quick )?call|time ?zone|ist|pst|est|cet|gmt|utc)\b/i;

const INTENT_WORDS: Record<Exclude<CheckIntent, 'none'>, RegExp> = {
  research: /\b(?:research\w*|papers?|publications?|lab|phd|academic\w*|stud(?:y|ies)|thesis|co-?author\w*)\b/gi,
  fulltime: /\b(?:full[- ]?time|permanent|salar\w*|fte|join (?:our|the|my) team|in-house|position|vacanc\w*|hiring|hire)\b/gi,
  freelance: /\b(?:freelanc\w*|contract(?:or|ing)?|gig|part[- ]?time|budget|quote|hourly|consult\w*|one-off|mvp|prototype)\b/gi,
};

const AVAILABILITY_Q =
  /\b(?:open to|available|availability|remote|relocat\w*|on-?site|hybrid|full[- ]?time|contract|freelanc\w*|bengaluru|bangalore|looking for (?:work|a (?:job|role))|hire|hiring|notice period)\b/i;

/**
 * The same enums from keywords alone: the non-AI path when the check route
 * falls back. It errs toward saying less.
 */
export function ruleCheck(message: string): CheckResult {
  const text = typeof message === 'string' ? message : '';
  const missing: CheckMissing[] = [];
  if (!HAS_ROLE.test(text)) missing.push('role');
  if (!HAS_TIMELINE.test(text)) missing.push('timeline');
  if (!HAS_REACH.test(text)) missing.push('how to reach you');

  let suggestedIntent: CheckIntent = 'none';
  let best = 0;
  let tie = false;
  for (const [id, re] of Object.entries(INTENT_WORDS) as [Exclude<CheckIntent, 'none'>, RegExp][]) {
    const hits = text.match(re)?.length ?? 0;
    if (hits > best) {
      best = hits;
      suggestedIntent = id;
      tie = false;
    } else if (hits > 0 && hits === best) tie = true;
  }
  if (tie) suggestedIntent = 'none';

  // A short question the site already answers: "Are you open to remote work?"
  const short = text.trim().length <= 240;
  const question: CheckQuestion = short && text.includes('?') && AVAILABILITY_Q.test(text) ? 'availability' : 'none';
  return { missing, suggestedIntent, question };
}

/* ---------------------------------------------------------------------------
 * Contact form text operations
 * ------------------------------------------------------------------------- */

const SUBJECT_LINE = /^\s*subject\s*:[ \t]*([^\n]*)(\n\s*)?/i;

/**
 * Splits an email draft's first 'Subject: …' line from its body. While the line
 * is still streaming (no newline yet, not final) it is `pending` and the body is
 * empty, so a half subject never lands in the message.
 */
export function splitSubject(text: string, final = false): { subject: string | null; body: string; pending: boolean } {
  const m = SUBJECT_LINE.exec(text);
  if (!m) {
    const lead = text.trimStart().toLowerCase();
    // 'Subj' may be the first chunk of a subject line.
    if (!final && lead.length > 0 && lead.length < 8 && 'subject:'.startsWith(lead)) return { subject: null, body: '', pending: true };
    return { subject: null, body: text, pending: false };
  }
  if (!m[2] && !final) return { subject: null, body: '', pending: true };
  const subject = m[1].replace(/\s+/g, ' ').trim().slice(0, SUBJECT_MAX) || null;
  return { subject, body: text.slice(m[0].length), pending: false };
}

/**
 * The hard client-side limit for a variant: one line for chat, never past the
 * variant's cap or MESSAGE_MAX, cut at a word boundary when one is near.
 */
export function fitDraft(text: string, length: DraftLength): string {
  let t = typeof text === 'string' ? text : '';
  t = length === 'chat' ? t.replace(/\s+/g, ' ') : t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/^\s+/, '');
  const max = Math.min(DRAFT_LENGTHS[length].maxChars, MESSAGE_MAX);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.search(/\s\S*$/);
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

/* ---------------------------------------------------------------------------
 * The no-AI template
 * ------------------------------------------------------------------------- */

const GREETINGS: Record<DraftTone, string> = { concise: 'Hi Oikantik,', warm: 'Hi Oikantik,', formal: 'Dear Oikantik,' };
const SIGN_OFFS: Record<DraftTone, string> = { concise: 'Thanks,', warm: 'Thanks so much,', formal: 'Kind regards,' };

function sentence(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/**
 * A fill-in-the-brackets draft from the visitor's notes and topic, for when the
 * AI draft isn't available. It says nothing about Oikantik beyond his name.
 */
export function templateDraft(opts: { notes: string; intent: DraftIntent; tone: DraftTone; length: DraftLength }): string {
  const notes = sentence(typeof opts.notes === 'string' ? opts.notes.slice(0, NOTES_MAX) : '');
  const about = INTENT_PHRASES[opts.intent];
  if (opts.length === 'chat') {
    return fitDraft(`Hi Oikantik, I'm [your name] from [your company], reaching out about ${about}. ${notes || '[what you need]'}`, 'chat');
  }
  const opener =
    opts.tone === 'warm'
      ? `I'm [your name] from [your company], and I'd love to talk about ${about}.`
      : opts.tone === 'formal'
        ? `My name is [your name], and I am writing from [your company] regarding ${about}.`
        : `I'm [your name] from [your company], reaching out about ${about}.`;
  const lines = [GREETINGS[opts.tone], '', `${opener} ${notes || '[what you need, in a sentence or two]'}`];
  if (opts.length === 'email') lines.push('', 'Timeline: [timeline]. You can reach me at [how to reach you].');
  else lines.push('', 'You can reach me at [how to reach you].');
  lines.push('', SIGN_OFFS[opts.tone], '[your name]');
  const body = fitDraft(lines.join('\n'), opts.length);
  return opts.length === 'email' ? `Subject: ${INTENT_SUBJECTS[opts.intent]}\n\n${body}` : body;
}

/* ---------------------------------------------------------------------------
 * Project names
 * ------------------------------------------------------------------------- */

const norm = (s: string) =>
  normalizeDigits(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// One to four capitalised (or camel-case) tokens; 'AI', 'ML' and versions may follow.
const TOKEN = String.raw`(?:[A-Z][A-Za-z0-9+#]*|[a-z]+[A-Z][A-Za-z0-9+#]*)`;
const NAME = String.raw`${TOKEN}(?:[ -](?:${TOKEN}|v?\d[\w]*)){0,3}`;
const Q_OPEN = `["“'‘]?`;
const Q_CLOSE = `["”'’]?`;
const PROJECT_WORDS = String.raw`(?:project|app|application|tool|repo|repository|platform|product|library|framework|system)`;

// Capitalised words that open a sentence or describe a project rather than name one.
const NOT_A_NAME = new Set(
  (
    'the this that these those your my our his her their its a an one any each every some which what another same main new next last first final ' +
    'side pet personal recent latest current open big small great cool interesting research freelance contract client team company startup ' +
    'hackathon capstone portfolio web mobile data demo sample test existing similar related specific particular upcoming ongoing previous past ' +
    'future real hobby github i we you he she they it hi hello dear thanks also and or but so if'
  ).split(' '),
);

const isCamel = (s: string) => /[a-z][A-Z]/.test(s);

/** True when `name` is one the draft may use: a known name (or a word-aligned part of one) or something the notes say. */
function isKnownName(name: string, allowed: readonly string[], notes: string): boolean {
  const n = norm(name);
  if (!n) return true;
  if (` ${norm(notes)} `.includes(` ${n} `)) return true;
  return allowed.some((a) => {
    const k = norm(a);
    return k === n || ` ${k} `.includes(` ${n} `) || n.startsWith(`${k} `) || k.replace(/ /g, '') === n.replace(/ /g, '');
  });
}

/** Drops leading words that aren't part of a name ('The NeuroFlow' -> ['The ', 'NeuroFlow']). */
function trimName(name: string): [prefix: string, core: string] {
  const parts = name.split(/(?<=[ -])/);
  let i = 0;
  while (i < parts.length && NOT_A_NAME.has(parts[i].replace(/[ -]$/, '').toLowerCase())) i += 1;
  return [parts.slice(0, i).join(''), parts.slice(i).join('')];
}

const PLACEHOLDER = '[project name]';

/**
 * Replaces project names the site doesn't have (and the notes don't mention)
 * with '[project name]': 'your NeuroFlow project' -> 'your [project name]',
 * 'the app called NeuroFlow' -> 'the [project name]', 'your work on NeuroFlow'
 * -> 'your work on [project name]'. A capitalised word opening a sentence
 * ('Research project') is not treated as a name.
 */
export function stripUnknownProjects(text: string, allowed: readonly string[], notes = ''): { text: string; removed: string[] } {
  if (typeof text !== 'string' || !text) return { text: '', removed: [] };
  const removed: string[] = [];
  // Short all-caps words (LLM, RAG, API) are technologies, not invented product names.
  const unknown = (core: string) => core !== '' && !/^[A-Z0-9]{2,5}$/.test(core) && !isKnownName(core, allowed, notes);

  // 'the project called NeuroFlow' -> 'the [project name]'
  let out = text.replace(
    new RegExp(String.raw`\b${PROJECT_WORDS}s?\s+(?:called|named|titled)\s+${Q_OPEN}(${NAME})${Q_CLOSE}`, 'g'),
    (whole: string, name: string) => {
      const [, core] = trimName(name);
      if (!unknown(core)) return whole;
      removed.push(core);
      return PLACEHOLDER;
    },
  );

  // 'your NeuroFlow project' -> 'your [project name]'
  out = out.replace(
    new RegExp(String.raw`(?<![A-Za-z0-9])(${Q_OPEN})(${NAME})(${Q_CLOSE})\s+(?:project|app|repo|repository)\b`, 'g'),
    (whole: string, open: string, name: string, _close: string, offset: number, all: string) => {
      const [prefix, core] = trimName(name);
      if (!unknown(core)) return whole;
      const before = all.slice(0, offset);
      const opensSentence = prefix === '' && (/^\s*$/.test(before) || /[.!?:]\s+$|\n\s*$/.test(before));
      if (opensSentence && !open && !isCamel(core) && !/[ -]/.test(core.trim())) return whole;
      removed.push(core);
      return `${prefix}${PLACEHOLDER}`;
    },
  );

  // 'your work on NeuroFlow' -> 'your work on [project name]'
  out = out.replace(
    new RegExp(String.raw`(\b(?:work|working|worked|built|build|building)\s+on\s+)${Q_OPEN}(${NAME})${Q_CLOSE}`, 'g'),
    (whole: string, lead: string, name: string) => {
      const [prefix, core] = trimName(name);
      if (!unknown(core)) return whole;
      removed.push(core);
      return `${lead}${prefix}${PLACEHOLDER}`;
    },
  );

  return { text: out, removed };
}

/* ---------------------------------------------------------------------------
 * Claims a draft may not make
 * ------------------------------------------------------------------------- */

const NEGATION = /\b(?:no|not|none|never|without|nor)\b|n['’]t\b/i;

// Any stated total of experience, in digits or words.
const YEARS_OF_EXPERIENCE =
  /\b(?:\d+(?:\.\d+)?\s*\+?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a few|few|several|many|multiple|over a|half a)[\s-]*(?:years?|yrs?)['’]?\s+(?:of\s+)?(?:[\w-]+\s+){0,2}experience\b|\bexperience\s+(?:of|spanning|over)\s+(?:\d+|a|one|two|three|four|five|several|many)\s*\+?\s*(?:years?|yrs?)\b/i;

const MASTERS = /\bmaster['’]?s\b|\bmasters\b|\bMDS\b|\bpost-?graduate\b/i;
const IN_PROGRESS =
  /\b(?:pursu\w*|in[- ]progress|ongoing|currently|enrolled|studying|expected|working\s+(?:on|toward|towards)|toward|towards|underway|will|until|through|candidate|student)\b/i;

// Organisation-like run, as in verify.ts. No 'i' flag anywhere it is used: the
// capital letter is what tells an organisation from ordinary words.
const ORG = String.raw`((?:the\s+)?(?:[A-Z]|[a-z][A-Z])[\w&.'’@-]*(?:\s+(?:@|&|of|[A-Z][\w&.'’@-]*))*)`;
const WHO = String.raw`(?:[Yy]ou|[Hh]e|Oikantik)`;
const WHOSE = String.raw`(?:[Yy]our|[Hh]is|Oikantik['’]s)`;
const EMPLOYMENT: readonly RegExp[] = [
  new RegExp(
    String.raw`\b${WHO}(?:['’]ve|['’]d|\s+have|\s+had|\s+has)?\s+(?:been\s+)?(?:work(?:s|ed|ing)?|intern(?:s|ed|ing)?|were|was)\s+(?:at|for)\s+${ORG}`,
    'g',
  ),
  new RegExp(String.raw`\b${WHO}(?:['’]ve|\s+have|\s+has)?\s+(?:been\s+)?(?:employed|hired)\s+(?:at|by)\s+${ORG}`, 'g'),
  new RegExp(String.raw`\b${WHO}(?:['’]ve|\s+have|\s+has)?\s+joined\s+${ORG}`, 'g'),
  new RegExp(String.raw`\b${WHOSE}\s+(?:time|role|job|internship|stint|position|tenure|years?|days|work|employment)\s+(?:at|with)\s+${ORG}`, 'g'),
];

function normOrg(s: string): string {
  return s
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/['’]s$/, '')
    .replace(/[^a-z0-9@&]+/g, ' ')
    .trim();
}

function isHisEmployer(candidate: string, companies: readonly string[]): boolean {
  const c = normOrg(candidate);
  return companies.some((name) =>
    orgAliases(name).some((alias) => {
      const a = normOrg(alias);
      return a !== '' && (a === c || ` ${c} `.includes(` ${a} `) || ` ${a} `.includes(` ${c} `));
    }),
  );
}

type IssueContext = {
  notes: string;
  numbers: Set<string>;
  companies: readonly string[];
  names: readonly string[];
};

function canon(n: string): string {
  const v = Number(n);
  return Number.isFinite(v) && n.length < 16 ? String(v) : n;
}

/** An employer the sentence says he worked for that the profile doesn't list (and the notes don't say). */
function claimedEmployer(text: string, ctx: IssueContext): string | null {
  const notes = ` ${normOrg(ctx.notes)} `;
  for (const re of EMPLOYMENT) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const candidate = m[1].replace(/[\s.,;:@&-]+$/, '').trim();
      if (!candidate) continue;
      if (ctx.names.some((n) => normOrg(n) === normOrg(candidate))) continue;
      if (isHisEmployer(candidate, ctx.companies)) continue;
      if (notes.includes(` ${normOrg(candidate)} `)) continue;
      return candidate;
    }
  }
  // The planning traps by name: the well-known labs are never his employers.
  if (/\b(?:you|your|he|his|oikantik)\b/i.test(text) && /\b(?:work(?:ed|ing|s)?|employ\w*|intern\w*|joined|hired|tenure|staff)\b/i.test(text)) {
    for (const org of KNOWN_ORGS) {
      const re = new RegExp(String.raw`\b(?:at|for|by|joined)\s+${org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`);
      if (re.test(text) && !notes.includes(` ${normOrg(org)} `)) return org;
    }
  }
  return null;
}

/**
 * Why a draft sentence can't be shown, or null: a number the notes and site
 * don't give, any total of years of experience, 'certified', the in-progress
 * Master's put as held, or an employer he never had.
 */
export function draftIssue(text: string, ctx: IssueContext): string | null {
  const t = normalizeDigits(text);
  for (const n of numbersIn(t)) {
    if (!ctx.numbers.has(canon(n))) return `number:${n}`;
  }
  if (YEARS_OF_EXPERIENCE.test(t) && !/experience/i.test(ctx.notes)) return 'years-of-experience';
  if (/certif/i.test(t) && !NEGATION.test(t) && !/certif/i.test(ctx.notes)) return 'certification';
  if (MASTERS.test(t) && !IN_PROGRESS.test(t) && !/master/i.test(ctx.notes)) return 'degree-held';
  const org = claimedEmployer(t, ctx);
  return org ? `employer:${org}` : null;
}

/* ---------------------------------------------------------------------------
 * The streaming filter
 * ------------------------------------------------------------------------- */

export type DraftFilterOptions = {
  length: DraftLength;
  /** The visitor's notes, already redacted: names and numbers they gave may appear. */
  notes: string;
  /** His projects, spelled as the site spells them. */
  projectNames: readonly string[];
  /** Other names a draft may use as they are: technologies, skills, his employers and schools. */
  knownNames: readonly string[];
  /** His employers, for the 'you worked at X' check. */
  companies: readonly string[];
  /** Site text whose numbers a draft may repeat (project names, the availability line). */
  facts?: readonly string[];
  /** The system prompt's leak marker. */
  canary?: string;
};

export type DraftFilterEnd = { emit: string[]; kept: number; dropped: number; truncated: boolean; degraded: boolean };

export type DraftFilter = {
  push(delta: string): { emit: string[]; blocked?: 'canary' };
  end(): DraftFilterEnd;
  /** True once the variant's cap is reached: the caller can stop reading the model. */
  full(): boolean;
};

const ABBREVIATION = /(?:^|[\s(])(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|inc|ltd|co|no|approx|e\.g|i\.e)\.$/i;
/** A sentence with no end in sight is released at a space once it is this long. */
const RUNAWAY = 400;

/** Index just past the first complete unit (a line, or a sentence and the spaces after it), or -1 to wait. */
function unitEnd(buf: string, final: boolean, lineOnly: boolean): number {
  for (let i = 0; i < buf.length; i += 1) {
    const ch = buf[i];
    let end = -1;
    if (ch === '\n') end = i + 1;
    else if (!lineOnly && (ch === '.' || ch === '!' || ch === '?')) {
      let j = i + 1;
      while (j < buf.length && /["'”’)\]]/.test(buf[j])) j += 1;
      if (j >= buf.length) break;
      if (/\s/.test(buf[j]) && !(ch === '.' && ABBREVIATION.test(buf.slice(Math.max(0, i - 7), i + 1)))) end = j;
      else i = j - 1;
    }
    if (end < 0) continue;
    let k = end;
    while (k < buf.length && /\s/.test(buf[k])) k += 1;
    // The whitespace run decides the paragraph break; wait until it is complete.
    if (k >= buf.length && !final) return -1;
    return k;
  }
  if (final) return buf.length;
  if (!lineOnly && buf.length > RUNAWAY) {
    const space = buf.lastIndexOf(' ', RUNAWAY);
    return space > 0 ? space + 1 : RUNAWAY;
  }
  return -1;
}

const NAMED = /\b(?:oikantik|basu)\b/i;
const GREETING = /^(\s*)(?:hi|hello|hey|dear|greetings|good (?:morning|afternoon|evening))(?:\s+(?:there|team|all|everyone|sir or madam|sir\/madam|sir|madam|friend|hiring manager))?\b/i;

/** Model text to plain text: markup and Markdown emphasis out, off-site contacts scrubbed. */
function tidy(unit: string): string {
  const plain = cleanText(unit)
    .replace(/\*\*|__|`/g, '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  return scrubContacts(plain, { urls: [], emails: [], phones: [] });
}

/**
 * Checks a streamed draft one sentence or line at a time. The email variant's
 * first line may be 'Subject: …' (other variants drop one). The first body
 * sentence must address Oikantik: a nameless greeting becomes 'Hi Oikantik' and
 * a missing one is added. Each unit is tidied, unknown project names become
 * '[project name]', and a unit with a claim draftIssue() rejects is dropped.
 * Output stops at the variant's cap, so the draft always fits the form.
 */
export function createDraftFilter(opts: DraftFilterOptions): DraftFilter {
  const max = Math.min(DRAFT_LENGTHS[opts.length].maxChars, MESSAGE_MAX);
  const allowed = [...opts.projectNames, ...opts.knownNames];
  const ctx: IssueContext = {
    notes: opts.notes,
    numbers: new Set(
      [opts.notes, ...(opts.facts ?? []), ...opts.projectNames, ...opts.knownNames].flatMap((s) => numbersIn(normalizeDigits(s))).map(canon),
    ),
    companies: opts.companies,
    names: allowed,
  };

  let buf = '';
  let raw = '';
  let started = false;
  let addressed = false;
  let emitted = 0;
  let kept = 0;
  let dropped = 0;
  let truncated = false;

  const process = (unit: string): string[] => {
    if (truncated) return [];
    let text = tidy(unit);
    if (!text.trim()) return [];

    if (!started) {
      started = true;
      const subject = /^\s*subject\s*:\s*/i.exec(text);
      if (subject) {
        if (opts.length !== 'email') return [];
        const line = stripUnknownProjects(text.slice(subject[0].length), allowed, opts.notes)
          .text.replace(/\s+/g, ' ')
          .trim()
          .slice(0, SUBJECT_MAX)
          .trim();
        if (!line || draftIssue(line, ctx)) {
          if (line) dropped += 1;
          return [];
        }
        return [`Subject: ${line}\n\n`];
      }
    }

    text = stripUnknownProjects(text, allowed, opts.notes).text;
    if (draftIssue(text, ctx)) {
      dropped += 1;
      return [];
    }

    if (!addressed) {
      addressed = true;
      if (!NAMED.test(text)) {
        text = GREETING.test(text)
          ? text.replace(GREETING, '$1Hi Oikantik')
          : `${opts.length === 'chat' ? 'Hi Oikantik, ' : 'Hi Oikantik,\n\n'}${text.replace(/^\s+/, '')}`;
      }
    }

    let out = opts.length === 'chat' ? text.replace(/\s+/g, ' ') : text;
    if (emitted === 0) out = out.replace(/^\s+/, '');
    if (emitted + out.trimEnd().length > max) {
      truncated = true;
      if (emitted > 0) return [];
      out = fitDraft(out, opts.length);
    }
    emitted += out.length;
    kept += 1;
    return [out];
  };

  const drain = (final: boolean): string[] => {
    const out: string[] = [];
    while (buf && !truncated) {
      // Until the first unit is out it may be a subject line, which ends only at a newline.
      const lead = buf.trimStart().toLowerCase();
      if (!started && !final && lead.length < 8 && 'subject:'.startsWith(lead)) break;
      const lineOnly = !started && /^\s*subject\s*:/i.test(buf);
      const end = unitEnd(buf, final, lineOnly);
      if (end < 0) break;
      const unit = buf.slice(0, end);
      buf = buf.slice(end);
      out.push(...process(unit));
    }
    if (truncated) buf = '';
    return out;
  };

  return {
    push(delta) {
      if (typeof delta !== 'string' || !delta) return { emit: [] };
      raw += delta;
      if (opts.canary && raw.includes(opts.canary)) {
        buf = '';
        truncated = true;
        return { emit: [], blocked: 'canary' };
      }
      buf += delta;
      return { emit: drain(false) };
    },
    end() {
      const emit = drain(true);
      const total = kept + dropped;
      return { emit, kept, dropped, truncated, degraded: total > 0 && dropped / total > 0.3 };
    },
    full: () => truncated,
  };
}
