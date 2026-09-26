/*
 * Credentials from src/data/certifications.json: Claude Academy course badges,
 * Coursera certificates (the Google AI Professional Certificate and the courses
 * it is made of, plus standalone IBM and University of Michigan courses) and
 * Programiz PRO certificates. Titles and dates are as the issuer's own site shows
 * them; every url was opened logged out and showed his name and the title.
 *
 * Pure (the data is passed in) so node --test can run it; relative .ts imports
 * for the same reason. Components parse the JSON once:
 *   import raw from '@/data/certifications.json';
 *   const CERTS = parseCertifications(raw);
 */
import { formatYearMonth } from '../utils/dates.ts';

export const CREDENTIAL_KINDS = ['course-completion-badge', 'professional-certificate', 'course-certificate'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export type Certification = {
  /** Kebab slug of the title, unique; safe for DOM ids and ?cert= params. */
  id: string;
  title: string;
  issuer: string;
  platform: string;
  kind: CredentialKind;
  /** 'YYYY-MM', or 'YYYY-MM-DD' where the issuer shows the day. */
  issued: string;
  credentialId?: string;
  /** The issuer's public verification page. */
  url: string;
  /** Course titles a professional certificate is made of. */
  includes?: readonly string[];
  /** Title of the professional certificate this course counts towards. */
  partOf?: string;
};

export type CertificationData = { verifiedAt: string; items: readonly Certification[] };

/** Issuers' verification hosts; nothing else is ever linked as a credential. */
export const ALLOWED_CREDENTIAL_HOSTS: readonly string[] = ['academy.claude.com', 'www.coursera.org', 'programiz.pro'];

/** https on one of the allowed hosts, default port, no credentials in the URL. */
export function isAllowedCredentialUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && ALLOWED_CREDENTIAL_HOSTS.includes(u.hostname) && u.port === '' && !u.username && !u.password;
}

/* ---- dates ---- */

