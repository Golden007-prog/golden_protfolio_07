/*
 * Profile-derived copy (title, description, OG card, vCard, manifest) and the
 * JSON-LD graph. Every value comes from the objects passed in, which the
 * callers read from src/data; nothing here is written by hand.
 */

export type ProfileData = {
  name: string;
  headline: string;
  location: string;
  email: string;
  about?: string;
  links: Readonly<Record<string, string>>;
  experience?: ReadonlyArray<{ company: string; url?: string }>;
  education?: ReadonlyArray<{ institution: string; end?: string | null }>;
  skills?: Readonly<Record<string, readonly string[]>>;
};

export type ProjectData = {
  name: string;
  tagline?: string;
  shortDescription?: string;
  language?: string | null;
  topics?: readonly string[];
  githubUrl: string;
  liveUrl?: string | null;
};

/** A credential as src/lib/certifications.ts parses it; only the fields the graph uses. */
export type CredentialData = {
  id: string;
  title: string;
  issuer: string;
  platform: string;
  kind: string;
  issued: string;
  url: string;
  partOf?: string;
};

/** An entry as src/lib/achievements.ts parses it; only the fields the graph uses. */
export type AchievementEntry = {
  title: string;
  date: string;
  kind: string;
  summary: string;
  links: ReadonlyArray<{ url: string }>;
};

type JsonLd = Record<string, unknown>;

// The issuer's own word for each credential kind, so a course badge never reads as a certification.
const CREDENTIAL_KIND_LABEL: Readonly<Record<string, string>> = {
  'course-completion-badge': 'Course completion badge',
  'professional-certificate': 'Professional certificate',
  'course-certificate': 'Course certificate',
};

const PROFILE_LINKS = ['github', 'linkedin', 'leetcode'] as const;

/** 'Data Science & Gen AI Developer | Multi-Agent Systems | RAG' -> 'Data Science & Gen AI Developer' */
export function headlineRole(headline: string): string {
  return headline.split('|')[0].trim();
}

/** The headline's segments after the role: ['Multi-Agent Systems', 'LLM Fine-tuning', 'RAG']. */
export function headlineFocus(headline: string): string[] {
  return headline
    .split('|')
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 'Bengaluru, India' -> { locality: 'Bengaluru', country: 'India' } */
export function splitLocation(location: string): { locality: string; country: string } {
  const parts = location.split(',').map((s) => s.trim());
  return { locality: parts[0] ?? '', country: parts.length > 1 ? parts[parts.length - 1] : '' };
}

/** 'A, B and C' */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [];
}

/**
 * One paragraph for <meta name="description"> and the manifest: the headline's
 * role and focus, the location, and the About sentence on current study.
 */
