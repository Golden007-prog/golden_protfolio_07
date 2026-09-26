/*
 * CoreForge, the dMAT practice platform at goldensdmat.in, made by GOLDEN's Coreforge,
 * which Oikantik founded. Every string here traces to the goldensdmat.in capture of
 * 2026-09-26 (sources/goldensdmat-capture.json: /welcome, /demo, /pricing, /brain-gym,
 * /modules, /modules/wizard, /dmat-info, /guides, /news.xml, /free-learning, /changelog,
 * the web manifest and the site footer) or to his LinkedIn Owner entry and launch post. Rules this file keeps, and facts.test.ts enforces where it can:
 *   - no user counts, ratings, testimonials, pass rates, rankings or press;
 *   - never a price: the ₹ figures were a launch sale. Say COREFORGE_FREE_PLAN_LINE
 *     and link COREFORGE_PATHS.pricing;
 *   - wherever CoreForge is promoted at length, show COREFORGE_DISCLAIMER
 *     (COREFORGE_DISCLAIMER_SHORT is for small placements).
 *
 * Paths are relative to goldensdmat.in. Build outbound hrefs with cfUrl() from
 * ./links.ts so every click carries its UTM campaign. Pure data with no '@/' or
 * JSON imports, so node --test can load it.
 */

import { COREFORGE_BRAND, COREFORGE_DISCLAIMER, COREFORGE_PATHS } from './brand.ts';

export const COREFORGE_FACTS_CAPTURED_AT = '2026-09-26';

export {
  COREFORGE_BRAND,
  COREFORGE_DISCLAIMER,
  COREFORGE_DISCLAIMER_FULL,
  COREFORGE_DISCLAIMER_SHORT,
  COREFORGE_FOUNDER,
  COREFORGE_PATHS,
} from './brand.ts';

export const COREFORGE_POSITIONING =
  'Practice for the complete dMAT, the digitaler Mastertest for admission to German Master’s programmes: unlimited, freshly generated Core Module tasks, the General Academic Module and every subject module, all with real exam timing.';

export const COREFORGE_AUDIENCE =
  'Applicants to German Master’s programmes. From the SoSe-2027 intake, India APS applicants whose previous degree is in Engineering, Commerce / Accounting / Finance / Economics or Business / Management must sit the dMAT (General Academic Module).';

/** The three field groups APS India lists as affected (v1.0 list, 29 June 2026). */
export const COREFORGE_AFFECTED_FIELDS = [
  'Engineering',
  'Commerce / Accounting / Finance / Economics',
  'Business / Management',
] as const;

/** The pricing message. Pair it with a link to COREFORGE_PATHS.pricing, never with an amount. */
export const COREFORGE_FREE_PLAN_LINE = 'Free plan — no card, no expiry';

export const COREFORGE_FREE_PLAN =
  'Core Module practice at easy difficulty in 3-question sets, plus results, answer review and history — no card, no expiry.';

export const COREFORGE_PRO_SUMMARY =
  'Pro adds every difficulty and set size, the full timed Core Module, the General Academic Module across all 8 topic areas, every subject module, unlimited mock exams and the full dMAT simulation, Learn, analytics, a mistakes notebook, weekly leagues and an AI tutor.';

export type CoreforgePathKey = keyof typeof COREFORGE_PATHS;

/** Canonical absolute URLs with no tracking parameters, for JSON-LD and metadata. */
export function coreforgeAbsoluteUrl(path: string): string {
  return new URL(path, `${COREFORGE_BRAND.origin}/`).toString();
}

/** lucide-react icon names used below; ./icons.ts maps each to its component. */
export const COREFORGE_ICON_NAMES = [
  'CirclePlay',
  'Shuffle',
  'Timer',
  'Layers',
  'Dumbbell',
  'SearchCheck',
  'Compass',
  'Lightbulb',
  'WifiOff',
  'BookOpen',
  'Newspaper',
  'Rss',
  'Library',
  'Languages',
  'ScrollText',
  'GraduationCap',
  'History',
] as const;

