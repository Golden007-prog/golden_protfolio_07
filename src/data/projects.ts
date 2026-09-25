import { countByTech, matchesTech, techFamily } from '@/lib/tech';
import facts from './github-facts.json';
import projectsJson from './projects.json';

export type Project = {
  name: string;
  /** slugify(name); the key for ?project=, /projects/<slug> and the media folders. */
  slug: string;
  tagline: string;
  shortDescription: string;
  fullDescription: string;
  language: string;
  techStack: string[];
  topics: string[];
  stars: number;
  forks: number;
  githubUrl: string;
  liveUrl: string | null;
  featured: boolean;
  category: string;
  /** Self-hosted 16:10 still under /images/projects/<slug>/. */
  thumbnail: string;
  /** Generated artwork shown when the still fails to load. */
  fallbackThumbnail: string;
  /** Muted H.264 loop under /videos/projects/<slug>/, for animated sources only. */
  demoVideo?: string;
  problem?: string;
  solution?: string;
  challenges?: { challenge: string; solution: string }[];
  lessons?: string;
  metrics?: { value: string; label: string }[];
};

export type GithubFacts = {
  stars: number;
  forks: number;
  /** ISO timestamp of the last push. */
  pushedAt: string | null;
  /** SPDX id, only when GitHub recognised a licence. */
  license: string | null;
};

export const PROJECTS: readonly Project[] = projectsJson satisfies readonly Project[];

const FACTS: Readonly<Record<string, GithubFacts>> = facts satisfies Record<string, GithubFacts>;

const BY_SLUG = new Map(PROJECTS.map((p) => [p.slug, p]));

export function getProjectBySlug(slug: string | null | undefined): Project | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

/**
 * A ?project= value to a project: the exact slug, else the one project whose slug
 * starts with it as a whole word ('urbancare' -> 'urbancare-ai').
 */
export function resolveProject(param: string | null | undefined): Project | undefined {
  if (!param) return undefined;
  const key = param.trim().toLowerCase();
  const exact = BY_SLUG.get(key);
  if (exact) return exact;
  const prefixed = PROJECTS.filter((p) => p.slug.startsWith(`${key}-`));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

export function githubFacts(slug: string): GithubFacts | undefined {
  return FACTS[slug];
}

/** Categories in first-seen order. */
export const CATEGORIES: readonly string[] = [...new Set(PROJECTS.map((p) => p.category))];

export type TechFacet = { name: string; count: number };

/** Every tech family with the number of projects using it, most used first. */
export function allTech(items: readonly Project[] = PROJECTS): TechFacet[] {
  const families = new Set(items.flatMap((p) => p.techStack.map(techFamily)));
  return [...families]
    .map((name) => ({ name, count: countByTech(items, name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** A case study needs a real problem statement and approach, not just a description. */
export function hasCaseStudy(p: Project): p is Project & { problem: string; solution: string } {
  return Boolean(p.problem && p.solution);
}

/** Projects sharing tech families or topics with `slug`, strongest overlap first. */
export function relatedTo(slug: string, limit = 3): Project[] {
  const self = BY_SLUG.get(slug);
  if (!self) return [];
  const families = new Set(self.techStack.map(techFamily));
  const topics = new Set(self.topics);
  return PROJECTS.filter((p) => p.slug !== slug)
    .map((p, order) => {
      const tech = [...new Set(p.techStack.map(techFamily))].filter((f) => families.has(f)).length;
      const shared = p.topics.filter((t) => topics.has(t)).length;
      return { p, order, score: tech + shared * 2 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.p);
}

/** Tech families of one project that other projects also use, for 'More with X (n)'. */
export function sharedTech(p: Project): TechFacet[] {
  const families = [...new Set(p.techStack.map(techFamily))];
  return families
    .map((name) => ({ name, count: countByTech(PROJECTS, name) }))
    .filter((f) => f.count > 1);
}

export type ProjectFilter = { q: string; cat: string | null; tech: string | null; live: boolean };

function searchable(p: Project): string {
  return [p.name, p.tagline, ...p.techStack, ...p.topics].join(' ').toLowerCase();
}

/** Every whitespace-separated term must appear in the name, tagline, stack or topics. */
export function matchesQuery(p: Project, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = searchable(p);
  return terms.every((t) => text.includes(t));
}

export function filterProjects(items: readonly Project[], f: ProjectFilter, skip?: keyof ProjectFilter): Project[] {
  return items.filter(
    (p) =>
      (skip === 'q' || matchesQuery(p, f.q)) &&
      (skip === 'cat' || !f.cat || p.category === f.cat) &&
      (skip === 'tech' || !f.tech || matchesTech(p.techStack, f.tech)) &&
      (skip === 'live' || !f.live || Boolean(p.liveUrl)),
  );
}

/** Grid footprint at lg (6 columns): lead 4x2, wide 3, normal 2. */
export type BentoSize = 'lead' | 'wide' | 'normal';
export type BentoSlot = { project: Project; size: BentoSize };

/**
 * Splits `items` into full 6-column rows: pairs of wide cards (3+3) and triples of
 * normal cards (2+2+2), giving the wide slots to featured work first.
 */
function bentoRows(items: readonly Project[]): BentoSlot[] {
  const m = items.length;
  const featured = items.filter((p) => p.featured).length;
  let pairs = -1;
  for (let a = 0; 2 * a <= m; a++) {
    if ((m - 2 * a) % 3 !== 0) continue;
    if (pairs < 0 || Math.abs(2 * a - featured) < Math.abs(2 * pairs - featured)) pairs = a;
  }
  if (pairs < 0) return items.map((project) => ({ project, size: 'wide' }));
  const ordered = [...items.filter((p) => p.featured), ...items.filter((p) => !p.featured)];
  return ordered.map((project, i) => ({ project, size: i < 2 * pairs ? 'wide' : 'normal' }));
}

/**
 * Bento order for the lg grid, in reading order so the tab order follows the
 * layout: the first featured project leads (4 columns by 2 rows) with two normal
 * cards beside it, then whole rows. Every row adds up to 6 columns, so the grid
 * has no holes; only one or two cards on their own leave a short last row.
 */
export function bentoLayout(items: readonly Project[]): BentoSlot[] {
  const n = items.length;
  if (n <= 2 || n === 4) return items.map((project) => ({ project, size: 'wide' }));
  const lead = items.find((p) => p.featured);
  if (!lead) return bentoRows(items);
  const rest = items.filter((p) => p !== lead);
  const side = [...rest.filter((p) => !p.featured), ...rest.filter((p) => p.featured)].slice(0, 2);
  return [
    { project: lead, size: 'lead' },
    ...side.map((project): BentoSlot => ({ project, size: 'normal' })),
    ...bentoRows(rest.filter((p) => !side.includes(p))),
  ];
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** 'ten' for 10; digits past twelve. */
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}
