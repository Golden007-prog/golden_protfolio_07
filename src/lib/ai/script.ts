/*
 * Which language the concierge answers in, and whether a translated answer can
 * be shown. Latin-script questions (Spanish, French, ...) stream in their own
 * language through the normal sentence filter. Answers in other scripts are
 * buffered as {en, local}: en goes through the filter, and local is shown only
 * when it keeps every number and every project, technology and organisation name
 * of en (names in Latin script, digits in any script) and adds none. Otherwise
 * only the English is shown.
 *
 * Pure: relative .ts imports only, no JSON.
 */
import { validLang, type Lang } from './prompts/base.ts';
import { faithful, normalizeDigits, numbersIn, orgAliases, type FaithEntities } from './verify.ts';

export type Script =
  'latin' | 'devanagari' | 'bengali' | 'gurmukhi' | 'gujarati' | 'tamil' | 'telugu' | 'kannada' | 'malayalam' | 'arabic' | 'cjk' | 'other';

const SCRIPTS: readonly [Exclude<Script, 'other'>, RegExp][] = [
  ['devanagari', /\p{Script=Devanagari}/gu],
  ['bengali', /\p{Script=Bengali}/gu],
  ['gurmukhi', /\p{Script=Gurmukhi}/gu],
  ['gujarati', /\p{Script=Gujarati}/gu],
  ['tamil', /\p{Script=Tamil}/gu],
  ['telugu', /\p{Script=Telugu}/gu],
  ['kannada', /\p{Script=Kannada}/gu],
  ['malayalam', /\p{Script=Malayalam}/gu],
  ['arabic', /\p{Script=Arabic}/gu],
  ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu],
  ['latin', /\p{Script=Latin}/gu],
];

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

/**
 * The question's script. A non-Latin script wins once it has at least 3 letters
 * and a quarter of all letters, so a Hindi question naming 'UrbanCare AI' is
 * still Devanagari. Citation markers are ignored.
 */
export function detectScript(text: string): Script {
  if (typeof text !== 'string') return 'other';
  const t = text.replace(/\[c:[^\]]*\]/g, ' ');
  const counts = SCRIPTS.map(([name, re]) => [name, count(t, re)] as const);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  if (!total) return 'other';
  const [bestName, best] = counts.filter(([name]) => name !== 'latin').sort((a, b) => b[1] - a[1])[0];
  if (best >= 3 && best >= total * 0.25) return bestName;
  return counts.find(([name]) => name === 'latin')![1] > 0 ? 'latin' : best > 0 ? bestName : 'other';
}

/* ---------------------------------------------------------------------------
 * Latin-script languages
 * ------------------------------------------------------------------------- */

const WORDS: Record<'en' | 'es' | 'fr' | 'de' | 'pt' | 'it', readonly string[]> = {
  en: [
    'the',
    'what',
    'which',
    'does',
    'did',
    'his',
    'he',
    'is',
    'are',
    'with',
    'about',
    'how',
    'who',
    'has',
    'have',
    'work',
    'projects',
    'and',
    'of',
    'in',
  ],
  es: [
    'qué',
    'que',
    'cuál',
    'cuáles',
    'cómo',
    'el',
    'los',
    'las',
    'del',
    'es',
    'su',
    'sus',
    'con',
    'para',
    'proyectos',
    'trabajo',
    'hizo',
    'tiene',
    'sobre',
    'él',
    'y',
    'en',
    'una',
    'un',
  ],
  fr: [
    'quel',
    'quels',
    'quelle',
    'quelles',
    'qu',
    'est',
    'les',
    'des',
    'du',
    'ses',
    'son',
    'sa',
    'avec',
    'pour',
    'projets',
    'travail',
    'il',
    'a',
    'sur',
    'et',
    'dans',
    'une',
    'le',
    'la',
  ],
  de: [
    'was',
    'welche',
    'welcher',
    'wie',
    'der',
    'die',
    'das',
    'und',
    'ist',
    'mit',
    'seine',
    'sein',
    'er',
    'hat',
    'projekte',
    'arbeit',
    'über',
    'für',
    'ein',
    'eine',
    'im',
  ],
  pt: [
    'quais',
    'qual',
    'como',
    'os',
    'as',
    'do',
    'da',
    'dos',
    'das',
    'é',
    'seu',
    'seus',
    'sua',
    'com',
    'para',
    'projetos',
    'trabalho',
    'ele',
    'tem',
    'sobre',
    'fez',
    'em',
    'uma',
    'um',
    'o',
  ],
  it: [
    'quali',
    'quale',
    'come',
    'il',
    'gli',
    'lo',
    'di',
    'è',
    'suo',
    'suoi',
    'sua',
    'con',
    'per',
    'progetti',
    'lavoro',
    'lui',
    'ha',
    'fatto',
    'su',
    'e',
    'una',
    'un',
    'che',
  ],
};

const MARKS: Partial<Record<keyof typeof WORDS, RegExp>> = {
  es: /[ñ¿¡]/,
  fr: /[çœàèêëîïûù]/,
  de: /[ßäöü]/,
  pt: /[ãõç]/,
};

