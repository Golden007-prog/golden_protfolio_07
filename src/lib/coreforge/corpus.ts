/*
 * CoreForge's facts in the shape the AI corpus takes (CorpusCoreforge), so the build
 * script and the server build identical chunks from the same module. Pure, with
 * relative .ts imports, so scripts/ai/lib.mjs can load it under node.
 */
import type { CorpusCoreforge } from '../ai/corpus.ts';
import {
  COREFORGE_AUDIENCE,
  COREFORGE_BRAND,
  COREFORGE_BUILT_WITH,
  COREFORGE_CHANGELOG,
  COREFORGE_DISCLAIMER,
  COREFORGE_FACTS_CAPTURED_AT,
  COREFORGE_FAQ,
  COREFORGE_FEATURES,
  COREFORGE_FOUNDER,
  COREFORGE_FREE_PLAN,
  COREFORGE_GENERATOR_CHECKS,
  COREFORGE_POSITIONING,
  COREFORGE_PRO_SUMMARY,
  COREFORGE_RESOURCES,
  COREFORGE_STATS,
} from './facts.ts';

export const COREFORGE_CORPUS: CorpusCoreforge = {
  capturedAt: COREFORGE_FACTS_CAPTURED_AT,
  company: COREFORGE_BRAND.company,
  product: COREFORGE_BRAND.product,
  tagline: COREFORGE_BRAND.tagline,
  domain: COREFORGE_BRAND.domain,
  founderLine: COREFORGE_FOUNDER.line,
  linkedinTitle: COREFORGE_FOUNDER.linkedinTitle,
  sinceLabel: COREFORGE_FOUNDER.sinceLabel,
  positioning: COREFORGE_POSITIONING,
  audience: COREFORGE_AUDIENCE,
  freePlan: COREFORGE_FREE_PLAN,
  proSummary: COREFORGE_PRO_SUMMARY,
  disclaimer: COREFORGE_DISCLAIMER,
  features: COREFORGE_FEATURES,
  resources: COREFORGE_RESOURCES,
  stats: COREFORGE_STATS,
  generatorChecks: COREFORGE_GENERATOR_CHECKS,
  builtWith: COREFORGE_BUILT_WITH,
  changelog: COREFORGE_CHANGELOG,
  faq: COREFORGE_FAQ,
};