export type CoreforgeIconName = (typeof COREFORGE_ICON_NAMES)[number];

export type CoreforgeFeature = {
  readonly id: string;
  readonly title: string;
  /** One line, no line breaks. */
  readonly body: string;
  readonly icon: CoreforgeIconName;
  /** Deep link on goldensdmat.in. */
  readonly path: string;
  /** 'pro' when the /pricing table marks the feature 'Pro only' (shown as a chip). */
  readonly plan?: 'pro';
};

export const COREFORGE_FEATURES: readonly CoreforgeFeature[] = [
  {
    id: 'daily-demo',
    title: 'Free daily demo',
    body: '10 originally generated questions a day at real exam timing. No account, no card.',
    icon: 'CirclePlay',
    path: '/demo',
  },
  {
    id: 'generated-sets',
    title: 'Generated, not stored',
    body: 'Unlimited, freshly generated Core tasks in the official formats, each checked by its generator before it is served.',
    icon: 'Shuffle',
    path: '/welcome',
  },
  {
    id: 'exam-timing',
    title: 'Full timed Core Module',
    body: 'Three Core subtests of 20 tasks in 25:00 each, building up to the full sitting of about 3.5 hours.',
    icon: 'Timer',
    path: '/dmat-exam-pattern',
    plan: 'pro',
  },
  {
    id: 'every-module',
    title: 'Every subject module',
    body: 'The General Academic Module across all 8 topic areas, Computer Science, five Battery Science tracks and Data Science (modeled format).',
    icon: 'Layers',
    path: '/modules',
    plan: 'pro',
  },
  {
    id: 'brain-gym',
    title: 'Brain Gym',
    body: 'Forty short, seeded drills for speed, attention, memory and reasoning, ten levels each. One round a day needs no account.',
    icon: 'Dumbbell',
    path: '/brain-gym',
  },
  {
    id: 'dmat-checker',
    title: 'Do I need the dMAT?',
    body: 'Type your degree and see it matched against APS India’s official list of affected fields.',
    icon: 'SearchCheck',
    path: '/dmat-info',
  },
  {
    id: 'module-wizard',
    title: 'Which module do I need?',
    body: 'Three questions about your target programme and APS route, checked against the official module table.',
    icon: 'Compass',
    path: '/modules/wizard',
  },
  {
    id: 'explanations',
    title: 'Feedback and review',
    body: 'Instant feedback after each answer and a full answer review; Pro adds Learn, analytics and a mistakes notebook.',
    icon: 'Lightbulb',
    path: '/welcome',
  },
  {
    id: 'offline',
    title: 'Installable, offline-ready',
    body: 'Installs as an app with offline support, and a Supabase backend syncs your practice across devices.',
    icon: 'WifiOff',
    path: '/welcome',
  },
  {
    id: 'guides',
    title: 'Seven dMAT guides',
    body: 'Seven guides on registration through g.a.s.t., timing, scoring, which module you sit and the APS India process.',
    icon: 'BookOpen',
    path: '/guides',
  },
];

export type CoreforgeResource = CoreforgeFeature;

/** Free, public pages beyond the practice app, for a resources strip or a footer. */
export const COREFORGE_RESOURCES: readonly CoreforgeResource[] = [
  {
    id: 'news',
    title: 'dMAT news & updates',
    body: 'Curated dMAT and APS India updates, each linked to the official source it came from.',
    icon: 'Newspaper',
    path: '/news',
  },
  {
    id: 'rss',
    title: 'RSS feed',
    body: 'The same news hub in any feed reader.',
    icon: 'Rss',
    path: '/news.xml',
  },
  {
    id: 'free-learning',
    title: 'Free concept lessons',
    body: 'Checked links to Khan Academy and other open lessons, sorted by module.',
    icon: 'Library',
    path: '/free-learning',
  },
  {
    id: 'hindi-explainer',
    title: 'Hindi explainer',
    body: 'हिंदी में: what the dMAT is, who has to sit it, what the paper covers and how it is scored.',
    icon: 'Languages',
    path: '/dmat-info',
  },
  {
    id: 'exam-pattern',
    title: 'Exam pattern',
    body: 'The structure, timing and format of the full sitting.',
    icon: 'ScrollText',
    path: '/dmat-exam-pattern',
  },
  {
    id: 'gam',
    title: 'General Academic Module',
    body: 'What the module is and how to practise it.',
    icon: 'GraduationCap',
    path: '/general-academic-module',
  },
  {
    id: 'changelog',
    title: 'Public changelog',
    body: 'CoreForge’s own release notes, listed separately from the dMAT announcements.',
    icon: 'History',
    path: '/changelog',
  },
];

