import type { AiTarget } from './protocol.ts';
import type { SectionId } from '../site.ts';
import { numbersIn } from './verify.ts';

/*
 * Discovery logic shared by the guided tour, the section tools, the smart 404,
 * POST /api/ai/tour and scripts/ai/gen-discovery.mjs.
 *
 * A tour is only an ordered list of stop ids drawn from a closed set (sections,
 * project slugs, experience indices). The model never writes the words a visitor
 * reads: each stop's line comes from the site's data through tourLine(). Section
 * versions (plain English, Hindi, Bengali, Spanish) are generated at build time
 * and must pass checkTranslation(), which rejects any version that loses a number
 * or a name the original states.
 *
 * Pure: relative .ts imports only and no JSON; data comes in as arguments, so
 * node --test runs it directly.
 */

/* ---------------------------------------------------------------------------
 * Stops
 * ------------------------------------------------------------------------- */

/** Page order. The hero is never a stop: a tour always starts below it. */
export const TOUR_SECTIONS = ['about', 'skills', 'projects', 'experience', 'philosophy', 'contact'] as const satisfies readonly SectionId[];

export const TOUR_MIN = 4;
export const TOUR_MAX = 6;

export type TourCatalog = { slugs: readonly string[]; expCount: number };
export type TourTarget = Extract<AiTarget, { kind: 'section' | 'project' | 'experience' }>;

/** Every stop id a tour may use: 'section:<id>', 'project:<slug>' and 'exp:<index>'. */
export function stopIds(cat: TourCatalog): string[] {
  return [
    ...TOUR_SECTIONS.map((id) => `section:${id}`),
    ...cat.slugs.map((slug) => `project:${slug}`),
    ...Array.from({ length: cat.expCount }, (_, i) => `exp:${i}`),
  ];
}

const STOP = /^(section|project|exp):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The target a stop id names, or null for anything outside the catalogue. */
export function parseStop(id: unknown, cat: TourCatalog): TourTarget | null {
  if (typeof id !== 'string' || id.length > 120) return null;
  const m = STOP.exec(id);
  if (!m) return null;
  const [, kind, rest] = m;
  if (kind === 'section') {
    return (TOUR_SECTIONS as readonly string[]).includes(rest) ? { kind: 'section', id: rest as SectionId } : null;
  }
  if (kind === 'project') return cat.slugs.includes(rest) ? { kind: 'project', slug: rest } : null;
  if (!/^\d{1,3}$/.test(rest)) return null;
  const index = Number(rest);
  return index < cat.expCount ? { kind: 'experience', index } : null;
}

/**
 * A model's (or a stored) stop list, checked: every id must be in the catalogue
 * (one unknown id rejects the whole list), repeats are dropped keeping the first,
 * and 4 to 6 distinct stops must remain. null otherwise.
 */
export function normalizeStops(raw: unknown, cat: TourCatalog): string[] | null {
  if (!Array.isArray(raw) || raw.length > TOUR_MAX * 2) return null;
  const out: string[] = [];
  for (const id of raw) {
    if (!parseStop(id, cat)) return null;
    if (!out.includes(id as string)) out.push(id as string);
  }
  return out.length >= TOUR_MIN && out.length <= TOUR_MAX ? out : null;
}

/* ---------------------------------------------------------------------------
 * Goal presets (the chips). Their orders are precomputed by gen-discovery.mjs;
 * defaultStops() is the order used until that store entry exists.
 * ------------------------------------------------------------------------- */

export type GoalPresetId = 'hiring-ml' | 'curious-engineer' | 'quick-look';

export type GoalPreset = { id: GoalPresetId; label: string; goal: string };

export const GOAL_PRESETS: readonly GoalPreset[] = [
  {
    id: 'hiring-ml',
    label: 'Hiring for ML',
    goal: 'I am hiring for a machine learning or generative AI engineering role. Show me his experience and the projects closest to production ML work.',
  },
  {
    id: 'curious-engineer',
    label: 'Curious engineer',
    goal: 'I am an engineer curious about how he builds: his tools, his agent and retrieval projects, and his working principles.',
  },
  {
    id: 'quick-look',
    label: 'Quick look',
    goal: 'I have two minutes. Show me the highlights of the site.',
  },
];

