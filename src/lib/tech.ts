// Word edges without \b, so names that start or end in punctuation (CI/CD, C++,
// Next.js) still anchor. Matching is case-sensitive on purpose: 'ReAct' (the agent
// pattern) must never match 'React' (the UI library).
const EDGE_BEFORE = '(?<![A-Za-z0-9])';
const EDGE_AFTER = '(?![A-Za-z0-9])';

function word(source: string): RegExp {
  return new RegExp(`${EDGE_BEFORE}(?:${source})${EDGE_AFTER}`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Model and service families whose stack entries carry versions, tiers or vendor
 * prefixes. 'Gemini' appears verbatim in only 1 of the 6 projects that use it.
 */
const FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [word('Gemini'), 'Gemini'],
  // Gemma derivatives are named <Prefix>Gemma (MedGemma, TxGemma, CodeGemma).
  [word('(?:[A-Z][a-z]*)?Gemma'), 'Gemma'],
  [word('(?:(?:AWS|Amazon) )?Bedrock'), 'AWS Bedrock'],
  [word('GPT(?:-[0-9][\\w.]*)?(?: API)?'), 'GPT'],
  [word('Claude(?: API)?'), 'Claude'],
];

// A trailing version: 'React 19', 'Next.js 14', 'Vite 6', 'Veo 3.1'.
const VERSION_SUFFIX = /\s+v?\d[\w.]*(?:\s.*)?$/;

/** Canonical family for a stack entry or skill name, used for facets and counts. */
export function techFamily(name: string): string {
  const trimmed = name.trim();
  for (const [pattern, family] of FAMILIES) {
    if (pattern.test(trimmed)) return family;
  }
  return trimmed.replace(VERSION_SUFFIX, '') || trimmed;
}

/**
 * True when any stack entry belongs to the skill's family, or names it as a whole
 * word ('Keras/TensorFlow' uses 'TensorFlow'; 'PostgreSQL' does not use 'SQL').
 */
export function matchesTech(stack: readonly string[], skill: string): boolean {
  const family = techFamily(skill);
  const inText = word(escapeRegExp(family));
  return stack.some((entry) => techFamily(entry) === family || inText.test(entry));
}

export function countByTech(items: readonly { techStack: readonly string[] }[], skill: string): number {
  return items.filter((item) => matchesTech(item.techStack, skill)).length;
}
