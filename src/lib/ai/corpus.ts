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
 * Credentials (certifications.json) and hackathon results (achievements.json)
 * are 'self' evidence: each is his, with a public verify page or his own post
 * behind it. They arrive already checked by parseCertifications and
 * parseAchievements.
 *
 * CoreForge (src/lib/coreforge/facts.ts) is 'self' evidence: his venture, in the
 * words of goldensdmat.in as captured, never with a price. Kaggle (the committed
 * snapshot) splits in two: the profile, badges and writeups are 'self'; each
 * competition is 'live' and untrusted, and any rank in it is stated as 'of N
 * teams, as of <date>'.
 *
 * Deliberately left out: profile.stats (the About section withholds
 * yearsExperience because the listed roles overlap and mix freelance with
 * WordPress work), the phone number, project media paths, and the latest
 * commit's message and URL.
 */
import type { AiTarget, EvidenceClass } from './protocol.ts';
import { ACHIEVEMENT_KIND_LABEL, allAchievements, type AchievementData } from '../achievements.ts';
import { certificationGroups, formatIssued, type Certification, type CertificationData, type CredentialKind } from '../certifications.ts';
import { slugify } from '../slug.ts';
import { techFamily } from '../tech.ts';
import { formatYearMonth } from '../../utils/dates.ts';

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
  /** The venture's own site, for a role that has one. */
  url?: string;
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

/** CoreForge, from src/lib/coreforge/facts.ts (see src/lib/coreforge/corpus.ts). */
export type CorpusCoreforge = {
  /** 'YYYY-MM-DD' the goldensdmat.in facts were captured. */
  capturedAt: string;
  company: string;
  product: string;
  tagline: string;
  domain: string;
  /** "Founder of GOLDEN's Coreforge" */
  founderLine: string;
  /** His LinkedIn title for the role ('Owner'). */
  linkedinTitle: string;
  sinceLabel: string;
  positioning: string;
  audience: string;
  freePlan: string;
  proSummary: string;
  disclaimer: string;
  features: readonly { id: string; title: string; body: string; plan?: 'pro' }[];
  resources: readonly { id: string; title: string; body: string }[];
  stats: readonly { display: string; label: string }[];
  generatorChecks: readonly { subtest: string; check: string }[];
  builtWith: readonly { name: string; role: string }[];
  changelog: readonly { date: string; title: string; summary: string }[];
  faq: readonly { id: string; q: string; a: string }[];
};

/** The Kaggle snapshot (src/lib/kaggle/snapshot.json); structural, so the JSON satisfies it. */
export type CorpusKaggle = {
  fetchedAt: string;
  profile: {
    userName: string;
    displayName: string;
    url: string;
    joined: string;
    tiers: readonly { category: string; tier: string }[];
    competitionPoints?: number;
    overallTier?: string;
  };
  badges: readonly { name: string; description: string; achieved: string; featured: boolean }[];
  writeups: readonly {
    title: string;
    subtitle: string;
    type: string;
    competition: string;
    url: string;
    published: string;
    excerpt?: string;
    project?: string;
  }[];
  active: readonly CorpusKaggleCompetition[];
  past: readonly CorpusKaggleCompetition[];
};