export type IssuedDate = { year: number; month: number; day: number | null };

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 'YYYY-MM' or 'YYYY-MM-DD' to parts; null for anything else, including 2026-02-30. */
export function parseIssued(value: string | null | undefined): IssuedDate | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (m[3] === undefined) return { year, month, day: null };
  const day = Number(m[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const max = month === 2 && !leap ? 28 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= max ? { year, month, day } : null;
}

/**
 * Below zero when a is earlier than b, above when later; 0 for equal or bad input.
 * A month-only date counts as the start of its month, so '2026-09-25' is later
 * than '2026-09'.
 */
export function compareIssued(a: string, b: string): number {
  const x = parseIssued(a);
  const y = parseIssued(b);
  if (!x || !y) return 0;
  return x.year - y.year || x.month - y.month || (x.day ?? 0) - (y.day ?? 0);
}

/** '2026-09' -> 'Sep 2026', '2026-09-25' -> 'Sep 25, 2026'; '' for bad input. */
export function formatIssued(value: string): string {
  const d = parseIssued(value);
  if (!d) return '';
  const month = formatYearMonth(`${d.year}-${String(d.month).padStart(2, '0')}`);
  if (d.day === null) return month;
  const [name, year] = month.split(' ');
  return `${name} ${d.day}, ${year}`;
}

/* ---- validation ---- */

function isString(x: unknown): x is string {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(msg: string): never {
  throw new Error(`certifications.json: ${msg}`);
}

/**
 * The JSON import checked and typed: every field present and well formed, ids
 * unique, urls allowed, and each partOf naming a professional certificate whose
 * includes list names it back. Throws on the first problem, so a bad edit fails
 * the build instead of shipping a broken credential link.
 */
export function parseCertifications(raw: unknown): CertificationData {
  if (!raw || typeof raw !== 'object') fail('not an object');
  const { verifiedAt, items } = raw as { verifiedAt?: unknown; items?: unknown };
  if (!isString(verifiedAt) || !parseIssued(verifiedAt)?.day) fail('verifiedAt must be YYYY-MM-DD');
  if (!Array.isArray(items)) fail('items must be an array');

  const out: Certification[] = [];
  const ids = new Set<string>();
  for (const [i, x] of (items as unknown[]).entries()) {
    const c = (x ?? {}) as Record<string, unknown>;
    const at = `items[${i}]`;
    for (const key of ['id', 'title', 'issuer', 'platform', 'kind', 'issued', 'url'] as const) {
      if (!isString(c[key])) fail(`${at}.${key} is missing`);
    }
    const id = c.id as string;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`${at}.id '${id}' is not a kebab slug`);
    if (ids.has(id)) fail(`${at}.id '${id}' is not unique`);
    ids.add(id);
    if (!(CREDENTIAL_KINDS as readonly string[]).includes(c.kind as string)) fail(`${at}.kind '${String(c.kind)}' is unknown`);
    if (!parseIssued(c.issued as string)) fail(`${at}.issued '${String(c.issued)}' is not a date`);
    if (!isAllowedCredentialUrl(c.url as string)) fail(`${at}.url '${String(c.url)}' is not an allowed credential link`);
    if (c.credentialId !== undefined && !isString(c.credentialId)) fail(`${at}.credentialId is empty`);
    if (c.partOf !== undefined && !isString(c.partOf)) fail(`${at}.partOf is empty`);
    if (c.includes !== undefined && !(Array.isArray(c.includes) && c.includes.every(isString))) fail(`${at}.includes must list titles`);

    const item: Certification = {
      id,
      title: c.title as string,
      issuer: c.issuer as string,
      platform: c.platform as string,
      kind: c.kind as CredentialKind,
      issued: c.issued as string,
      url: c.url as string,
    };
    if (c.credentialId !== undefined) item.credentialId = c.credentialId as string;
    if (c.includes !== undefined) item.includes = c.includes as string[];
    if (c.partOf !== undefined) item.partOf = c.partOf as string;
    out.push(item);
  }

  for (const c of out) {
    if (!c.partOf) continue;
    const program = out.find((p) => p.kind === 'professional-certificate' && p.title === c.partOf);
    if (!program) fail(`'${c.title}' is partOf '${c.partOf}', which is not a professional certificate in the file`);
    if (!program?.includes?.includes(c.title)) fail(`'${c.partOf}' does not list '${c.title}' in includes`);
  }
  return { verifiedAt: verifiedAt as string, items: out };
}

/* ---- accessors ---- */

/** Every credential, newest first; ties keep file order. */
export function allCertifications(data: CertificationData): Certification[] {
  return [...data.items].sort((a, b) => compareIssued(b.issued, a.issued));
}

export function byIssuer(data: CertificationData, issuer: string): Certification[] {
  return allCertifications(data).filter((c) => c.issuer === issuer);
}

export function byPlatform(data: CertificationData, platform: string): Certification[] {
  return allCertifications(data).filter((c) => c.platform === platform);
}

export function getCertification(data: CertificationData, id: string | null | undefined): Certification | undefined {
  return id ? data.items.find((c) => c.id === id) : undefined;
}

/** Issuers in first-seen file order. */
export function issuers(data: CertificationData): string[] {
  return [...new Set(data.items.map((c) => c.issuer))];
}

/** Platforms in first-seen file order. */
export function platforms(data: CertificationData): string[] {
  return [...new Set(data.items.map((c) => c.platform))];
}

export type CertificationGroup = {
  /** The professional certificate's id, else the platform's slug ('claude-academy'). */
  id: string;
  /** The certificate's title, else the platform name. */
  label: string;
  platform: string;
  /** Distinct issuers of the lead and items, first seen first. */
  issuers: string[];
  /** The professional certificate the items count towards; null for a platform group. */
  lead: Certification | null;
  /** Newest first. A certificate group holds its courses; a platform group the rest. */
  items: Certification[];
  /** Latest issued date in the group, lead included. */
  latest: string;
};

function platformSlug(platform: string): string {
  return platform
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Groups for the UI, in first-seen file order: each professional certificate with
 * the courses that make it up, then per platform the credentials that belong to no
 * certificate. Every credential lands in exactly one group, as a lead or an item.
 */
export function certificationGroups(data: CertificationData): CertificationGroup[] {
  const programs = new Map(data.items.filter((c) => c.kind === 'professional-certificate').map((c) => [c.title, c]));
  const groups = new Map<string, { lead: Certification | null; platform: string; label: string; members: Certification[] }>();

  for (const c of data.items) {
    const program = c.kind === 'professional-certificate' ? c : c.partOf ? programs.get(c.partOf) : undefined;
    const key = program ? program.id : platformSlug(c.platform);
    let g = groups.get(key);
    if (!g) {
      g = { lead: program ?? null, platform: c.platform, label: program ? program.title : c.platform, members: [] };
      groups.set(key, g);
    }
    if (c !== program) g.members.push(c);
  }

  return [...groups].map(([id, g]) => {
    const items = [...g.members].sort((a, b) => compareIssued(b.issued, a.issued));
    const dated = g.lead ? [g.lead, ...items] : items;
    const latest = dated.reduce((best, c) => (compareIssued(c.issued, best) > 0 ? c.issued : best), dated[0]?.issued ?? '');
    return { id, label: g.label, platform: g.platform, issuers: [...new Set(dated.map((c) => c.issuer))], lead: g.lead, items, latest };
  });
}

export type CertificationCounts = { total: number; issuers: number; platforms: number; latest: string | null };

/** Headline numbers, all counted from the data: never type one in. */
export function certificationCounts(data: CertificationData): CertificationCounts {
  const latest = allCertifications(data)[0]?.issued ?? null;
  return { total: data.items.length, issuers: issuers(data).length, platforms: platforms(data).length, latest };
}