export function siteDescription(profile: ProfileData): string {
  const focus = headlineFocus(profile.headline);
  const lead = `${headlineRole(profile.headline)} in ${profile.location}${focus.length ? `, focused on ${joinList(focus)}` : ''}.`;
  const about = sentences(profile.about ?? '');
  const study = about.find((s) => /\bmaster'?s\b|\bpursuing\b/i.test(s));
  return study ? `${lead} ${study}` : lead;
}

export function profileUrls(profile: ProfileData): string[] {
  return PROFILE_LINKS.map((key) => profile.links[key]).filter((u): u is string => Boolean(u));
}

/** 'YYYY-MM' of `now`, for comparing with education[].end. */
function monthOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** 'https://www.example.com/x' -> 'example.com'; '' when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * One EducationalOccupationalCredential per credential, each linking to the
 * issuer's public verification page. credentialCategory is 'badge' for a Claude
 * Academy course-completion badge (the site never calls those certifications) and
 * 'certificate' for the rest; the description carries the issuer's own kind and the platform, and a
 * course that counts towards a professional certificate points at it with isPartOf.
 */
export function credentialNodes(siteUrl: string, credentials: readonly CredentialData[]): JsonLd[] {
  const idOf = (c: CredentialData) => `${siteUrl}/#credential-${c.id}`;
  const programs = new Map(credentials.filter((c) => c.kind === 'professional-certificate').map((c) => [c.title, idOf(c)]));
  return credentials.map((c) => {
    const kind = CREDENTIAL_KIND_LABEL[c.kind];
    const program = c.partOf ? programs.get(c.partOf) : undefined;
    return {
      '@type': 'EducationalOccupationalCredential',
      '@id': idOf(c),
      name: c.title,
      ...(kind ? { description: `${kind} on ${c.platform}` } : {}),
      credentialCategory: c.kind === 'course-completion-badge' ? 'badge' : 'certificate',
      recognizedBy: { '@type': 'Organization', name: c.issuer },
      url: c.url,
      dateCreated: c.issued,
      ...(program ? { isPartOf: { '@id': program } } : {}),
    };
  });
}

/**
 * Organisations he founded: each 'founder' achievement joined, by the host of its
 * links, to the experience entry whose url is the same site, which gives the
 * organisation's name. A founder entry with no matching role is left out. The
 * @id is `<its origin>/#organization`, the id src/lib/coreforge/jsonld.ts gives
 * GOLDEN's Coreforge, so a page that also renders that graph describes one entity.
 */
export function foundedOrganizations(
  personId: string,
  experience: NonNullable<ProfileData['experience']>,
  achievements: readonly AchievementEntry[],
): JsonLd[] {
  return achievements
    .filter((a) => a.kind === 'founder')
    .flatMap((a) => {
      const hosts = new Set(a.links.map((l) => hostOf(l.url)).filter(Boolean));
      const role = experience.find((e) => e.url && hosts.has(hostOf(e.url)));
      if (!role?.url) return [];
      return [
        {
          '@type': 'Organization',
          '@id': `${new URL(role.url).origin}/#organization`,
          name: role.company,
          url: role.url,
          description: a.summary,
          founder: { '@id': personId },
          foundingDate: a.date,
        },
      ];
    });
}

export function buildSiteGraph<P extends ProjectData>({
  siteUrl,
  profile,
  projects,
  caseStudyPath,
  credentials = [],
  achievements = [],
  now = new Date(),
}: {
  siteUrl: string;
  profile: ProfileData;
  projects: readonly P[];
  /** The project's case-study route, or null when it has none; the project then links to its demo or source. */
  caseStudyPath: (project: P) => string | null;
  /** Verified credentials, in the order they should be listed. */
  credentials?: readonly CredentialData[];
  achievements?: readonly AchievementEntry[];
  now?: Date;
}): JsonLd {
  const personId = `${siteUrl}/#person`;
  const { locality, country } = splitLocation(profile.location);

  // alumniOf only for finished programmes; an in-progress degree is not alumni status.
  const alumniOf = (profile.education ?? [])
    .filter((e) => typeof e.end === 'string' && e.end <= monthOf(now))
    .map((e) => ({ '@type': 'EducationalOrganization', name: e.institution }));

  const knowsAbout = [...new Set(Object.values(profile.skills ?? {}).flat())];
  const hasCredential = credentialNodes(siteUrl, credentials);
  // Only a finalist placing counts as an award, in the post's own words; builds and submissions are not awards.
  const award = achievements.filter((a) => a.kind === 'finalist').map((a) => a.title);
  const founded = foundedOrganizations(personId, profile.experience ?? [], achievements);

  const person: JsonLd = {
    '@type': 'Person',
    '@id': personId,
    name: profile.name,
    url: siteUrl,
    jobTitle: headlineRole(profile.headline),
    email: `mailto:${profile.email}`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: locality,
      ...(country ? { addressCountry: country } : {}),
    },
    sameAs: profileUrls(profile),
    ...(alumniOf.length ? { alumniOf } : {}),
    ...(knowsAbout.length ? { knowsAbout } : {}),
    ...(hasCredential.length ? { hasCredential } : {}),
    ...(award.length ? { award } : {}),
  };

  const website: JsonLd = {
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    url: siteUrl,
    name: profile.name,
    description: siteDescription(profile),
    inLanguage: 'en',
    author: { '@id': personId },
  };

  const projectList: JsonLd = {
    '@type': 'ItemList',
    '@id': `${siteUrl}/#projects`,
    numberOfItems: projects.length,
    itemListElement: projects.map((p, i) => {
      const caseStudy = caseStudyPath(p);
      const description = p.tagline || p.shortDescription;
      return {
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'SoftwareSourceCode',
          name: p.name,
          ...(description ? { description } : {}),
          url: caseStudy ? `${siteUrl}${caseStudy}` : p.liveUrl || p.githubUrl,
          codeRepository: p.githubUrl,
          ...(p.language ? { programmingLanguage: p.language } : {}),
          ...(p.topics?.length ? { keywords: p.topics.join(', ') } : {}),
          author: { '@id': personId },
        },
      };
    }),
  };

  return { '@context': 'https://schema.org', '@graph': [person, website, projectList, ...founded] };
}

/** JSON for a <script type="application/ld+json">; '<' is escaped so the data can never close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
