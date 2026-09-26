/*
 * The AskMeBot intent engine: rule-based quick answers built only from the site's
 * own data, which the caller passes in. Pure (no JSON imports, relative .ts
 * imports) so `node --test` can exercise it against the real profile and projects.
 *
 * Intents are tried in a fixed priority: a named project, then hiring and the CV,
 * then links, experience, education and bio, then a skill or stack term, then the
 * stack overview and the featured projects. Skill answers only say where a skill is
 * listed and which projects put it in their stack; they never claim more.
 */
import { wantsNavigation } from '../lib/ai/tools.ts';
import { COREFORGE_DISCLAIMER } from '../lib/coreforge/brand.ts';
import { slugify } from '../lib/slug.ts';
import { matchesTech, techFamily } from '../lib/tech.ts';

export type AskProject = {
  name: string;
  tagline: string;
  shortDescription: string;
  techStack: readonly string[];
  githubUrl: string;
  liveUrl: string | null;
  featured: boolean;
};

export type AskProfile = {
  name: string;
  email: string;
  about: string;
  links: { github: string; linkedin: string; leetcode: string };
  availability: { status: string; focus: string; openTo: string };
  experience: readonly { company: string; role: string; duration: string; end: string | null; highlights: readonly string[] }[];
  education: readonly { degree: string; institution: string; year: string; status: string }[];
  skills: Readonly<Record<string, readonly string[]>>;
};

export type AskData = { profile: AskProfile; projects: readonly AskProject[] };

export type AskIntent =
  | 'empty'
  | 'greeting'
  | 'project'
  | 'hire'
  | 'cv'
  | 'links'
  | 'experience'
  | 'venture'
  | 'education'
  | 'about'
  | 'skill'
  | 'stack'
  | 'projects'
  | 'fallback';

export type AskAction =
  | { kind: 'link'; label: string; href: string; external: boolean }
  | { kind: 'cv' };

export type AskAnswer = {
  intent: AskIntent;
  /** Plain text; `**bold**` spans and '\n' line breaks only. */
  text: string;
  /** Slugs of projects to show as cards, most relevant first. */
  projects: string[];
  actions: AskAction[];
  /** A draft for the contact form ('Write to …'). */
  handoff?: string;
};

export const STARTERS = [
  'What do you work on?',
  'What is CoreForge?',
  'Show me your best projects',
  'How do I hire you?',
] as const;

const MAX_CARDS = 3;

/* ---------------------------------------------------------------------------
 * Text helpers
 * ------------------------------------------------------------------------- */

const EDGE_BEFORE = '(?<![A-Za-z0-9])';
const EDGE_AFTER = '(?![A-Za-z0-9])';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordRe(term: string, flags = ''): RegExp {
  return new RegExp(`${EDGE_BEFORE}${escapeRegExp(term)}${EDGE_AFTER}`, flags);
}

/** Sentences of `text`; a split needs end punctuation followed by a capital. */
export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z("'])/)
    .filter(Boolean);
}

/**
 * Whole sentences up to `max` characters. When even the first sentence is longer,
 * it is cut at the last word boundary with an ellipsis, never mid-word.
 */
