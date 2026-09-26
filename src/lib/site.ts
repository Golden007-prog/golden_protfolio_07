import profile from '../data/profile.json';

export { slugify } from './slug';

const CANONICAL_ORIGIN = 'https://www.basuoikantik.in';
const MAIL_SUBJECT = 'Hello from basuoikantik.in';

export const SITE = {
  // The apex 308-redirects to www, so www is the canonical origin for metadata and links.
  url: CANONICAL_ORIGIN,
  name: profile.name,
  shortName: profile.name.split(' ')[0],
  headline: profile.headline,
  location: profile.location,
  email: profile.email,
  phone: profile.phone,
  phoneHref: `tel:${profile.phone.replace(/[^\d+]/g, '')}`,
  mailtoHref: `mailto:${profile.email}?subject=${encodeURIComponent(MAIL_SUBJECT)}`,
  links: {
    github: profile.links.github,
    linkedin: profile.links.linkedin,
    leetcode: profile.links.leetcode,
  },
  cvPath: '/oikantik_basu_u.pdf',
  cvFileName: 'Oikantik-Basu-CV.pdf',
  cvShortPath: '/cv',
  cvMeta: 'PDF · 75 KB',
  vcardPath: '/contact.vcf',
  repoUrl: 'https://github.com/Golden007-prog/golden_protfolio_07',
  availability: {
    status: profile.availability.status,
    focus: profile.availability.focus,
    openTo: profile.availability.openTo,
  },
} as const;

export type SectionId = 'about' | 'skills' | 'projects' | 'experience' | 'certifications' | 'philosophy' | 'contact';

export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; index: string }> = [
  { id: 'about', label: 'About', index: '01' },
  { id: 'skills', label: 'Skills', index: '02' },
  { id: 'projects', label: 'Projects', index: '03' },
  { id: 'experience', label: 'Experience', index: '04' },
  { id: 'certifications', label: 'Certifications', index: '05' },
  { id: 'philosophy', label: 'Principles', index: '06' },
  { id: 'contact', label: 'Contact', index: '07' },
];

/** '07 / Contact' */
export function kickerFor(id: SectionId): string {
  const section = SECTIONS.find((s) => s.id === id);
  return section ? `${section.index} / ${section.label}` : '';
}

/** In-page anchor on '/', a link back to the home page anywhere else. */
export function sectionHref(id: SectionId, pathname: string): string {
  return pathname === '/' ? `#${id}` : `/#${id}`;
}
