import profile from '../data/profile.json';
import projectsData from '../data/projects.json';
import index from '../data/skills-index.json';
import { projectCounts, projectSlug, projectsForSkill } from './skillProjects';
import { slugify } from './slug';
import type { Skill, SkillAccent, SkillDetail, SkillIndexEntry, SkillNode, SkillProjectRef } from '../types/skills';

type ProjectData = {
  name: string;
  slug?: string;
  tagline?: string;
  techStack: string[];
  githubUrl?: string | null;
  liveUrl?: string | null;
};

const PROJECTS = projectsData as unknown as readonly ProjectData[];
const GROUPS = profile.skills as Record<string, string[]>;

export const ACCENT_MAP: Record<string, SkillAccent> = {
  'GenAI & LLMs': 'violet',
  'Agentic AI': 'cyan',
  'Data Science & ML': 'amber',
  'Analytics & Viz': 'pink',
  Infrastructure: 'violet',
};

/** Category names in profile.json order. */
export const CATEGORIES: readonly string[] = Object.keys(GROUPS);

const entries = new Map((index as SkillIndexEntry[]).map((e) => [e.name, e]));

/** Every skill, in profile.json order. The slug (and so the hero path) is derived here, never stored. */
export const SKILLS: readonly Skill[] = CATEGORIES.flatMap((category) =>
  GROUPS[category].map((name): Skill => {
    const entry = entries.get(name);
    const slug = slugify(name);
    return {
      name,
      slug,
      category,
      accent: ACCENT_MAP[category] ?? 'violet',
      term: entry?.term ?? name,
      def: entry?.def ?? '',
      heroImage: entry?.hero ? `/skills/${slug}.webp` : null,
    };
  }),
);

const bySlug = new Map(SKILLS.map((s) => [s.slug, s]));
const byLowerName = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s]));

/** A skill by exact name, case-insensitive name or slug ('RAG', 'rag', 'jax-tunix'). */
export function findSkill(nameOrSlug: string | null | undefined): Skill | undefined {
  if (!nameOrSlug) return undefined;
  const key = nameOrSlug.trim();
  return bySlug.get(key) ?? byLowerName.get(key.toLowerCase()) ?? bySlug.get(slugify(key));
}

/** How many projects use each skill; skills with none are absent. */
export const PROJECT_COUNTS: Readonly<Record<string, number>> = projectCounts(
  PROJECTS,
  SKILLS.map((s) => s.name),
);

export function projectsUsing(skill: string): SkillProjectRef[] {
  return projectsForSkill(PROJECTS, skill).map((p) => ({
    name: p.name,
    slug: projectSlug(p),
    tagline: p.tagline ?? '',
    githubUrl: p.githubUrl || null,
    liveUrl: p.liveUrl || null,
  }));
}

/* ---- on-demand write-ups (public/data/skills/<slug>.json) ---- */

const detailRequests = new Map<string, Promise<SkillDetail>>();
const detailCache = new Map<string, SkillDetail>();

/** Fetches a skill's write-up once per page; a failed request is forgotten so it can be retried. */
export function loadSkillDetail(slug: string): Promise<SkillDetail> {
  let pending = detailRequests.get(slug);
  if (!pending) {
    pending = fetch(`/data/skills/${encodeURIComponent(slug)}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SkillDetail>;
      })
      .then((detail) => {
        detailCache.set(slug, detail);
        return detail;
      });
    pending.catch(() => detailRequests.delete(slug));
    detailRequests.set(slug, pending);
  }
  return pending;
}

/** The write-up if it has already arrived. */
export function peekSkillDetail(slug: string): SkillDetail | undefined {
  return detailCache.get(slug);
}

/* ---- search ---- */

export function matchesQuery(skill: Skill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    skill.name.toLowerCase().includes(q) ||
    skill.category.toLowerCase().includes(q) ||
    skill.def.toLowerCase().includes(q)
  );
}

/** Splits a label around case-insensitive matches of the query, for <mark> highlighting. */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) parts.push({ text: text.slice(at, i), match: false });
    parts.push({ text: text.slice(i, i + needle.length), match: true });
    at = i + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}

/* ---- sphere and constellation nodes ---- */

export const NODES_PER_CATEGORY = 4;

/** Fibonacci-sphere unit vectors: an even spread with no poles crowding. */
function fibonacciSphere(n: number): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    return [Math.cos(theta) * r, y, Math.sin(theta) * r];
  });
}

/**
 * The top skills of each category, ranked by how many projects use them (then by
 * profile order). They are dealt round-robin across categories so every colour
 * spreads over the whole sphere. On the constellation each category is one row of
 * stars, ordered and nudged by where its nodes sit on the sphere.
 */
function buildNodes(): SkillNode[] {
  const ranked = CATEGORIES.map((category) =>
    SKILLS.map((s, i) => ({ s, i }))
      .filter(({ s }) => s.category === category)
      .sort((a, b) => (PROJECT_COUNTS[b.s.name] ?? 0) - (PROJECT_COUNTS[a.s.name] ?? 0) || a.i - b.i)
      .slice(0, NODES_PER_CATEGORY)
      .map(({ s }) => s),
  );
  const dealt: Skill[] = [];
  for (let k = 0; k < NODES_PER_CATEGORY; k++) {
    for (const row of ranked) if (row[k]) dealt.push(row[k]);
  }
  const dirs = fibonacciSphere(dealt.length);
  const withDir = dealt.map((s, i) => ({ s, dir: dirs[i] }));

  const rows = CATEGORIES.length;
  return withDir.map(({ s, dir }) => {
    const row = CATEGORIES.indexOf(s.category);
    const siblings = withDir.filter((n) => n.s.category === s.category).sort((a, b) => a.dir[0] - b.dir[0]);
    const col = siblings.findIndex((n) => n.s === s);
    const cols = siblings.length;
    // Cells keep a 44px target and a two-line label clear of their neighbours at 320px.
    const x = cols > 1 ? 0.16 + (col / (cols - 1)) * 0.68 + dir[2] * 0.03 : 0.5;
    const y = 0.1 + (row / Math.max(1, rows - 1)) * 0.74 + dir[1] * 0.035;
    return { ...s, dir, x, y };
  });
}

export const SKILL_NODES: readonly SkillNode[] = buildNodes();

/** Every character the sphere labels use, for the font preload. */
export const NODE_CHARACTERS = Array.from(new Set(SKILL_NODES.map((n) => n.name).join(''))).join('');
