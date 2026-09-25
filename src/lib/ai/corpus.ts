/*
 * The grounding corpus: every fact the AI may state about Oikantik, cut into
 * small citable chunks with stable ids. Built from src/data plus the component
 * copy in src/data/site-copy.ts, which callers pass in (pure: no JSON imports,
 * relative .ts imports), so the build script, the server and node --test all
 * run the same code.
 *
 * Classes: 'self' chunks are evidence. 'reference' chunks are the generic skill
 * encyclopedia (written by Gemini from web search) and describe a technology,
 * never his use of it. 'live' chunks carry their capture date. Both 'reference'
 * and 'live' chunks are untrusted and are wrapped as data in prompts.
 *
 * Deliberately left out: profile.stats (the About section withholds
 * yearsExperience because the listed roles add up to about 1.5 years), the phone
 * number, project media paths, and the latest commit's message and URL.
 */
import type { AiTarget, EvidenceClass } from './protocol.ts';
import { slugify } from '../slug.ts';
import { techFamily } from '../tech.ts';

export type Chunk = {
  id: string;
  /** Embedding title and prompt heading. */
  title: string;
  /** Short human label for citation chips and footnotes. */
  label: string;
  text: string;
  cls: EvidenceClass;
  target: AiTarget;
  /** ISO date the data was captured, for 'live' chunks and GitHub facts. */
  asOf?: string;
  untrusted: boolean;
  /** Content hash; embeddings are regenerated only when it changes. */
  hash: string;
};

/* ---------------------------------------------------------------------------
 * Input shapes (structural, so the JSON files satisfy them directly)
 * ------------------------------------------------------------------------- */

export type CorpusExperience = {
  company: string;
  role: string;
  duration: string;
  start?: string | null;
  end?: string | null;
  location?: string;
  description: string;
  highlights?: readonly string[];
  metrics?: readonly { value: string; label: string }[];
};

export type CorpusEducation = {
  institution: string;
  degree: string;
  year: string;
  start?: string | null;
  end?: string | null;
  status: string;
};

export type CorpusProfile = {
  name: string;
  headline: string;
  location: string;
  email: string;
  about: string;
  links: Readonly<Record<string, string>>;
  availability: { status: string; focus: string; openTo: string };
  experience: readonly CorpusExperience[];
  education: readonly CorpusEducation[];
  skills: Readonly<Record<string, readonly string[]>>;
  certifications?: readonly unknown[];
};

export type CorpusProject = {
  name: string;
  slug: string;
  tagline: string;
  shortDescription: string;
  fullDescription: string;
  language: string;
  techStack: readonly string[];
  topics: readonly string[];
  githubUrl: string;
  liveUrl: string | null;
  featured: boolean;
  category: string;
  problem?: string;
  solution?: string;
  lessons?: string;
  challenges?: readonly { challenge: string; solution: string }[];
  metrics?: readonly { value: string; label: string }[];
};

export type CorpusGithubFacts = Readonly<
  Record<string, { stars: number; forks: number; pushedAt: string | null; license: string | null }>
>;

export type CorpusReading = { title: string; authors: string; year: string; kind: string; tag: string; note: string; url: string };

export type CorpusTool = { icon?: string; label: string; value: string };

export type CorpusSkillIndex = { name: string; category: string; term?: string; def: string };

export type CorpusLiveSnapshot = {
  generatedAt?: string;
  github?: {
    latestPush?: { repo: string; url?: string; message?: string; createdAt: string } | null;
  } | null;
  leetcode?: {
    username: string;
    totalSolved: number;
    easy: number;
    medium: number;
    hard: number;
    ranking?: number;
    streak?: number;
    totalActiveDays?: number;
  } | null;
};

export type CorpusSiteCopy = {
  philosophy: readonly { n: string; title: string; body: string }[];
  roles: readonly string[];
  hero: string;
  contact: string;
};

export type CorpusSources = {
  profile: CorpusProfile;
  projects: readonly CorpusProject[];
  githubFacts: CorpusGithubFacts;
  reading: readonly CorpusReading[];
  tools: readonly CorpusTool[];
  skillsIndex: readonly CorpusSkillIndex[];
  liveSnapshot: CorpusLiveSnapshot | null;
  siteCopy: CorpusSiteCopy;
};

