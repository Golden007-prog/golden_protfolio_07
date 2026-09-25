export type SkillAccent = 'violet' | 'cyan' | 'amber' | 'pink';

/** One row of src/data/skills-index.json, written by scripts/build-skill-index.mjs. */
export interface SkillIndexEntry {
  name: string;
  category: string;
  /** The bold term of the one-line definition. */
  term: string;
  /** The rest of the definition, plain text, starting with a space. */
  def: string;
  /** public/skills/<slug>.webp exists. */
  hero: boolean;
}

export interface SkillPaper {
  title: string;
  url: string;
  authors?: string;
}

/** public/data/skills/<slug>.json, fetched when a skill opens. Empty lists are omitted. */
export interface SkillDetail {
  name: string;
  category: string;
  purpose?: string;
  coreComponents?: string[];
  keyCapabilities?: string[];
  integrations?: string[];
  useCases?: string[];
  officialDocs?: string;
  researchPapers?: SkillPaper[];
  sources?: string[];
}

/** A skill as the page uses it, in profile.json order. */
export interface Skill {
  name: string;
  slug: string;
  category: string;
  accent: SkillAccent;
  term: string;
  def: string;
  heroImage: string | null;
}

/** A skill shown on the sphere and the constellation. */
export interface SkillNode extends Skill {
  /** Unit vector on the sphere. */
  dir: readonly [number, number, number];
  /** Constellation position, as fractions of the stage. */
  x: number;
  y: number;
}

export interface SkillProjectRef {
  name: string;
  slug: string;
  tagline: string;
  githubUrl: string | null;
  liveUrl: string | null;
}