export function isGoalPreset(id: unknown): id is GoalPresetId {
  return GOAL_PRESETS.some((p) => p.id === id);
}

/** Valid, distinct stops, topped up with sections in page order to the minimum length. */
function complete(list: readonly string[], cat: TourCatalog): string[] {
  const out: string[] = [];
  for (const id of list) if (parseStop(id, cat) && !out.includes(id)) out.push(id);
  for (const id of TOUR_SECTIONS.map((s) => `section:${s}`)) {
    if (out.length >= TOUR_MIN) break;
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, TOUR_MAX);
}

/** The built-in order for a preset: sections plus the first featured projects. */
export function defaultStops(id: GoalPresetId, cat: TourCatalog, featured: readonly string[]): string[] {
  const f = (i: number) => (featured.length ? `project:${featured[i % featured.length]}` : 'section:projects');
  switch (id) {
    case 'hiring-ml':
      return complete(['section:about', 'section:experience', f(0), f(1), 'section:skills', 'section:contact'], cat);
    case 'curious-engineer':
      return complete(['section:skills', f(1), f(3), 'section:philosophy', 'section:contact'], cat);
    case 'quick-look':
      return complete(['section:about', 'section:projects', 'section:experience', 'section:contact'], cat);
  }
}

/** The preset closest to a typed goal, for when the custom route falls back. */
export function presetFor(goal: string): GoalPresetId {
  const g = goal.toLowerCase();
  if (/\b(hir(e|ing)|recruit\w*|role|job|position|candidate|team|ml|machine learning|gen ?ai|llm)\b/.test(g)) return 'hiring-ml';
  if (/\b(engineer\w*|build\w*|code|coding|stack|architect\w*|agent\w*|rag|how he|principles?|tools?)\b/.test(g)) return 'curious-engineer';
  return 'quick-look';
}

/* ---------------------------------------------------------------------------
 * Stop lines, deterministically from the data
 * ------------------------------------------------------------------------- */

type CopyLine = { section: SectionId; kind: 'title' | 'subtitle'; text: string };

export type TourData = {
  /** profile.about */
  about: string;
  projects: readonly { slug: string; name: string; tagline: string }[];
  experience: readonly { company: string; role: string; duration: string }[];
  sections: readonly { id: SectionId; label: string }[];
  /** site-copy SECTION_COPY */
  sectionCopy: readonly CopyLine[];
  /** site-copy CONTACT_COPY */
  contact: string;
  /** The skill group names, in display order. */
  skillGroups: readonly string[];
};

export type TourStopView = { id: string; target: TourTarget; title: string; line: string };

const plain = (s: string) => s.replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();

function firstSentence(s: string): string {
  const m = /^(.+?[.!?])(?:\s|$)/.exec(plain(s));
  return m ? m[1] : plain(s);
}