/* ---------------------------------------------------------------------------
 * Hashing (pure JS, identical in Node, the browser and the build script)
 * ------------------------------------------------------------------------- */

/** cyrb53: a fast 53-bit string hash, as 14 hex digits. Not cryptographic. */
export function hashText(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

/* ---------------------------------------------------------------------------
 * Chunk builders
 * ------------------------------------------------------------------------- */

/** The ids packContext() always includes: who he is, how to reach him, and the status of both degrees. */
export const CORE_CARD_IDS: readonly string[] = ['profile:about', 'profile:availability', 'edu:0', 'edu:1'];

/** Chunks rebuilt from build-time fetches (GitHub facts, live snapshot); the freshness gate ignores them. */
export const VOLATILE_PREFIXES: readonly string[] = ['live:', 'facts:'];

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function isoDay(iso: string | null | undefined): string | undefined {
  if (typeof iso !== 'string') return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : undefined;
}

type Draft = Omit<Chunk, 'hash' | 'untrusted'> & { untrusted?: boolean };

function finish(d: Draft): Chunk {
  const untrusted = d.untrusted ?? d.cls !== 'self';
  const chunk: Chunk = {
    id: d.id,
    title: d.title,
    label: d.label,
    text: d.text.replace(/\s+/g, ' ').trim(),
    cls: d.cls,
    target: d.target,
    untrusted,
    hash: '',
  };
  if (d.asOf) chunk.asOf = d.asOf;
  chunk.hash = hashText(`${chunk.id}\n${chunk.cls}\n${chunk.title}\n${chunk.text}`);
  return chunk;
}

function roleLine(e: CorpusExperience): string {
  return `${e.role} at ${e.company} (${e.duration})`;
}

function profileChunks(profile: CorpusProfile): Draft[] {
  const roles = profile.experience.map(roleLine).join('; ');
  const schooling = profile.education.map((e) => `${e.degree}, ${e.institution} (${e.year}; ${e.status})`).join('; ');
  const certs = profile.certifications?.length ? '' : ' No certifications are listed on this site.';
  return [
    {
      id: 'profile:about',
      title: `About ${profile.name}`,
      label: 'About',
      text:
        `${profile.name}: ${profile.headline}. Based in ${profile.location}. ${sentence(profile.about)} ` +
        `Roles listed on this site: ${roles}. Education: ${schooling}.${certs}`,
      cls: 'self',
      target: { kind: 'section', id: 'about' },
    },
    {
      id: 'profile:availability',
      title: `${profile.name}: availability`,
      label: 'Availability',
      text:
        `Status: ${profile.availability.status}. Focus: ${profile.availability.focus}. ` +
        `Open to: ${profile.availability.openTo}. Location: ${profile.location}. Email: ${profile.email}.`,
      cls: 'self',
      target: { kind: 'section', id: 'about' },
    },
  ];
}

function experienceChunks(profile: CorpusProfile): Draft[] {
  const out: Draft[] = [];
  profile.experience.forEach((e, i) => {
    const where = e.location ? `, ${e.location}` : '';
    out.push({
      id: `exp:${i}`,
      title: `${e.role} at ${e.company}`,
      label: `${e.company} · ${e.role}`,
      text: `${roleLine(e)}${where}. ${sentence(e.description)}`,
      cls: 'self',
      target: { kind: 'experience', index: i },
    });
    (e.highlights ?? []).forEach((h, j) => {
      out.push({
        id: `exp:${i}#h${j}`,
        title: `${e.company}: highlight`,
        label: `${e.company} · highlight ${j + 1}`,
        text: `${sentence(h)} (A highlight of the ${e.role} role at ${e.company}.)`,
        cls: 'self',
        target: { kind: 'experience', index: i },
      });
    });
    (e.metrics ?? []).forEach((m, j) => {
      out.push({
        id: `exp:${i}#m${j}`,
        title: `${e.company}: ${m.label}`,
        label: `${e.company} · ${m.value} ${m.label}`,
        text: `${m.value} ${m.label}: a figure listed for the ${e.role} role at ${e.company}.`,
        cls: 'self',
        target: { kind: 'experience', index: i },
      });
    });
  });
  return out;
}

function educationChunks(profile: CorpusProfile): Draft[] {
  return profile.education.map((e, i) => {
    const pending = /in progress|pursuing|ongoing/i.test(e.status);
    const note = pending ? ' Not yet completed.' : '';
    return {
      id: `edu:${i}`,
      title: `${e.degree}, ${e.institution}`,
      label: `${e.degree}`,
      text: `${e.degree} at ${e.institution}, ${e.year}. Status: ${e.status}.${note}`,
      cls: 'self' as const,
      target: { kind: 'education', index: i } as const,
    };
  });
}

function skillChunks(profile: CorpusProfile): Draft[] {
  return Object.entries(profile.skills).map(([category, list]) => ({
    id: `skills:${slugify(category)}`,
    title: `Skills: ${category}`,
    label: `Skills · ${category}`,
    text: `Skills Oikantik lists under ${category}: ${list.join(', ')}.`,
    cls: 'self' as const,
    target: { kind: 'section', id: 'skills' } as const,
  }));
}

function projectChunks(projects: readonly CorpusProject[]): Draft[] {
  const out: Draft[] = [];
  for (const p of projects) {
    const target = { kind: 'project', slug: p.slug } as const;
    const part = (key: string, label: string, text: string | undefined): void => {
      if (!text || !text.trim()) return;
      out.push({
        id: `project:${p.slug}#${key}`,
        title: `${p.name}: ${label}`,
        label: `${p.name} · ${label}`,
        text,
        cls: 'self',
        target,
      });
    };
    part('tagline', 'Tagline', `${p.name}: ${sentence(p.tagline)}`);
    part('summary', 'Summary', `${p.name}: ${p.shortDescription}`);
    part('full', 'Details', `${p.name}: ${p.fullDescription}`);
    part('problem', 'Problem', p.problem && `${p.name}, the problem: ${p.problem}`);
    const challenges = (p.challenges ?? []).map((c) => `${c.challenge} ${c.solution}`).join(' ');
    part('solution', 'Solution', p.solution && `${p.name}, the solution: ${p.solution}${challenges ? ` ${challenges}` : ''}`);
    part('lessons', 'Lessons', p.lessons && `${p.name}, lessons learned: ${p.lessons}`);
    const metrics = (p.metrics ?? []).map((m) => `${m.value} ${m.label}`).join('; ');
    const links = [`Source code: ${p.githubUrl}.`, p.liveUrl ? `Live demo: ${p.liveUrl}.` : 'No live demo is listed.'].join(' ');
    part(
      'stack',
      'Stack',
      `${p.name} tech stack: ${p.techStack.join(', ')}. Primary language: ${p.language}. Category: ${p.category}. ` +
        `Topics: ${p.topics.join(', ')}.${p.featured ? ' A featured project.' : ''}${metrics ? ` Metrics: ${metrics}.` : ''} ${links}`,
    );
  }
  return out;
}

function factChunks(projects: readonly CorpusProject[], facts: CorpusGithubFacts): Draft[] {
  const out: Draft[] = [];
  for (const p of projects) {
    const f = facts[p.slug];
    if (!f) continue;
    const pushed = isoDay(f.pushedAt);
    out.push({
      id: `facts:${p.slug}`,
      title: `${p.name}: GitHub repository facts`,
      label: `${p.name} · GitHub`,
      text:
        `${p.name} GitHub repository: ${f.stars} ${f.stars === 1 ? 'star' : 'stars'}, ${f.forks} ${f.forks === 1 ? 'fork' : 'forks'}` +
        `${pushed ? `, last push ${pushed}` : ''}. ${f.license ? `Licence: ${f.license}.` : 'No licence recognised by GitHub.'}`,
      cls: 'self',
      target: { kind: 'project', slug: p.slug },
      ...(pushed ? { asOf: pushed } : {}),
    });
  }
  return out;
}

function readingChunks(reading: readonly CorpusReading[]): Draft[] {
  return reading.map((r, i) => ({
    id: `reading:${i}`,
    title: `Reading list: ${r.title}`,
    label: `Reading · ${r.title}`,
    text: `On Oikantik's reading list (${r.kind}, ${r.tag}): "${r.title}" by ${r.authors}, ${r.year}. His note: ${r.note} ${r.url}`,
    cls: 'self' as const,
    target: { kind: 'reading', index: i } as const,
  }));
}

function toolChunks(tools: readonly CorpusTool[]): Draft[] {
  return tools.map((t, i) => ({
    id: `tool:${i}`,
    title: `Daily setup: ${t.label}`,
    label: `Setup · ${t.label}`,
    text: `Oikantik's daily setup, ${t.label}: ${t.value}.`,
    cls: 'self' as const,
    target: { kind: 'section', id: 'skills' } as const,
  }));
}

function copyChunks(copy: CorpusSiteCopy): Draft[] {
  const out: Draft[] = copy.philosophy.map((t, i) => ({
    id: `copy:philosophy#${i}`,
    title: `Working principle ${t.n}: ${t.title}`,
    label: `Principle ${t.n} · ${t.title}`,
    text: `Working principle ${t.n}, in Oikantik's words: ${t.title} ${t.body}`,
    cls: 'self' as const,
    target: { kind: 'tenet', index: i } as const,
  }));
  out.push(
    {
      id: 'copy:roles',
      title: 'Roles named in the hero',
      label: 'Hero · roles',
      text: `The site's hero names these roles: ${copy.roles.join('; ')}.`,
      cls: 'self',
      target: { kind: 'section', id: 'about' },
    },
    {
      id: 'copy:hero',
      title: 'Hero tagline',
      label: 'Hero · tagline',
      text: `The site's hero tagline: ${copy.hero}`,
      cls: 'self',
      target: { kind: 'section', id: 'about' },
    },
    {
      id: 'copy:contact',
      title: 'Contact section',
      label: 'Contact',
      text: `From the contact section, in Oikantik's words: ${copy.contact}`,
      cls: 'self',
      target: { kind: 'section', id: 'contact' },
    },
  );
  return out;
}

function referenceChunks(skillsIndex: readonly CorpusSkillIndex[]): Draft[] {
  const seen = new Set<string>();
  const out: Draft[] = [];
  for (const s of skillsIndex) {
    const slug = slugify(s.name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const def = stripTags(`${s.term ?? s.name}${s.def}`);
    out.push({
      id: `ref:${slug}`,
      title: `${s.name} (general reference)`,
      label: `${s.name} · reference`,
      text: `General description of ${s.name}, not of Oikantik's use of it: ${sentence(def)}`,
      cls: 'reference',
      target: { kind: 'skill', name: s.name },
      untrusted: true,
    });
  }
  return out;
}

function liveChunks(snapshot: CorpusLiveSnapshot | null): Draft[] {
  if (!snapshot) return [];
  const asOf = isoDay(snapshot.generatedAt);
  const out: Draft[] = [];
  const lc = snapshot.leetcode;
  if (lc && typeof lc.totalSolved === 'number') {
    // LeetCode's userCalendar.streak is the longest run of active days, not a
    // run still going today; calling it "current" hands the model a false fact.
    const extra = [
      typeof lc.streak === 'number' ? `longest streak ${lc.streak} days (not a current streak)` : '',
      typeof lc.totalActiveDays === 'number' ? `${lc.totalActiveDays} active days` : '',
      typeof lc.ranking === 'number' ? `ranking ${lc.ranking}` : '',
    ].filter(Boolean);
    out.push({
      id: 'live:leetcode',
      title: 'LeetCode activity',
      label: 'LeetCode',
      text:
        `LeetCode profile ${lc.username}: ${lc.totalSolved} problems solved (${lc.easy} easy, ${lc.medium} medium, ${lc.hard} hard)` +
        `${extra.length ? `; ${extra.join(', ')}` : ''}.${asOf ? ` As of ${asOf}.` : ''}`,
      cls: 'live',
      target: { kind: 'section', id: 'experience' },
      ...(asOf ? { asOf } : {}),
      untrusted: true,
    });
  }
  // Only the repo name and the date: the commit message is free text from any
  // repository he pushes to, so it never enters a prompt.
  const push = snapshot.github?.latestPush;
  const pushedOn = isoDay(push?.createdAt);
  if (push && typeof push.repo === 'string' && pushedOn) {
    out.push({
      id: 'live:github',
      title: 'Latest public GitHub push',
      label: 'GitHub · latest push',
      text: `Latest public GitHub push: repository ${push.repo}, on ${pushedOn}.`,
      cls: 'live',
      target: { kind: 'section', id: 'experience' },
      asOf: pushedOn,
      untrusted: true,
    });
  }
  return out;
}

/**
 * Every chunk, in a stable order: profile, experience, education, skills,
 * projects, GitHub facts, reading, tools, site copy, references, live data.
 * Throws on a duplicate id, which would make citations ambiguous.
 */
export function buildCorpus(src: CorpusSources): Chunk[] {
  const drafts: Draft[] = [
    ...profileChunks(src.profile),
    ...experienceChunks(src.profile),
    ...educationChunks(src.profile),
    ...skillChunks(src.profile),
    ...projectChunks(src.projects),
    ...factChunks(src.projects, src.githubFacts),
    ...readingChunks(src.reading),
    ...toolChunks(src.tools),
    ...copyChunks(src.siteCopy),
    ...referenceChunks(src.skillsIndex),
    ...liveChunks(src.liveSnapshot),
  ];
  const seen = new Set<string>();
  return drafts.map((d) => {
    if (seen.has(d.id)) throw new Error(`Duplicate corpus id: ${d.id}`);
    seen.add(d.id);
    return finish(d);
  });
}

/** One hash over every chunk's hash, in order. */
export function corpusHash(chunks: readonly Pick<Chunk, 'hash'>[]): string {
  return hashText(chunks.map((c) => c.hash).join('|'));
}

/** corpusHash over the chunks that only change when src/data or site copy changes. */
export function stableHash(chunks: readonly Pick<Chunk, 'id' | 'hash'>[]): string {
  return corpusHash(chunks.filter((c) => !VOLATILE_PREFIXES.some((p) => c.id.startsWith(p))));
}

/* ---------------------------------------------------------------------------
 * Entities for the tripwires
 * ------------------------------------------------------------------------- */

export type Entities = {
  /** Employers exactly as listed. */
  companies: string[];
  institutions: string[];
  degrees: string[];
  /** Degrees whose status is in progress (the Master's). */
  inProgress: string[];
  certifications: string[];
  projectNames: string[];
  /** Listed skills. */
  skills: string[];
  /** Project stack entries and their tech families. */
  tech: string[];
  /** URLs the AI may repeat: profile links, repositories, demos, reading list, the site itself. */
  allowUrls: string[];
  allowEmails: string[];
};

export const SITE_ORIGINS: readonly string[] = ['https://basuoikantik.in', 'https://www.basuoikantik.in'];

export function entities(src: {
  profile: CorpusProfile;
  projects: readonly CorpusProject[];
  skills?: readonly { name: string }[];
  reading?: readonly { url: string }[];
}): Entities {
  const { profile, projects } = src;
  const uniq = (xs: Iterable<string>) => [...new Set([...xs].filter((x) => typeof x === 'string' && x.trim()))];
  const listed = Object.values(profile.skills).flat();
  return {
    companies: uniq(profile.experience.map((e) => e.company)),
    institutions: uniq(profile.education.map((e) => e.institution)),
    degrees: uniq(profile.education.map((e) => e.degree)),
    inProgress: uniq(profile.education.filter((e) => /in progress|pursuing|ongoing/i.test(e.status)).map((e) => e.degree)),
    certifications: uniq((profile.certifications ?? []).map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))),
    projectNames: uniq(projects.map((p) => p.name)),
    skills: uniq([...listed, ...(src.skills ?? []).map((s) => s.name)]),
    tech: uniq(projects.flatMap((p) => p.techStack.flatMap((t) => [t, techFamily(t)]))),
    allowUrls: uniq([
      ...SITE_ORIGINS,
      ...Object.values(profile.links),
      ...projects.flatMap((p) => [p.githubUrl, p.liveUrl ?? '']),
      ...(src.reading ?? []).map((r) => r.url),
    ]),
    allowEmails: uniq([profile.email]),
  };
}