export function truncateSentences(text: string, max: number): string {
  const sentences = splitSentences(text);
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const first = sentences[0] ?? text;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** True when an answer reads as more than a line (the UI shows a typing cue first). */
export function isMultiSentence(text: string): boolean {
  return text.includes('\n') || splitSentences(text.replace(/\*\*/g, '')).length > 1;
}

function listNames(names: readonly string[]): string {
  const bold = names.map((n) => `**${n}**`);
  if (bold.length <= 1) return bold.join('');
  return `${bold.slice(0, -1).join(', ')} and ${bold[bold.length - 1]}`;
}

function firstSentence(text: string): string {
  return splitSentences(text)[0] ?? text;
}

/* ---------------------------------------------------------------------------
 * Projects by name
 * ------------------------------------------------------------------------- */

// Words in project names that say nothing about which project is meant.
const GENERIC_NAME_WORDS = new Set([
  'ai', 'the', 'and', 'of', 'for', 'app', 'data', 'analysis', 'analytics', 'prediction', 'forecasting',
  'challenge', 'tech', 'stock', 'content', 'side', 'effects', 'lab', 'hr', 'agent', 'support', 'domain',
]);

const singular = (w: string) => (w.length > 3 ? w.replace(/s$/, '') : w);

function projectKeys(name: string): Set<string> {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
  const keys = new Set<string>([words.join('')]);
  for (const w of words) if (w.length >= 3 && !GENERIC_NAME_WORDS.has(w)) keys.add(singular(w));
  return keys;
}

/** Lower-case question tokens plus two- and three-word joins ('Omni Lab' -> 'omnilab'). */
function questionTokens(q: string): Set<string> {
  const words = q.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
  const out = new Set<string>();
  words.forEach((w, i) => {
    out.add(singular(w));
    if (words[i + 1]) out.add(w + words[i + 1]);
    if (words[i + 1] && words[i + 2]) out.add(w + words[i + 1] + words[i + 2]);
  });
  return out;
}

function findProjects(q: string, projects: readonly AskProject[]): AskProject[] {
  const tokens = questionTokens(q);
  return projects.filter((p) => [...projectKeys(p.name)].some((k) => tokens.has(k)));
}

/* ---------------------------------------------------------------------------
 * Skill and stack terms
 * ------------------------------------------------------------------------- */

type Term = {
  /** Display name: the listed skill, or the stack family ('React', 'Next.js'). */
  name: string;
  /** Strings that count as a mention, e.g. 'Claude API' and 'Claude'. */
  variants: string[];
  category: string | null;
};

function buildTerms(data: AskData): Term[] {
  const terms: Term[] = [];
  const skillFamilies = new Set<string>();
  for (const [category, list] of Object.entries(data.profile.skills)) {
    for (const skill of list) {
      const family = techFamily(skill);
      skillFamilies.add(family);
      terms.push({ name: skill, variants: [...new Set([skill, family])], category });
    }
  }
  const stackFamilies = new Set<string>();
  for (const p of data.projects) for (const entry of p.techStack) stackFamilies.add(techFamily(entry));
  for (const family of stackFamilies) {
    if (!skillFamilies.has(family)) terms.push({ name: family, variants: [family], category: null });
  }
  return terms;
}

type Hit = { term: Term; index: number; length: number };

function scan(q: string, terms: readonly Term[], flags: string): Hit[] {
  const hits: Hit[] = [];
  for (const term of terms) {
    let best: Hit | null = null;
    for (const v of term.variants) {
      const m = wordRe(v, flags).exec(q);
      if (m && (!best || m.index < best.index || (m.index === best.index && v.length > best.length))) {
        best = { term, index: m.index, length: v.length };
      }
    }
    if (best) hits.push(best);
  }
  return hits.sort((a, b) => a.index - b.index || b.length - a.length);
}

/**
 * Case matters first ('ReAct' is the agent pattern, 'React' the UI library). Only
 * when nothing matches exactly does a case-blind match count, and then two terms
 * that differ only in case ('react') are reported as ambiguous.
 */
function findTerms(q: string, terms: readonly Term[]): { hit: Term | null; ambiguous: Term[] } {
  const exact = scan(q, terms, '');
  if (exact.length) return { hit: exact[0].term, ambiguous: [] };
  const loose = scan(q, terms, 'i');
  if (!loose.length) return { hit: null, ambiguous: [] };
  const first = loose[0];
  const sameSpot = loose.filter((h) => h.index === first.index && h.length === first.length);
  return sameSpot.length > 1 ? { hit: null, ambiguous: sameSpot.map((h) => h.term) } : { hit: first.term, ambiguous: [] };
}

function projectsUsing(term: Term, projects: readonly AskProject[]): AskProject[] {
  return projects.filter((p) => term.variants.some((v) => matchesTech(p.techStack, v)));
}

function skillAnswer(term: Term, data: AskData): AskAnswer {
  const using = projectsUsing(term, data.projects);
  const names = using.map((p) => p.name);
  const stack =
    using.length === 1 ? `the stack of ${listNames(names)}` : `the stack of ${using.length} projects: ${listNames(names)}`;
  // A stack-only term always has a project, since that is where it came from.
  const text = term.category
    ? `**${term.name}** is one of my listed skills, under **${term.category}**. ${
        using.length ? `On this site it's in ${stack}.` : 'No project on this site lists it in its stack yet.'
      }`
    : `**${term.name}** isn't one of my listed skills, but it's in ${stack}.`;
  return { intent: 'skill', text, projects: using.slice(0, MAX_CARDS).map((p) => slugify(p.name)), actions: [] };
}

function ambiguousAnswer(options: readonly Term[], data: AskData): AskAnswer {
  const parts = options.map((t) => {
    const using = projectsUsing(t, data.projects);
    if (t.category) return `**${t.name}** (listed under ${t.category})`;
    return using.length ? `**${t.name}** (in the stack of ${using.map((p) => p.name).join(', ')})` : `**${t.name}**`;
  });
  return {
    intent: 'skill',
    text: `Did you mean ${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}? Ask again with the exact name.`,
    projects: [],
    actions: [],
  };
}

/* ---------------------------------------------------------------------------
 * The other intents
 * ------------------------------------------------------------------------- */

const has = (q: string, re: RegExp) => re.test(q);

const RE = {
  greeting: /^(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b[\s!.,]*$/i,
  hire: /\b(hire|hiring|recruit\w*|work with|contact|email|mail|reach|available|availability|open to|freelance|contract|collaborat\w*|get in touch)\b/i,
  cv: /\b(cv|resume|résumé|curriculum vitae)\b/i,
  links: /\b(github|linkedin|leetcode|socials?|profiles?|links?)\b/i,
  current: /\b(work(ing)? on|currently|right now|these days|nowadays|doing now)\b/i,
  experience: /\b(experience|jobs?|roles?|compan(y|ies)|work history|employ\w*|internships?|career)\b/i,
  education: /\b(education|degrees?|college|universit(y|ies)|stud(y|ies|ying)|master'?s|b\.?tech|school|cgpa|gpa)\b/i,
  venture: /\b(core ?forge|goldensdmat|d-?mat|start-?up|(?:your|his) (?:own )?(?:company|venture|business))\b/i,
  about: /\b(about you|yourself|who are you|who is oikantik|background|bio|introduce|introduction)\b/i,
  stack: /\b(stack|tech|technolog(y|ies)|tools?|languages?|frameworks?|skills?)\b/i,
  projects: /\b(projects?|built|build|made|shipped|portfolio|work samples?|showcase|best work)\b/i,
};

function projectAnswer(found: readonly AskProject[]): AskAnswer {
  if (found.length === 1) {
    const p = found[0];
    const stack = p.techStack.slice(0, 6).join(', ');
    return {
      intent: 'project',
      text: `**${p.name}**: ${p.tagline}. ${firstSentence(p.shortDescription)}\nBuilt with ${stack}.`,
      projects: [slugify(p.name)],
      actions: [],
      handoff: `Hi Oikantik, I have a question about ${p.name}.`,
    };
  }
  return {
    intent: 'project',
    text: found.map((p) => `· **${p.name}**: ${p.tagline}`).join('\n'),
    projects: found.slice(0, MAX_CARDS).map((p) => slugify(p.name)),
    actions: [],
    handoff: `Hi Oikantik, I have a question about ${found.map((p) => p.name).join(' and ')}.`,
  };
}

function hireAnswer(data: AskData): AskAnswer {
  const { profile } = data;
  const a = profile.availability;
  return {
    intent: 'hire',
    text: `**${a.status}**: ${a.openTo}. Focus: ${a.focus}.\nThe quickest route is the contact form below, or email **${profile.email}**.`,
    projects: [],
    actions: [
      { kind: 'link', label: 'Email', href: `mailto:${profile.email}`, external: false },
      { kind: 'link', label: 'LinkedIn', href: profile.links.linkedin, external: true },
      { kind: 'cv' },
    ],
    handoff: "Hi Oikantik, I'd like to talk about working together.",
  };
}

function linksAnswer(data: AskData): AskAnswer {
  const { links } = data.profile;
  return {
    intent: 'links',
    text: `GitHub: ${links.github}\nLinkedIn: ${links.linkedin}\nLeetCode: ${links.leetcode}`,
    projects: [],
    actions: [
      { kind: 'link', label: 'GitHub', href: links.github, external: true },
      { kind: 'link', label: 'LinkedIn', href: links.linkedin, external: true },
      { kind: 'link', label: 'LeetCode', href: links.leetcode, external: true },
    ],
  };
}

function experienceAnswer(data: AskData, currentOnly: boolean): AskAnswer {
  const { experience, availability } = data.profile;
  if (currentOnly) {
    const now = experience.filter((e) => e.end === null);
    const roles = (now.length ? now : experience.slice(0, 1)).map((e) => `· **${e.role}** at ${e.company}`);
    return {
      intent: 'experience',
      text: `Right now:\n${roles.join('\n')}\nFocus: ${availability.focus}.`,
      projects: [],
      actions: [],
    };
  }
  return {
    intent: 'experience',
    text: experience.map((e) => `· **${e.role}** at ${e.company} (${e.duration}): ${e.highlights[0] ?? ''}`).join('\n'),
    projects: [],
    actions: [],
  };
}

/**
 * The venture he founded, from its experience entry, with a link to its page. Open
 * questions about it ('How does CoreForge make its questions?') still escalate, and
 * the model answers those from the coreforge: corpus chunks.
 */
function ventureAnswer(data: AskData): AskAnswer | null {
  const role = data.profile.experience.find((e) => /coreforge/i.test(e.company));
  if (!role) return null;
  return {
    intent: 'venture',
    text: `**${role.role}**, ${role.company} (${role.duration}).\n${role.highlights.map((h) => `· ${h}`).join('\n')}\n${COREFORGE_DISCLAIMER}`,
    projects: [],
    actions: [{ kind: 'link', label: 'Read about CoreForge', href: '/ventures/coreforge', external: false }],
  };
}

function educationAnswer(data: AskData): AskAnswer {
  return {
    intent: 'education',
    text: data.profile.education.map((e) => `· **${e.degree}**, ${e.institution} (${e.year}) · ${e.status}`).join('\n'),
    projects: [],
    actions: [],
  };
}

function stackAnswer(data: AskData): AskAnswer {
  return {
    intent: 'stack',
    text: Object.entries(data.profile.skills)
      .map(([cat, list]) => `**${cat}:** ${list.slice(0, 6).join(', ')}`)
      .join('\n'),
    projects: [],
    actions: [],
  };
}

function featuredAnswer(data: AskData): AskAnswer {
  const top = data.projects.filter((p) => p.featured).slice(0, MAX_CARDS);
  return {
    intent: 'projects',
    text: top.map((p) => `· **${p.name}**: ${p.tagline}`).join('\n'),
    projects: top.map((p) => slugify(p.name)),
    actions: [],
    handoff: "Hi Oikantik, I'd like to hear more about your projects.",
  };
}

export const FALLBACK_TEXT =
  "I didn't catch that. Try asking about **projects**, **tech stack**, **experience**, or how to **hire** me.";

/** Answers one question from the site's data. */
export function answer(question: string, data: AskData): AskAnswer {
  const q = question.trim().replace(/\s+/g, ' ');
  const none = { projects: [], actions: [] };
  if (!q) return { intent: 'empty', text: "Ask me anything about Oikantik's work, projects or skills.", ...none };
  if (has(q, RE.greeting)) {
    return { intent: 'greeting', text: 'Hi! Ask about projects, skills, experience, or how to work together.', ...none };
  }

  const named = findProjects(q, data.projects);
  if (named.length) return projectAnswer(named);

  if (has(q, RE.venture)) {
    const venture = ventureAnswer(data);
    if (venture) return venture;
  }

  if (has(q, RE.cv)) return { intent: 'cv', text: "Here's my CV.", projects: [], actions: [{ kind: 'cv' }] };
  if (has(q, RE.hire)) return hireAnswer(data);
  if (has(q, RE.links)) return linksAnswer(data);
  if (has(q, RE.current)) return experienceAnswer(data, true);
  if (has(q, RE.experience)) return experienceAnswer(data, false);
  if (has(q, RE.education)) return educationAnswer(data);
  if (has(q, RE.about)) {
    return { intent: 'about', text: truncateSentences(data.profile.about, 320), ...none };
  }

  const { hit, ambiguous } = findTerms(q, buildTerms(data));
  if (ambiguous.length) return ambiguousAnswer(ambiguous, data);
  if (hit) return skillAnswer(hit, data);

  if (has(q, RE.stack)) return stackAnswer(data);
  if (has(q, RE.projects)) return featuredAnswer(data);

  return { intent: 'fallback', text: FALLBACK_TEXT, ...none };
}

/* ---------------------------------------------------------------------------
 * Rule-first escalation (the AI concierge)
 *
 * answer() always runs first. Its deterministic intents render instantly; only
 * questions it cannot really answer go to the model: its 'fallback' and 'about'
 * intents, open-ended questions (why, how does, compare, what kind of ...), a
 * request to navigate that its answer doesn't already offer, and anything asked
 * inside a scope (the rules know nothing about "this project").
 * ------------------------------------------------------------------------- */

const OPEN_ENDED: readonly RegExp[] = [
  /^\s*(?:why|how come)\b/i,
  // 'How does it work?' is open; 'How do I hire you?' is a hire question.
  /^\s*how (?:does|did|do|would|could|can|is|was|has|well|much|many)\b(?!\s+(?:i|we)\b)/i,
  /\b(?:explain|describe|compare[sd]?|comparison|summari[sz]e|elaborate|walk me through|in (?:your|his) own words|what makes|what kinds? of|what sorts? of|what types? of|strengths?|weakness(?:es)?|trade-?offs?|pros and cons|difference between|differ(?:s|ent)? from|stand(?:s)? out|learn(?:ed|t)?|lessons?|challenges?|approach(?:ed|es)?|motivat\w*|curious|passionate|good fit|suited|recommend|think|opinion|impact|matters?)\b/i,
];

const OPEN_ENDED_WORDS = 16;

/** Questions the rule engine can't answer well: reasons, explanations, comparisons, opinions, long questions. */
export function isOpenEnded(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (OPEN_ENDED.some((re) => re.test(q))) return true;
  return q.split(/\s+/).length >= OPEN_ENDED_WORDS;
}

// Rule answers that already carry the action a navigation request asks for.
const ACTIONABLE: ReadonlySet<AskIntent> = new Set<AskIntent>(['cv', 'links', 'hire', 'project']);

/**
 * Whether a question should go to the model after its rule answer has been
 * computed. `foreign` is a question not in English: the rules only match English
 * and answer in English, so it goes to the model, which answers in its language.
 */
export function shouldEscalate(question: string, rule: AskAnswer, opts: { scoped?: boolean; foreign?: boolean } = {}): boolean {
  if (rule.intent === 'empty' || rule.intent === 'greeting') return false;
  if (opts.scoped || opts.foreign) return true;
  if (rule.intent === 'fallback' || rule.intent === 'about') return true;
  if (isOpenEnded(question)) return true;
  return wantsNavigation(question) && !ACTIONABLE.has(rule.intent);
}

const REFUSAL =
  /\b(?:isn['’]t|is not|aren['’]t|are not|not (?:listed|stated|mentioned|shown|given|covered|included|available|on this site)|no (?:information|details|mention|record)|doesn['’]t (?:say|mention|list|state|show|cover)|does not (?:say|mention|list|state|show|cover)|(?:couldn['’]t|can['’]t|could not|cannot) (?:find|see|confirm|answer)|(?:don['’]t|do not) (?:have|know)|contact form|write to (?:him|Oikantik))\b/i;

/** True when an AI answer says the site doesn't cover the question (such an answer needs no citation). */
export function isRefusal(text: string): boolean {
  return REFUSAL.test(text.replace(/\[c:[^\]]*\]/g, ''));
}

/**
 * The visitor's earlier questions for a request, exactly as typed: the latest
 * `maxTurns`, then the oldest dropped until they total at most `maxChars`.
 */
export function historyFor(questions: readonly string[], maxTurns = 6, maxChars = 2000): string[] {
  const out = questions.filter((q) => typeof q === 'string' && q.length > 0).slice(-maxTurns);
  const total = () => out.reduce((n, q) => n + q.length, 0);
  while (out.length && total() > maxChars) out.shift();
  return out;
}
