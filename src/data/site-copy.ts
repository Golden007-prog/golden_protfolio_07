/*
 * Site copy that today lives only inside components, gathered here so the AI
 * grounding corpus can cite it. The components are deliberately not rewired to
 * read from this file (the hero and its LCP path stay untouched), so every entry
 * names the file it was copied from and site-copy.test.ts fails, naming that file,
 * the moment the two drift apart.
 *
 * Pure: no JSON and no imports, so node --test and the corpus build script can
 * load it directly.
 */

export type CopySource =
  | 'src/components/shared/PhilosophySection.tsx'
  | 'src/components/hero/RoleTicker.tsx'
  | 'src/components/hero/HeroSection.tsx'
  | 'src/components/about/AboutSection.tsx'
  | 'src/components/skills/SkillsSection.tsx'
  | 'src/components/projects/ProjectsSection.tsx'
  | 'src/components/experience/ExperienceSection.tsx'
  | 'src/components/contact/ContactSection.tsx';

export type Tenet = { n: string; title: string; body: string };

export const PHILOSOPHY_SOURCE: CopySource = 'src/components/shared/PhilosophySection.tsx';

/** The six working principles, in display order. */
export const PHILOSOPHY: readonly Tenet[] = [
  {
    n: '01',
    title: 'Ship the boring version first.',
    body: 'A working end-to-end pipeline beats a half-finished clever one. Prove the wire, then tune the signal.',
  },
  {
    n: '02',
    title: 'Evals before vibes.',
    body: 'If you can’t measure it, you’re guessing. Every LLM feature gets a scored test set before it gets a UI.',
  },
  {
    n: '03',
    title: 'Small models, sharp prompts.',
    body: 'Most production problems don’t need a frontier model — they need a well-indexed retrieval layer and crisp instructions.',
  },
  {
    n: '04',
    title: 'Observability is a feature.',
    body: 'Traces, token counts, latency histograms, cost dashboards. The team that can see the system can fix the system.',
  },
  {
    n: '05',
    title: 'Data > architecture.',
    body: 'A clean, labeled, deduped dataset beats a fancy model. Spend the weekend on the CSVs, not the ConvNet.',
  },
  {
    n: '06',
    title: 'Write the docs you wish existed.',
    body: 'Half of engineering is unblocking the next person — usually future you. README first, commit second.',
  },
];

export const ROLES_SOURCE: CopySource = 'src/components/hero/RoleTicker.tsx';

/** The hero's rotating role line. */
export const ROLES: readonly string[] = [
  'Gen AI & Data Science Engineer',
  'LLM Agent Architect',
  'Production ML Engineer',
  'Data Pipeline Builder',
];

export const HERO_SOURCE: CopySource = 'src/components/hero/HeroSection.tsx';

/** The hero tagline under the role line (the JSX spells '&' as '&amp;'). */
export const HERO_TAGLINE = 'LLM fine-tuning · RAG · Multi-agent systems. Shipping production ML & agentic AI from Bengaluru.';

export type SectionCopy = {
  section: 'about' | 'skills' | 'projects' | 'experience' | 'philosophy' | 'contact';
  kind: 'title' | 'subtitle';
  /** Verbatim, including the '*word*' emphasis markers SectionHeading renders as a gradient. */
  text: string;
  source: CopySource;
};

/**
 * Section headings and subtitles. The projects subtitle interpolates a count, so
 * only its fixed lead-in is kept; the skills subtitle has two variants.
 */
export const SECTION_COPY: readonly SectionCopy[] = [
  { section: 'about', kind: 'title', text: 'The story behind the *stack*.', source: 'src/components/about/AboutSection.tsx' },
  { section: 'skills', kind: 'title', text: 'Tools in the *arsenal*.', source: 'src/components/skills/SkillsSection.tsx' },
  {
    section: 'skills',
    kind: 'subtitle',
    text: "Spin it, or tap a node to lock it center-stage. Every one is something I've shipped production code with.",
    source: 'src/components/skills/SkillsSection.tsx',
  },
  {
    section: 'skills',
    kind: 'subtitle',
    text: "Tap a node to open it. Every one is something I've shipped production code with.",
    source: 'src/components/skills/SkillsSection.tsx',
  },
  { section: 'projects', kind: 'title', text: "Things I've *built*.", source: 'src/components/projects/ProjectsSection.tsx' },
  {
    section: 'projects',
    kind: 'subtitle',
    text: 'From mechanistic-interpretability clinical AI to serverless voice commerce',
    source: 'src/components/projects/ProjectsSection.tsx',
  },
  { section: 'experience', kind: 'title', text: 'The journey so *far*.', source: 'src/components/experience/ExperienceSection.tsx' },
  {
    section: 'experience',
    kind: 'subtitle',
    text: "Internships, freelance AI work, and a Master's in progress — all pulling in the same direction.",
    source: 'src/components/experience/ExperienceSection.tsx',
  },
  { section: 'philosophy', kind: 'title', text: 'How I *build*.', source: 'src/components/shared/PhilosophySection.tsx' },
  {
    section: 'philosophy',
    kind: 'subtitle',
    text: 'Six working beliefs I return to — earned from production LLM systems, not from reading about them.',
    source: 'src/components/shared/PhilosophySection.tsx',
  },
  { section: 'contact', kind: 'title', text: "Let's build *something*.", source: 'src/components/contact/ContactSection.tsx' },
  {
    section: 'contact',
    kind: 'subtitle',
    text: 'Open to research, full-time AI/ML roles, and ambitious freelance work. I usually reply within a day.',
    source: 'src/components/contact/ContactSection.tsx',
  },
];

export const CONTACT_SOURCE: CopySource = 'src/components/contact/ContactSection.tsx';

/** The contact subtitle, which is also what the corpus cites as copy:contact. */
export const CONTACT_COPY =
  'Open to research, full-time AI/ML roles, and ambitious freelance work. I usually reply within a day.';

/** Shown after a successful send; repeats the reply-time promise. */
export const CONTACT_SENT = 'Thanks, your message is on its way. I usually reply within a day.';

/** The shape buildCorpus() takes as `siteCopy`. */
export type SiteCopy = {
  philosophy: readonly Tenet[];
  roles: readonly string[];
  hero: string;
  contact: string;
  sections: readonly SectionCopy[];
};

export const SITE_COPY: SiteCopy = {
  philosophy: PHILOSOPHY,
  roles: ROLES,
  hero: HERO_TAGLINE,
  contact: CONTACT_COPY,
  sections: SECTION_COPY,
};

/** Every string with the file it must still appear in; the drift test walks this list. */
export function copyEntries(): { text: string; source: CopySource }[] {
  return [
    ...PHILOSOPHY.flatMap((t) => [
      { text: t.title, source: PHILOSOPHY_SOURCE },
      { text: t.body, source: PHILOSOPHY_SOURCE },
    ]),
    ...ROLES.map((text) => ({ text, source: ROLES_SOURCE })),
    { text: HERO_TAGLINE, source: HERO_SOURCE },
    ...SECTION_COPY.map(({ text, source }) => ({ text, source })),
    { text: CONTACT_COPY, source: CONTACT_SOURCE },
    { text: CONTACT_SENT, source: CONTACT_SOURCE },
  ];
}