/** 'es' | 'fr' | 'de' | 'pt' | 'it' for a question clearly in that language, else null (English or unsure). */
export function guessLatinLang(text: string): Lang | null {
  if (typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  const tokens = lower.match(/[\p{L}]+/gu) ?? [];
  if (tokens.length < 2) return null;
  const score = (lang: keyof typeof WORDS) => tokens.filter((t) => WORDS[lang].includes(t)).length + (MARKS[lang]?.test(lower) ? 1.5 : 0);
  const en = score('en');
  let best: keyof typeof WORDS | null = null;
  let bestScore = 0;
  for (const lang of ['es', 'fr', 'de', 'pt', 'it'] as const) {
    const s = score(lang);
    if (s > bestScore) {
      best = lang;
      bestScore = s;
    }
  }
  return best && bestScore >= 2 && bestScore > en ? best : null;
}

/* ---------------------------------------------------------------------------
 * The language to ask for
 * ------------------------------------------------------------------------- */

const NON_LATIN: ReadonlySet<string> = new Set(['hi', 'mr', 'bn', 'pa', 'gu', 'ta', 'te', 'kn', 'ml', 'ur', 'ar', 'ja', 'ko', 'zh']);

/** True for languages whose answers are buffered and checked as {en, local}. */
export function isNonLatinLang(lang: string | null | undefined): boolean {
  return typeof lang === 'string' && NON_LATIN.has(lang);
}

const URDU_LETTERS = /[ٹڈڑںےۓھ]/;

/**
 * The language to answer in: from the script, refined by the visitor's browser
 * languages where one script serves several (Devanagari: Hindi or Marathi).
 * null means English.
 */
export function langFor(question: string, preferred: readonly string[] = []): Lang | null {
  const prefs = preferred.map((p) => validLang(p)).filter((p): p is Lang => p !== null);
  const pick = (options: readonly Lang[]) => prefs.find((p) => options.includes(p)) ?? options[0];
  switch (detectScript(question)) {
    case 'devanagari':
      return pick(['hi', 'mr']);
    case 'bengali':
      return 'bn';
    case 'gurmukhi':
      return 'pa';
    case 'gujarati':
      return 'gu';
    case 'tamil':
      return 'ta';
    case 'telugu':
      return 'te';
    case 'kannada':
      return 'kn';
    case 'malayalam':
      return 'ml';
    case 'arabic':
      return URDU_LETTERS.test(question) ? 'ur' : pick(['ar', 'ur']);
    case 'cjk':
      if (/\p{Script=Hangul}/u.test(question)) return 'ko';
      if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(question)) return 'ja';
      return 'zh';
    case 'latin':
      return guessLatinLang(question);
    default:
      return null;
  }
}

/** A lang attribute value the page may use, or null: only tags validLang accepts. */
export function safeLangTag(tag: unknown): Lang | null {
  return validLang(tag);
}

/* ---------------------------------------------------------------------------
 * Checking a translated answer against its English
 * ------------------------------------------------------------------------- */

export type LocalCheck = { ok: true } | { ok: false; reason: string };

const stripMarkers = (s: string) => s.replace(/\[c:[^\]]*\]/g, ' ');

function counts(list: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namedIn = (text: string, name: string) => new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`).test(text);

/**
 * Whether `local` may be shown in place of the verified English `en`:
 * - every number in en is in local, and local has no number en lacks (digits in any script);
 * - every project, organisation and stack name in en appears verbatim in local (generic
 *   skill words such as 'Statistics' may be translated);
 * - local names no number, organisation or technology that en does not (verify.faithful).
 */
export function localCheck(en: string, local: string, entities: FaithEntities): LocalCheck {
  if (typeof local !== 'string' || !local.trim()) return { ok: false, reason: 'empty' };
  const e = stripMarkers(en);
  const l = normalizeDigits(stripMarkers(local));

  const enNums = counts(numbersIn(e));
  const localNums = counts(numbersIn(l));
  for (const [n, c] of enNums) if ((localNums.get(n) ?? 0) < c) return { ok: false, reason: `number:${n}` };
  for (const n of localNums.keys()) if (!enNums.has(n)) return { ok: false, reason: `number:${n}` };

  const names = [
    ...(entities.projectNames ?? []),
    ...entities.companies.flatMap(orgAliases),
    ...entities.institutions.flatMap(orgAliases),
    ...(entities.tech ?? []),
  ].filter((n) => n.trim().length >= 2);
  for (const name of new Set(names)) {
    if (namedIn(e, name) && !namedIn(l, name)) return { ok: false, reason: `name:${name}` };
  }

  const extra = faithful(l, e, entities);
  return extra ? { ok: false, reason: extra } : { ok: true };
}

/** Sentences of a buffered answer, in any script, for one delta frame each. */
export function splitSentences(text: string): string[] {
  if (typeof text !== 'string') return [];
  return (text.match(/[^.!?।॥。！？\n]+(?:[.!?।॥。！？]+(?:\s*\[c:[^\]]*\])*|\n|$)\s*/gu) ?? []).filter((s) => s.trim());
}
