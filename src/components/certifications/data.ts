import raw from '@/data/certifications.json';
import {
  certificationCounts,
  certificationGroups,
  issuers,
  parseCertifications,
  type Certification,
  type CertificationGroup,
  type CredentialKind,
} from '@/lib/certifications';

/*
 * The credentials, parsed once for every surface that shows them: the section,
 * the About fact and the command palette. parseCertifications throws on a bad
 * edit, so a broken link or date fails the build instead of shipping. Every
 * number on screen comes from here; none is typed into a component.
 */

export const CERTS = parseCertifications(raw);
export const COUNTS = certificationCounts(CERTS);
export const GROUPS: readonly CertificationGroup[] = certificationGroups(CERTS);

/** The professional certificate shown as the featured card; null if the data ever has none. */
export const FEATURED: CertificationGroup | null = GROUPS.find((g) => g.lead !== null) ?? null;
/** Every other group, in file order (Claude Academy, Coursera, Programiz PRO). */
export const REST: readonly CertificationGroup[] = GROUPS.filter((g) => g !== FEATURED);

/** What each kind is, in the words the issuers use. A badge is not a certificate, so the card says which it is. */
export const KIND_LABEL: Readonly<Record<CredentialKind, string>> = {
  'course-completion-badge': 'Course-completion badge',
  'professional-certificate': 'Professional certificate',
  'course-certificate': 'Course certificate',
};

const KIND_PLURAL: Readonly<Record<CredentialKind, string>> = {
  'course-completion-badge': 'course-completion badges',
  'professional-certificate': 'professional certificates',
  'course-certificate': 'course certificates',
};

export function kindPhrase(kind: CredentialKind, n: number): string {
  return n === 1 ? KIND_LABEL[kind].toLowerCase() : KIND_PLURAL[kind];
}

/** Counts per kind, largest first: '20 course-completion badges', ... */
export const KIND_COUNTS: readonly { kind: CredentialKind; count: number }[] = (() => {
  const counts = new Map<CredentialKind, number>();
  for (const c of CERTS.items) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
})();

export const ALL_ISSUERS = 'all';
export type IssuerFilter = string;

/** 'All' plus each issuer in first-seen file order, with how many credentials it issued. */
export const ISSUER_OPTIONS: readonly { value: IssuerFilter; label: string; count: number }[] = [
  { value: ALL_ISSUERS, label: 'All', count: CERTS.items.length },
  ...issuers(CERTS).map((issuer) => ({
    value: issuer,
    label: issuer,
    count: CERTS.items.filter((c) => c.issuer === issuer).length,
  })),
];

export function matchesIssuer(c: Certification, filter: IssuerFilter): boolean {
  return filter === ALL_ISSUERS || c.issuer === filter;
}

/** The DOM id of a credential's card; ids are kebab slugs, so this is selector-safe. */
export function certCardId(id: string): string {
  return `cert-${id}`;
}

/** The group a credential sits in, as the section lays it out. */
export function groupOf(id: string): CertificationGroup | undefined {
  return GROUPS.find((g) => g.lead?.id === id || g.items.some((c) => c.id === id));
}
