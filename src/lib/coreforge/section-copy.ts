/*
 * Portfolio-side copy for the CoreForge section, venture page and small placements.
 * Facts about the product live in ./facts.ts; this file holds only the portfolio's own
 * framing (headings, CTA labels) and the pricing-table rows, quoted from the
 * goldensdmat.in /pricing capture of 2026-09-26 with every amount left out.
 * section-copy.test.ts runs the price guard over all of it.
 *
 * Pure (no '@/' imports), so node --test can import it.
 */
import { COREFORGE_BRAND, COREFORGE_DISCLAIMER_SHORT, COREFORGE_FOUNDER, COREFORGE_PATHS } from './brand.ts';

export const SECTION_COPY = {
  eyebrow: `Founder · ${COREFORGE_BRAND.company}`,
  /** '*word*' marks the emphasised word for SectionHeading. */
  title: 'I built *CoreForge*.',
  titlePlain: 'I built CoreForge.',
  founderMeta: `${COREFORGE_FOUNDER.line} · since ${COREFORGE_FOUNDER.sinceLabel}`,
  liveAt: `Live at ${COREFORGE_BRAND.domain}`,
  featuresTitle: 'What CoreForge does',
  statsLabel: 'CoreForge at a glance',
} as const;

export const CTA = {
  demo: { label: 'Try 10 free questions', path: COREFORGE_PATHS.demo },
  start: { label: 'Start free', path: COREFORGE_PATHS.home },
  doINeed: { label: 'Do I need the dMAT?', path: COREFORGE_PATHS.doINeed },
  pricing: { label: 'See pricing', path: COREFORGE_PATHS.pricing },
  visit: { label: `Visit ${COREFORGE_BRAND.domain}`, path: COREFORGE_PATHS.home },
  fullDemo: { label: 'Try CoreForge’s daily demo', path: COREFORGE_PATHS.demo },
  changelog: { label: 'Read the full changelog', path: COREFORGE_PATHS.changelog },
  news: { label: 'All dMAT news', path: COREFORGE_PATHS.news },
  wizard: { label: 'Which module do I need?', path: COREFORGE_PATHS.moduleWizard },
} as const;

export const ANNOUNCEMENT = {
  /** Not 'New:': CoreForge has been live since Jul 2026 and the strip has no expiry. */
  lead: 'From my startup:',
  body: 'CoreForge — free dMAT practice for German Master’s applicants',
  cta: 'Try 10 free questions',
  disclaimer: COREFORGE_DISCLAIMER_SHORT,
  dismissLabel: 'Dismiss the CoreForge announcement',
} as const;

export const MINI_DEMO_COPY = {
  title: 'Follow the marker',
  intro: 'Four frames, one rule. Pick the cell the marker lands on next.',
  question: 'Where does the marker land in frame 5?',
  hint: 'Pick a cell to lock in your answer.',
  loading: 'Loading today’s pattern…',
  correct: 'Correct.',
  wrongPrefix: 'Not quite: you picked',
  another: 'Try another pattern',
  footnote:
    'A small puzzle I wrote for this page in the style of a figure sequence, not a CoreForge question: CoreForge’s own tasks are harder and timed. A new pattern every day, generated in your browser, and only shipped when every rule that fits the four frames agrees on the fifth.',
  /** Announced in the status region when 'Try another pattern' swaps the frames. */
  newPuzzle: 'New pattern: four new frames.',
} as const;

export const BUILT_WITH_COPY = {
  title: 'How the questions are made',
  lead: 'The 3 Core subtests are generated, not stored: every task is freshly generated in the official format and checked by its generator before it is served.',
  subject: 'General Academic Module questions keep the official shape, four options with exactly one correct, and each one passes a validator before it ships.',
  stackTitle: 'Built with',
} as const;

export const PRICING_COPY = {
  title: 'Free to start',
  lead: 'The Free plan never expires and needs no card; Pro unlocks the rest.',
  freeName: 'Free plan',
  proName: 'CoreForge Pro',
  /** Rows of the /pricing comparison table that the Free plan includes. */
  free: [
    'Core Module practice: Figure Sequences, Mathematical Equations, Latin Squares (easy, 3 per set)',
    'Your results, answer review and history',
    'Brain Gym levels 1–3',
    'No card, no expiry',
  ],
  /** Rows marked 'Pro only', then the billing terms from the same page. */
  pro: [
    'Every difficulty and set size, plus the full timed Core Module',
    'General Academic Module passages across all 8 topic areas',
    'Every subject module in the official table',
    'Unlimited mock exams and the full dMAT simulation',
    'Learn, analytics, mistakes notebook, weekly leagues',
    'AI tutor',
    'Monthly or yearly, cancel in one tap',
    '7-day money-back guarantee on your first purchase',
  ],
  note: 'Current prices are on the pricing page.',
} as const;

export const VENTURE_COPY = {
  eyebrow: `${COREFORGE_BRAND.company} · ${COREFORGE_FOUNDER.role}: ${COREFORGE_FOUNDER.name}`,
  title: 'CoreForge, the dMAT practice platform I founded',
  galleryTitle: 'Inside CoreForge',
  featuresTitle: 'Everything in the box',
  resourcesTitle: 'Free, public resources',
  howTitle: 'How the questions are made',
  pricingTitle: 'Free to start',
  changelogTitle: 'Changelog',
  newsTitle: 'Latest dMAT news',
  faqTitle: 'Questions',
  closingTitle: 'Try it today',
  closingLead: '10 questions a day, no account, no card.',
} as const;

export const SHARE_COPY = {
  label: 'Share CoreForge',
  title: 'CoreForge — dMAT Practice',
  text: 'Free dMAT practice for German Master’s applicants: 10 originally generated questions a day, no account needed.',
  copied: 'Link copied',
  copiedDescription: 'Paste it anywhere to share CoreForge.',
  failed: 'Could not share',
} as const;

export const QR_COPY = {
  title: 'Open on your phone',
  caption: 'Scan to open goldensdmat.in',
} as const;

export const PROJECT_CARD_COPY = {
  badge: 'Founder · live product',
  story: 'Read the story',
} as const;

