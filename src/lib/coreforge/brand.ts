/*
 * The small, always-eager slice of the CoreForge facts: brand, founder line, the
 * disclaimers and the goldensdmat.in paths. Eagerly mounted placements (FounderBadge,
 * AnnouncementBar, FooterLine) import from here so they never pull the feature, FAQ or
 * changelog data into the first-load chunk. ./facts.ts re-exports all of it, so either
 * import path gives the same values. Pure data, no '@/' imports (node --test loads it).
 */

export const COREFORGE_BRAND = {
  company: "GOLDEN's Coreforge",
  product: 'CoreForge',
  tagline: 'dMAT Practice',
  domain: 'goldensdmat.in',
  origin: 'https://goldensdmat.in',
  /** From the site's own description of /welcome. */
  eyebrow: 'Practise the complete dMAT with real exam timing',
  /** The site's own H1; used only to describe screenshots of it (alt text), never as portfolio copy. */
  headline: 'The Core Module tests how you think. Your subject module tests how you apply it.',
  ogImage: 'https://goldensdmat.in/media/og-card.webp',
} as const;

export const COREFORGE_FOUNDER = {
  name: 'Oikantik Basu',
  role: 'Founder',
  /** The title on his LinkedIn experience entry. */
  linkedinTitle: 'Owner',
  since: '2026-07',
  sinceLabel: 'Jul 2026',
  location: 'India',
  line: "Founder of GOLDEN's Coreforge",
} as const;

/** The site's own disclaimer. Show it wherever CoreForge is promoted at length. */
export const COREFORGE_DISCLAIMER =
  'Unofficial practice tool. Not affiliated with g.a.s.t., TestDaF-Institut, APS, or the DAAD.';

/** For small placements (a badge, a chip, a footer line). */
export const COREFORGE_DISCLAIMER_SHORT = 'Unofficial dMAT practice tool';

/** The site footer's full wording. */
export const COREFORGE_DISCLAIMER_FULL = `${COREFORGE_DISCLAIMER} Question formats follow publicly documented dMAT task types; all questions are originally generated. dMAT is a trademark of its owners.`;

export const COREFORGE_PATHS = {
  home: '/welcome',
  demo: '/demo',
  pricing: '/pricing',
  brainGym: '/brain-gym',
  doINeed: '/dmat-info',
  moduleWizard: '/modules/wizard',
  modules: '/modules',
  examPattern: '/dmat-exam-pattern',
  gam: '/general-academic-module',
  guides: '/guides',
  news: '/news',
  rss: '/news.xml',
  changelog: '/changelog',
  freeLearning: '/free-learning',
} as const;