export type CoreforgeStat = {
  readonly id: string;
  /** The number to count up to. */
  readonly value: number;
  /** Appended after the number, e.g. ':00' or ' min'. */
  readonly suffix?: string;
  /** value + suffix as the site prints it. */
  readonly display: string;
  readonly label: string;
  readonly path: string;
};

export const COREFORGE_STATS: readonly CoreforgeStat[] = [
  {
    id: 'subject-modules',
    value: 8,
    display: '8',
    label: 'subject modules, every one in the official table',
    path: '/modules',
  },
  {
    id: 'core-subtests',
    value: 3,
    display: '3',
    label: 'Core Module subtests, each at exam timing',
    path: '/dmat-exam-pattern',
  },
  {
    id: 'subtest-clock',
    value: 25,
    suffix: ':00',
    display: '25:00',
    label: 'per Core subtest of 20 tasks',
    path: '/dmat-exam-pattern',
  },
  {
    id: 'subject-slot',
    value: 90,
    suffix: ' min',
    display: '90 min',
    label: 'the real subject-module slot',
    path: '/modules',
  },
  {
    id: 'demo-questions',
    value: 10,
    display: '10',
    label: 'free demo questions a day, no account needed',
    path: '/demo',
  },
  {
    id: 'brain-gym-drills',
    value: 40,
    display: '40',
    label: 'Brain Gym drills, ten levels each',
    path: '/brain-gym',
  },
];

export type CoreforgeMilestone = {
  /** YYYY-MM-DD */
  readonly date: string;
  readonly title: string;
  readonly summary: string;
  /** The entry in the goldensdmat.in news hub. */
  readonly path: string;
};

/**
 * Public changelog, newest first. The 7 Aug 2026 'free 7-day trial' pricing entry
 * is left out: the Free plan superseded it on 21 Aug 2026.
 */
export const COREFORGE_CHANGELOG: readonly CoreforgeMilestone[] = [
  {
    date: '2026-09-06',
    title: 'Brain Gym, subject skills and an index of outside material',
    summary:
      'Seeded speed and attention drills, optional streaks and daily goals with a calm mode that turns every animation off, topic drills for missed subject questions, and a checked index of free outside lessons.',
    path: '/news#brain-gym-and-skills',
  },
  {
    date: '2026-08-21',
    title: 'The Free plan replaces the trial: Core Module practice for every account',
    summary:
      'Every account gets Core Module practice at easy difficulty in 3-question sets, with results, answer review and history — no card, no expiry.',
    path: '/news#free-plan-replaces-trial',
  },
  {
    date: '2026-08-07',
    title: 'Every published dMAT subject module is now on CoreForge',
    summary: 'Computer Science, Data Science and all five Battery Science tracks join the General Academic Module.',
    path: '/news#subject-modules-live',
  },
  {
    date: '2026-07-18',
    title: 'GAM practice now spans all 8 official topic areas',
    summary:
      'Mathematics, computational sciences, natural sciences, engineering, business administration, economics, social sciences and humanities, each with its own passages.',
    path: '/news#gam-bank-expansion',
  },
];