export type CorpusKaggleCompetition = {
  title: string;
  url: string;
  host: string;
  category: string;
  deadline: string;
  teams: number;
  userRank?: number;
  rankAsOf?: string;
  summary?: string;
  hasWriteup?: boolean;
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
  /** parseCertifications(certifications.json). Absent means none is listed. */
  certifications?: CertificationData | null;
  /** parseAchievements(achievements.json). */
  achievements?: AchievementData | null;
  /** His venture; absent means no CoreForge chunks. */
  coreforge?: CorpusCoreforge | null;
  /** The Kaggle snapshot; absent means no Kaggle chunks. */
  kaggle?: CorpusKaggle | null;
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

/**
 * 'self' chunks that retrieval finds but 'full' mode (jd-fit, which packs every
 * self chunk) leaves out: CoreForge's product detail and the Kaggle badge list.
 * They describe the product and platform activity, not his skills, and would push
 * the jd-fit prompt past its bound. The CoreForge overview and engineering chunks
 * and the Kaggle profile and writeups stay in.
 */
export const RETRIEVAL_ONLY_PREFIXES: readonly string[] = [
  'coreforge:features',
  'coreforge:plans',
  'coreforge:numbers',
  'coreforge:changelog',
  'coreforge:faq#',
  'kaggle:badges',
];

/** True for a chunk packContext's 'full' mode includes: every 'self' chunk except RETRIEVAL_ONLY_PREFIXES. */
export function inFullContext(c: Pick<Chunk, 'id' | 'cls'>): boolean {
  return c.cls === 'self' && !RETRIEVAL_ONLY_PREFIXES.some((p) => c.id.startsWith(p));
}

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

function listJoin(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const KIND_NOUN: Readonly<Record<CredentialKind, readonly [string, string]>> = {
  'course-completion-badge': ['course-completion badge', 'course-completion badges'],
  'professional-certificate': ['professional certificate', 'professional certificates'],
  'course-certificate': ['course certificate', 'course certificates'],
};

function kindNoun(kind: CredentialKind, n: number): string {
  return KIND_NOUN[kind][n === 1 ? 0 : 1];
}

/**
 * One line per credential group for the About chunk, so every answer's context
 * knows what is listed (and that nothing else is), whatever retrieval found.
 */
function credentialSummary(data: CertificationData | null | undefined): string {
  if (!data?.items.length) return ' No certifications are listed on this site.';
  const parts = certificationGroups(data).map((g) => {
    if (g.lead) {
      const courses = g.items.length ? `, with its ${g.items.length} ${kindNoun(g.items[0].kind, g.items.length)}` : '';
      return `the ${g.lead.title}, a ${kindNoun(g.lead.kind, 1)} from ${g.lead.issuer} on ${g.platform}${courses}`;
    }
    const kinds = [...new Set(g.items.map((c) => c.kind))];
    const noun = kinds.length === 1 ? kindNoun(kinds[0], g.items.length) : 'credentials';
    const badges = kinds.length === 1 && kinds[0] === 'course-completion-badge' ? ' (course badges, not certifications)' : '';
    return `${g.items.length} ${noun} from ${listJoin(g.issuers)} on ${g.platform}${badges}`;
  });
  return ` Credentials listed on this site, ${data.items.length} in all: ${parts.join('; ')}. No other certifications are listed.`;
}

function profileChunks(profile: CorpusProfile, certifications: CertificationData | null | undefined): Draft[] {
  const roles = profile.experience.map(roleLine).join('; ');
  const schooling = profile.education.map((e) => `${e.degree}, ${e.institution} (${e.year}; ${e.status})`).join('; ');
  const certs = credentialSummary(certifications);
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
    const site = e.url ? ` Website: ${e.url}.` : '';
    out.push({
      id: `exp:${i}`,
      title: `${e.role} at ${e.company}`,
      label: `${e.company} · ${e.role}`,
      text: `${roleLine(e)}${where}. ${sentence(e.description)}${site}`,
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

/** Credentials have their own section; a citation chip scrolls there. */
const CREDENTIAL_TARGET: AiTarget = { kind: 'section', id: 'certifications' };

/** 'Issued Sep 25, 2026: A (verify: …); B (verify: …). Issued Sep 15, 2026: …', newest first. */
function datedLines(items: readonly Certification[], withIssuer: boolean): string {
  const runs: { issued: string; lines: string[] }[] = [];
  for (const c of items) {
    const line = `${c.title} (${withIssuer ? `${c.issuer}, ` : ''}verify: ${c.url})`;
    const last = runs[runs.length - 1];
    if (last && last.issued === c.issued) last.lines.push(line);
    else runs.push({ issued: c.issued, lines: [line] });
  }
  return runs.map((r) => `Issued ${formatIssued(r.issued)}: ${r.lines.join('; ')}.`).join(' ');
}

/**
 * One chunk per credential group (certificationGroups): a professional certificate
 * with the courses it is made of, then each platform's other credentials. Every
 * credential appears once, with its issuer, platform, issue date and verify page.
 */
function certificationChunks(data: CertificationData | null | undefined): Draft[] {
  if (!data?.items.length) return [];
  const groups = certificationGroups(data);
  return groups.map((g) => {
    if (g.lead) {
      const lead = g.lead;
      const order = lead.includes ?? [];
      const items = [...g.items].sort((a, b) => {
        const x = order.indexOf(a.title);
        const y = order.indexOf(b.title);
        return (x < 0 ? order.length : x) - (y < 0 ? order.length : y);
      });
      const courses = items.length
        ? ` It is made up of ${items.length} ${kindNoun(items[0].kind, items.length)} from ${listJoin([...new Set(items.map((c) => c.issuer))])} on ${g.platform}. ${datedLines(items, false)}`
        : '';
      return {
        id: `cert:${g.id}`,
        title: `Credential: ${lead.title}`,
        label: `Credentials · ${lead.title}`,
        text:
          `Oikantik's ${lead.title}: a ${kindNoun(lead.kind, 1)} from ${lead.issuer} on ${g.platform}, ` +
          `issued ${formatIssued(lead.issued)} (verify: ${lead.url}).${courses}`,
        cls: 'self' as const,
        target: CREDENTIAL_TARGET,
      };
    }
    const kinds = [...new Set(g.items.map((c) => c.kind))];
    const noun = kinds.length === 1 ? kindNoun(kinds[0], g.items.length) : 'credentials';
    const badges = kinds.length === 1 && kinds[0] === 'course-completion-badge' ? ' (course badges, not certifications)' : '';
    const leads = groups.filter((o) => o.lead && o.platform === g.platform).map((o) => o.lead!.title);
    const apart = leads.length ? `, not part of the ${listJoin(leads)}` : '';
    return {
      id: `cert:${g.id}`,
      title: `Credentials: ${g.platform} (${g.issuers.join(', ')})`,
      label: `Credentials · ${g.platform}`,
      text:
        `Oikantik's ${g.platform} credentials: ${g.items.length} ${noun}${badges} from ${listJoin(g.issuers)} on ${g.platform}${apart}, ` +
        `each for one course and each with a public verify page. ${datedLines(g.items, g.issuers.length > 1)}`,
      cls: 'self' as const,
      target: CREDENTIAL_TARGET,
    };
  });
}

/**
 * One chunk per hackathon result or launch, worded as his own post words it: no
 * rank, prize or number beyond it, and teammates only as 'team of two'.
 */
function achievementChunks(data: AchievementData | null | undefined, projects: readonly CorpusProject[]): Draft[] {
  if (!data?.items.length) return [];
  const names = new Map(projects.map((p) => [p.slug, p.name]));
  return allAchievements(data).map((a) => {
    const kind = ACHIEVEMENT_KIND_LABEL[a.kind];
    const by = a.organizers?.length ? ` Organised by ${listJoin(a.organizers)}.` : '';
    const team = a.team ? ` As a ${a.team}.` : '';
    const name = a.project ? names.get(a.project) : undefined;
    const project = name ? ` Project on this site: ${name}.` : '';
    const links = a.links.map((l) => `${l.label}: ${l.url}`).join('; ');
    // The results list sits in the Experience section; one tied to a project opens that project.
    const target: AiTarget = name && a.project ? { kind: 'project', slug: a.project } : { kind: 'section', id: 'experience' };
    return {
      id: `achievement:${a.id}`,
      title: a.title,
      label: a.title,
      text: `From Oikantik's own posts, ${formatYearMonth(a.date)} (${kind.toLowerCase()}): ${a.title}.${by}${team} ${sentence(a.summary)}${project} Links: ${links}.`,
      cls: 'self' as const,
      target,
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

const COREFORGE_TARGET: AiTarget = { kind: 'section', id: 'coreforge' };

/**
 * His venture, in goldensdmat.in's own words as captured. Never a price: the plans
 * chunk says where prices are instead. Retrieval picks chunks independently, so
 * every chunk carries the disclaimer, not just the overview.
 */
function coreforgeChunks(cf: CorpusCoreforge | null | undefined): Draft[] {
  if (!cf) return [];
  const base = { cls: 'self' as const, target: COREFORGE_TARGET, asOf: cf.capturedAt };
  const name = `${cf.product} (${cf.domain})`;
  const out: Draft[] = [
    {
      ...base,
      id: 'coreforge:overview',
      title: `${cf.product}: what it is`,
      label: `${cf.product} · overview`,
      text:
        `${name}, '${cf.product} ${cf.tagline}', is made by ${cf.company}. Oikantik is the ${cf.founderLine.replace(/^Founder of /, 'founder of ')} ` +
        `(his LinkedIn title for the role is ${cf.linkedinTitle}), since ${cf.sinceLabel}. ${sentence(cf.positioning)} ` +
        `Who it is for: ${sentence(cf.audience)} ${sentence(cf.disclaimer)}`,
    },
    {
      ...base,
      id: 'coreforge:features',
      title: `${cf.product}: features`,
      label: `${cf.product} · features`,
      text: `What ${name} offers: ${cf.features
        .map((f) => `${f.title}${f.plan === 'pro' ? ' (Pro plan)' : ''}: ${sentence(f.body)}`)
        .join(' ')} Free public resources: ${cf.resources.map((r) => `${r.title}: ${sentence(r.body)}`).join(' ')}`,
    },
    {
      ...base,
      id: 'coreforge:plans',
      title: `${cf.product}: Free and Pro plans`,
      label: `${cf.product} · plans`,
      text: `${cf.product} Free plan: ${sentence(cf.freePlan)} ${sentence(cf.proSummary)} This site states no prices; current prices are on ${cf.domain}/pricing.`,
    },
    {
      ...base,
      id: 'coreforge:engineering',
      title: `${cf.product}: how the questions are generated`,
      label: `${cf.product} · engineering`,
      text:
        `How ${cf.product}'s Core Module tasks are made: each is freshly generated and checked by its generator before it is served. ` +
        `${cf.generatorChecks.map((g) => `${g.subtest}: ${sentence(g.check)}`).join(' ')} ` +
        `Built with ${cf.builtWith.map((b) => `${b.name} (${b.role.charAt(0).toLowerCase()}${b.role.slice(1)})`).join(' and ')}.`,
    },
    {
      ...base,
      id: 'coreforge:numbers',
      title: `${cf.product}: published numbers`,
      label: `${cf.product} · numbers`,
      text: `${cf.product}'s own published numbers: ${cf.stats.map((st) => `${st.display} ${st.label}`).join('; ')}.`,
    },
    {
      ...base,
      id: 'coreforge:changelog',
      title: `${cf.product}: changelog`,
      label: `${cf.product} · changelog`,
      text: `${cf.product} public changelog, newest first: ${cf.changelog.map((m) => `${m.date}, ${m.title}: ${sentence(m.summary)}`).join(' ')}`,
    },
  ];
  for (const f of cf.faq) {
    out.push({
      ...base,
      id: `coreforge:faq#${f.id}`,
      title: `${cf.product} FAQ: ${f.q}`,
      label: `${cf.product} · ${f.q}`,
      text: `${cf.product} FAQ. ${f.q} ${sentence(f.a)}`,
    });
  }
  const disclaimer = sentence(cf.disclaimer);
  return out.map((d) => (d.text.includes(cf.disclaimer) ? d : { ...d, text: `${d.text} ${disclaimer}` }));
}

const KAGGLE_TARGET: AiTarget = { kind: 'section', id: 'kaggle' };

/** The last path segment of a Kaggle URL, for a stable chunk id. */
function kaggleSlug(url: string): string {
  const seg = url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
  return slugify(seg) || hashText(url);
}

function rankLine(c: CorpusKaggleCompetition): string {
  return typeof c.userRank === 'number' && c.rankAsOf
    ? ` His leaderboard rank: ${c.userRank} of ${c.teams} teams, as of ${c.rankAsOf}.`
    : ' This site records no rank of his for it.';
}

/**
 * His public Kaggle profile from the committed snapshot: profile and tiers, badges
 * and writeups as 'self' evidence, each competition as dated 'live' data.
 */
function kaggleChunks(kg: CorpusKaggle | null | undefined, projects: readonly CorpusProject[]): Draft[] {
  if (!kg) return [];
  const asOf = isoDay(kg.fetchedAt);
  const dated = asOf ? ` As of ${asOf}.` : '';
  const p = kg.profile;
  const entered = [...kg.active, ...kg.past];
  const tiers = p.tiers.map((t) => `${t.category} ${t.tier}`).join(', ');
  const out: Draft[] = [
    {
      id: 'kaggle:profile',
      title: 'Kaggle profile',
      label: 'Kaggle · profile',
      text:
        `Oikantik's Kaggle profile is ${p.userName} (${p.url}), joined ${p.joined}.` +
        `${p.overallTier ? ` Overall tier: ${p.overallTier}.` : ''}${tiers ? ` Tiers by category: ${tiers}.` : ''}` +
        `${typeof p.competitionPoints === 'number' ? ` Competition points: ${p.competitionPoints}.` : ''}` +
        ` ${kg.badges.length} badges earned, ${kg.writeups.length} writeups published and ${entered.length} competitions entered: ${entered.map((c) => c.title).join('; ')}.${dated}`,
      cls: 'self',
      target: KAGGLE_TARGET,
      ...(asOf ? { asOf } : {}),
    },
    {
      id: 'kaggle:badges',
      title: 'Kaggle badges',
      label: 'Kaggle · badges',
      text: `Kaggle badges he has earned (${kg.badges.length}): ${[...kg.badges]
        .sort((a, b) => Number(b.featured) - Number(a.featured) || b.achieved.localeCompare(a.achieved))
        .map((b) => `${b.name} (${b.achieved}): ${sentence(b.description)}`)
        .join(' ')}${dated}`,
      cls: 'self',
      target: KAGGLE_TARGET,
      ...(asOf ? { asOf } : {}),
    },
  ];
  const names = new Map(projects.map((pr) => [pr.slug, pr.name]));
  for (const w of kg.writeups) {
    const project = w.project && names.has(w.project) ? w.project : undefined;
    out.push({
      id: `kaggle:writeup-${kaggleSlug(w.url)}`,
      title: `Kaggle writeup: ${w.title}`,
      label: `Kaggle · ${w.title}`,
      text:
        `Kaggle writeup he published on ${w.published}${w.type ? ` (${w.type.toLowerCase()})` : ''}: "${w.title}"` +
        `${w.subtitle ? `, ${w.subtitle}` : ''}.${w.competition ? ` Written for ${w.competition}.` : ''}` +
        `${project ? ` Project on this site: ${names.get(project)}.` : ''} Link: ${w.url}.` +
        `${w.excerpt ? ` It opens: ${w.excerpt}` : ''}`,
      cls: 'self',
      target: project ? { kind: 'project', slug: project } : KAGGLE_TARGET,
    });
  }
  for (const c of entered) {
    const open = kg.active.includes(c);
    const at = c.rankAsOf ?? asOf;
    out.push({
      id: `kaggle:competition-${kaggleSlug(c.url)}`,
      title: `Kaggle competition: ${c.title}`,
      label: `Kaggle · ${c.title}`,
      text:
        `Kaggle competition he entered: ${c.title}, hosted by ${c.host} (${c.category}), ${open ? 'open until' : 'closed on'} ${c.deadline}, ` +
        `${c.teams} teams on the leaderboard.${c.summary ? ` ${sentence(c.summary)}` : ''}${c.hasWriteup ? ' He published a writeup for it.' : ''}` +
        `${rankLine(c)}${at ? ` Data as of ${at}.` : ''} Link: ${c.url}.`,
      cls: 'live',
      target: KAGGLE_TARGET,
      ...(at ? { asOf: at } : {}),
      untrusted: true,
    });
  }
  return out;
}

/**
 * Every chunk, in a stable order: profile, experience, education, credentials,
 * skills, projects, GitHub facts, hackathon results, reading, tools, site copy,
 * references, live data. Throws on a duplicate id, which would make citations
 * ambiguous.
 */
export function buildCorpus(src: CorpusSources): Chunk[] {
  const drafts: Draft[] = [
    ...profileChunks(src.profile, src.certifications),
    ...experienceChunks(src.profile),
    ...educationChunks(src.profile),
    ...certificationChunks(src.certifications),
    ...skillChunks(src.profile),
    ...projectChunks(src.projects),
    ...factChunks(src.projects, src.githubFacts),
    ...achievementChunks(src.achievements, src.projects),
    ...coreforgeChunks(src.coreforge),
    ...kaggleChunks(src.kaggle, src.projects),
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
  /** Listed credentials, for the credential tripwire: title, issuer, platform and kind. */
  certifications: { title: string; issuer: string; platform: string; kind: CredentialKind }[];
  projectNames: string[];
  /** Listed skills. */
  skills: string[];
  /** Project stack entries and their tech families. */
  tech: string[];
  /**
   * URLs the AI may repeat: profile links, role sites, repositories, demos, the
   * reading list, credential verify pages, hackathon links and the site itself.
   */
  allowUrls: string[];
  allowEmails: string[];
};

export const SITE_ORIGINS: readonly string[] = ['https://basuoikantik.in', 'https://www.basuoikantik.in'];

export function entities(src: {
  profile: CorpusProfile;
  projects: readonly CorpusProject[];
  skills?: readonly { name: string }[];
  reading?: readonly { url: string }[];
  certifications?: CertificationData | null;
  achievements?: AchievementData | null;
  kaggle?: CorpusKaggle | null;
}): Entities {
  const { profile, projects } = src;
  const uniq = (xs: Iterable<string>) => [...new Set([...xs].filter((x) => typeof x === 'string' && x.trim()))];
  const listed = Object.values(profile.skills).flat();
  const credentials = src.certifications?.items ?? [];
  return {
    companies: uniq(profile.experience.map((e) => e.company)),
    institutions: uniq(profile.education.map((e) => e.institution)),
    degrees: uniq(profile.education.map((e) => e.degree)),
    inProgress: uniq(profile.education.filter((e) => /in progress|pursuing|ongoing/i.test(e.status)).map((e) => e.degree)),
    certifications: credentials.map((c) => ({ title: c.title, issuer: c.issuer, platform: c.platform, kind: c.kind })),
    projectNames: uniq(projects.map((p) => p.name)),
    skills: uniq([...listed, ...(src.skills ?? []).map((s) => s.name)]),
    tech: uniq(projects.flatMap((p) => p.techStack.flatMap((t) => [t, techFamily(t)]))),
    allowUrls: uniq([
      ...SITE_ORIGINS,
      ...Object.values(profile.links),
      ...profile.experience.map((e) => e.url ?? ''),
      ...projects.flatMap((p) => [p.githubUrl, p.liveUrl ?? '']),
      ...(src.reading ?? []).map((r) => r.url),
      ...credentials.map((c) => c.url),
      ...(src.achievements?.items ?? []).flatMap((a) => a.links.map((l) => l.url)),
      ...(src.kaggle
        ? [src.kaggle.profile.url, ...src.kaggle.writeups.map((w) => w.url), ...[...src.kaggle.active, ...src.kaggle.past].map((c) => c.url)]
        : []),
    ]),
    allowEmails: uniq([profile.email]),
  };
}