function subtitleOf(data: TourData, id: SectionId): string {
  return plain(data.sectionCopy.find((c) => c.section === id && c.kind === 'subtitle')?.text ?? '');
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sectionLine(id: SectionId, data: TourData): string {
  switch (id) {
    case 'about':
      return firstSentence(data.about);
    case 'skills':
      return data.skillGroups.length ? `Grouped as ${listOf(data.skillGroups)}.` : '';
    case 'projects': {
      const sub = subtitleOf(data, 'projects');
      const count = `${data.projects.length} projects`;
      return sub ? `${sub} · ${count}` : count;
    }
    case 'contact':
      return plain(data.contact);
    default:
      return subtitleOf(data, id);
  }
}

/** The title and one line a stop shows, built only from the site's data. null for an unknown id. */
export function tourLine(id: string, data: TourData): TourStopView | null {
  const cat: TourCatalog = { slugs: data.projects.map((p) => p.slug), expCount: data.experience.length };
  const target = parseStop(id, cat);
  if (!target) return null;
  switch (target.kind) {
    case 'section': {
      const label = data.sections.find((s) => s.id === target.id)?.label ?? target.id;
      return { id, target, title: label, line: sectionLine(target.id, data) };
    }
    case 'project': {
      const p = data.projects.find((x) => x.slug === target.slug)!;
      return { id, target, title: p.name, line: plain(p.tagline) };
    }
    case 'experience': {
      const e = data.experience[target.index];
      return { id, target, title: e.role, line: `${e.company} · ${e.duration}` };
    }
  }
}

/* ---------------------------------------------------------------------------
 * Section tools: plain-English and translated versions, precomputed
 * ------------------------------------------------------------------------- */

export const TOOL_SECTIONS = ['about', 'experience', 'philosophy', 'contact'] as const satisfies readonly SectionId[];
export type ToolSection = (typeof TOOL_SECTIONS)[number];

export const TOOL_MODES = ['simple', 'hi', 'bn', 'es'] as const;
export type ToolMode = (typeof TOOL_MODES)[number];
export type ToolLanguage = Exclude<ToolMode, 'simple'>;
export const TOOL_LANGUAGES: readonly ToolLanguage[] = ['hi', 'bn', 'es'];

/** BCP 47 tag of each version's text (the lang attribute). */
export const TOOL_LANG: Record<ToolMode, string> = { simple: 'en', hi: 'hi', bn: 'bn', es: 'es' };
/** Voice tag for ReadAloud. */
export const TOOL_VOICE: Record<ToolMode, string> = { simple: 'en-IN', hi: 'hi-IN', bn: 'bn-IN', es: 'es-ES' };
/** English name and the language's own name, for the switcher. */
export const TOOL_NAMES: Record<ToolMode, { en: string; native: string }> = {
  simple: { en: 'Plain English', native: 'Plain English' },
  hi: { en: 'Hindi', native: 'हिन्दी' },
  bn: { en: 'Bengali', native: 'বাংলা' },
  es: { en: 'Spanish', native: 'Español' },
};

export function isToolSection(x: unknown): x is ToolSection {
  return typeof x === 'string' && (TOOL_SECTIONS as readonly string[]).includes(x);
}

export function isToolMode(x: unknown): x is ToolMode {
  return typeof x === 'string' && (TOOL_MODES as readonly string[]).includes(x);
}

/** The section the tools open on: the one in view, or the nearest one that has versions. */
export function toolSectionFor(active: SectionId | null | undefined): ToolSection {
  switch (active) {
    case 'experience':
    case 'projects':
      return 'experience';
    case 'philosophy':
      return 'philosophy';
    case 'contact':
      return 'contact';
    default:
      return 'about';
  }
}

export type Block = { heading?: string; text: string };

export type SectionSource = {
  /** profile.about */
  about: string;
  experience: readonly { company: string; role: string; duration: string; description: string }[];
  /** site-copy SECTION_COPY subtitles */
  experienceSubtitle: string;
  philosophySubtitle: string;
  tenets: readonly { title: string; body: string }[];
  /** site-copy CONTACT_COPY */
  contact: string;
  availability: { status: string; focus: string; openTo: string };
};

/** The original text of a section, in blocks: what every version is made from and what 'Show original' shows. */
export function sectionBlocks(id: ToolSection, d: SectionSource): Block[] {
  switch (id) {
    case 'about':
      return [{ text: plain(d.about) }];
    case 'experience':
      return [
        { text: plain(d.experienceSubtitle) },
        ...d.experience.map((e) => ({ heading: `${e.role} · ${e.company}`, text: `${e.duration}. ${plain(e.description)}` })),
      ];
    case 'philosophy':
      return [{ text: plain(d.philosophySubtitle) }, ...d.tenets.map((t) => ({ heading: plain(t.title), text: plain(t.body) }))];
    case 'contact':
      return [{ text: plain(d.contact) }, { text: `${d.availability.status}. ${d.availability.focus}. ${d.availability.openTo}.` }];
  }
}

/** One string for reading aloud. */
export function blocksText(blocks: readonly Block[]): string {
  return blocks.map((b) => (b.heading ? `${b.heading}. ${b.text}` : b.text)).join('\n\n');
}

/**
 * Prompt versions, per mode, that a stored version's hash includes. Bump one when
 * its prompt in prompts/tour.ts changes enough that stored versions must be
 * regenerated (and reviewed again).
 */
export const SECTION_PROMPT_VERSIONS: Record<ToolMode, string> = { simple: 'simple-v2', hi: 'section-v1', bn: 'section-v1', es: 'section-v1' };
/** Bump when the tour prompt changes, so the precomputed chip orders regenerate. */
export const TOUR_PROMPT_VERSION = 'tour-v1';

export const toolKey = (section: ToolSection, mode: ToolMode) => `section:${section}:${mode}`;
export const tourKey = (preset: GoalPresetId) => `tour:${preset}`;

/** FNV-1a (32-bit) as 8 hex digits: a staleness check, not a security hash. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The hash a stored version must carry to match today's original text and prompt. */
export function sourceHash(blocks: readonly Block[], mode: ToolMode, promptVersion: string = SECTION_PROMPT_VERSIONS[mode]): string {
  return hashText(JSON.stringify({ blocks, mode, v: promptVersion }));
}

const canonNumber = (n: string) => {
  const v = Number(n);
  return Number.isFinite(v) && n.length < 16 ? String(v) : n;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Latin-only boundaries: a Bengali or Hindi suffix may sit right against a kept name.
function nameRe(name: string, flags: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`, flags);
}

/**
 * Whether a rewrite (plain English or a translation) keeps what the original
 * states. It is rejected when it is empty, when a number of the original is
 * missing (digits in any script count: '৮৬' keeps '86'), or when a name from
 * `names` (projects, technologies, companies, schools) that the original writes
 * is missing. Returns the first problem ('number:86', 'name:Mindrift') or null.
 */
export function checkTranslation(source: string, output: string, names: readonly string[]): string | null {
  if (typeof output !== 'string' || !output.trim()) return 'empty';
  const have = new Set(numbersIn(output).map(canonNumber));
  for (const n of numbersIn(source)) {
    if (!have.has(canonNumber(n))) return `number:${n}`;
  }
  for (const name of new Set(names)) {
    if (typeof name !== 'string' || name.trim().length < 2) continue;
    if (nameRe(name, '').test(source) && !nameRe(name, 'i').test(output)) return `name:${name}`;
  }
  return null;
}

/**
 * A stored or generated version checked against its original: the same number
 * of blocks, a heading wherever the original has one, and checkTranslation on
 * every block. Returns the blocks, or the first problem as a string.
 */
export function checkBlocks(source: readonly Block[], output: unknown, names: readonly string[]): Block[] | string {
  if (!Array.isArray(output) || output.length !== source.length) return 'shape';
  const out: Block[] = [];
  for (let i = 0; i < source.length; i++) {
    const o = output[i] as { heading?: unknown; text?: unknown } | null;
    if (!o || typeof o !== 'object' || typeof o.text !== 'string') return 'shape';
    const src = source[i];
    if (src.heading !== undefined && (typeof o.heading !== 'string' || !o.heading.trim())) return 'shape';
    const heading = src.heading !== undefined ? String(o.heading).trim() : undefined;
    const problem =
      checkTranslation(src.text, o.text, names) ?? (heading !== undefined ? checkTranslation(src.heading ?? '', heading, names) : null);
    if (problem) return problem;
    out.push(heading !== undefined ? { heading, text: o.text.trim() } : { text: o.text.trim() });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Inputs, built the same way by the route, the components and the generator
 * ------------------------------------------------------------------------- */

type RawProfile = {
  about: string;
  experience: readonly { company: string; role: string; duration: string; description: string }[];
  skills: Readonly<Record<string, readonly string[]>>;
  availability: { status: string; focus: string; openTo: string };
};

export type DiscoveryInputs = {
  profile: RawProfile;
  projects: readonly { slug: string; name: string; tagline: string; featured?: boolean }[];
  sections: readonly { id: SectionId; label: string }[];
  sectionCopy: readonly CopyLine[];
  tenets: readonly { title: string; body: string }[];
  contact: string;
};

export function tourCatalogOf(src: Pick<DiscoveryInputs, 'profile' | 'projects'>): TourCatalog {
  return { slugs: src.projects.map((p) => p.slug), expCount: src.profile.experience.length };
}

export function tourDataOf(src: DiscoveryInputs): TourData {
  return {
    about: src.profile.about,
    projects: src.projects.map(({ slug, name, tagline }) => ({ slug, name, tagline })),
    experience: src.profile.experience.map(({ company, role, duration }) => ({ company, role, duration })),
    sections: src.sections,
    sectionCopy: src.sectionCopy,
    contact: src.contact,
    skillGroups: Object.keys(src.profile.skills),
  };
}

export function sectionSourceOf(src: Pick<DiscoveryInputs, 'profile' | 'sectionCopy' | 'tenets' | 'contact'>): SectionSource {
  const subtitle = (id: SectionId) => src.sectionCopy.find((c) => c.section === id && c.kind === 'subtitle')?.text ?? '';
  return {
    about: src.profile.about,
    experience: src.profile.experience,
    experienceSubtitle: subtitle('experience'),
    philosophySubtitle: subtitle('philosophy'),
    tenets: src.tenets,
    contact: src.contact,
    availability: src.profile.availability,
  };
}

/** Every stop with its line, in catalogue order: the menu the tour model chooses from. */
export function stopViews(src: DiscoveryInputs): TourStopView[] {
  const data = tourDataOf(src);
  return stopIds(tourCatalogOf(src))
    .map((id) => tourLine(id, data))
    .filter((s): s is TourStopView => s !== null);
}

/* ---------------------------------------------------------------------------
 * Smart 404: what a mistyped or outdated path most likely meant
 * ------------------------------------------------------------------------- */

export type SuggestCatalog = {
  projects: readonly { slug: string; name: string; caseStudy: boolean }[];
  sections: readonly { id: SectionId; label: string }[];
};

export type PathSuggestion = { kind: 'project' | 'section'; href: string; label: string; score: number };

function segmentsOf(pathname: string): string[] {
  const path = String(pathname ?? '')
    .split(/[?#]/)[0]
    .slice(0, 300);
  return path
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .map((s) =>
      s
        .toLowerCase()
        .replace(/\.[a-z0-9]{1,5}$/, '')
        .replace(/[\s_.+]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean);
}

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/** How well one path segment names a candidate slug (0 = not at all). */
function matchScore(seg: string, key: string): number {
  if (seg.length < 3) return seg === key ? 100 : 0;
  if (seg === key) return 100;
  if (key.startsWith(seg)) return 90 - Math.min(20, key.length - seg.length);
  if (seg.startsWith(key) && key.length >= 3) return 80;
  if (seg.length >= 4 && key.includes(seg)) return 70;
  const cap = Math.max(1, Math.floor(key.length / 5));
  const d = levenshtein(seg, key, cap);
  if (d <= cap) return 60 - d;
  const segTokens = seg.split('-').filter((t) => t.length >= 3);
  const keyTokens = new Set(key.split('-'));
  const shared = segTokens.filter((t) => keyTokens.has(t)).length;
  return shared ? 40 + 5 * shared : 0;
}

/**
 * Up to `limit` pages a 404 path probably meant, best first, with no request:
 * the last path segment is matched against project slugs and section ids (exact,
 * prefix, contained, or within a small edit distance), so '/projects/urbancare'
 * suggests '/projects/urbancare-ai'. Earlier segments are tried only when the
 * last one matches nothing.
 */
export function suggestForPath(pathname: string, cat: SuggestCatalog, limit = 3): PathSuggestion[] {
  const segs = segmentsOf(pathname);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    const found: PathSuggestion[] = [];
    for (const p of cat.projects) {
      const score = matchScore(seg, p.slug);
      if (score > 0) {
        found.push({ kind: 'project', href: p.caseStudy ? `/projects/${p.slug}` : `/?project=${p.slug}`, label: p.name, score });
      }
    }
    for (const s of cat.sections) {
      const score = Math.max(matchScore(seg, s.id), matchScore(seg, s.label.toLowerCase()));
      if (score > 0) found.push({ kind: 'section', href: `/#${s.id}`, label: s.label, score });
    }
    if (found.length) return found.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
  }
  return [];
}

/** The words of a path, for a retrieval query: '/projects/urban-care' -> 'projects urban care'. */
export function pathQuery(pathname: string): string {
  return segmentsOf(pathname).join(' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