/** How the Core generators check a task before it is served (from his launch post and LinkedIn entry). */
export const COREFORGE_GENERATOR_CHECKS = [
  {
    subtest: 'Figure Sequences',
    check: 'Passes a strict inferability check: the rule must be uniquely deducible.',
  },
  {
    subtest: 'Mathematical Equations',
    check: 'Brute-forced to guarantee exactly one whole-number solution.',
  },
  {
    subtest: 'Latin Squares',
    check: 'Verified so every valid completion agrees on the answer cell.',
  },
] as const;

/** From his LinkedIn Owner entry. */
export const COREFORGE_BUILT_WITH = [
  { name: 'TypeScript', role: 'Question-generation algorithms, built with Claude' },
  { name: 'Supabase', role: 'Backend with cross-device sync and leaderboards' },
] as const;

export type CoreforgeFaq = {
  readonly id: string;
  readonly q: string;
  readonly a: string;
  /** Where the answer is covered on goldensdmat.in. */
  readonly path: string;
};

export const COREFORGE_FAQ: readonly CoreforgeFaq[] = [
  {
    id: 'what-is-dmat',
    q: 'What is the dMAT?',
    a: 'The digitaler Mastertest (dMAT) is an aptitude test that international applicants to German Master’s programmes may be asked to sit. g.a.s.t. and the TestDaF-Institut run it, with DAAD support. You sit the Core Module and one subject module in a single session of roughly 3.5 hours, break included; it is taken on a computer, in English, with single-choice answers.',
    path: '/dmat-info',
  },
  {
    id: 'who-must-sit',
    q: 'Who has to sit it from SoSe 2027?',
    a: 'From the Summer Semester 2027 intake, India APS applicants whose previous degree is in Engineering, Commerce / Accounting / Finance / Economics, or Business / Management must take the dMAT with the General Academic Module. Bachelor’s and PhD applicants and officially confirmed exchange, partnership or double-degree students are not affected. The ‘Do I need the dMAT?’ checker matches your degree against APS India’s official list; confirm on aps-india.de before you act.',
    path: '/dmat-info',
  },
  {
    id: 'free-plan',
    q: 'What does the Free plan include?',
    a: 'Core Module practice (Figure Sequences, Mathematical Equations and Latin Squares) at easy difficulty in 3-question sets, plus your results, answer review and history, and Brain Gym levels 1 to 3. No card, no expiry. The public demo also gives anyone 10 questions a day without an account.',
    path: '/pricing',
  },
  {
    id: 'pro',
    q: 'What does Pro add?',
    a: `${COREFORGE_PRO_SUMMARY} It is monthly or yearly, cancels in one tap and has a 7-day money-back guarantee on the first purchase. Current prices are on the pricing page.`,
    path: '/pricing',
  },
  {
    id: 'official',
    q: 'Is CoreForge official?',
    a: `No. ${COREFORGE_DISCLAIMER} Question formats follow publicly documented dMAT task types, and all questions are originally generated.`,
    path: '/welcome',
  },
  {
    id: 'generation',
    q: 'How are the questions made?',
    a: 'Core tasks are freshly generated in the official formats rather than drawn from a stored bank. Figure sequences must pass a strict inferability check so the rule is uniquely deducible, equation systems are brute-forced to have exactly one whole-number solution, and Latin squares are verified so every valid completion agrees on the answer cell. General Academic Module questions keep the official shape, a reading passage with single-choice questions of exactly four options and one correct, and each one passes a validator before it ships.',
    path: '/welcome',
  },
  {
    id: 'brain-gym',
    q: 'What is Brain Gym?',
    a: 'Forty short, seeded drills for the speed, attention, memory and reasoning the Core Module leans on, ten levels each. One round a day plays without an account, and the Free plan opens levels 1 to 3. It is practice-adjacent, not part of the exam.',
    path: '/brain-gym',
  },
  {
    id: 'hindi',
    q: 'Is there a Hindi explainer?',
    a: 'Yes. The ‘Do I need the dMAT?’ page has a Hindi summary (हिंदी में) of what the dMAT is, who has to sit it, what the paper covers, fees and registration, and scoring. The exam itself is sat in English.',
    path: '/dmat-info',
  },
];
