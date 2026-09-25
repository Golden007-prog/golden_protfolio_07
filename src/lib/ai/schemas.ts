import { z, type ZodType } from 'zod';
import { PROJECTS } from '@/data/projects';
import profile from '@/data/profile.json';
import { SKILLS } from '@/lib/skills';
import { SECTIONS, type SectionId } from '@/lib/site';
import { AI_LIMITS } from './config';
import { validLang } from './prompts/base';
import type { AskRequest, AskScope } from './protocol';

/*
 * Request schemas shared by the AI routes (server only; zod never ships to the
 * client). Anything that can reach a prompt is validated against the site's own
 * data here: a scope names a real project, skill, role or section, and lang must
 * pass validLang.
 */

const SLUGS = PROJECTS.map((p) => p.slug) as [string, ...string[]];
const SKILL_NAMES = SKILLS.map((s) => s.name) as [string, ...string[]];
const SECTION_IDS = SECTIONS.map((s) => s.id) as [SectionId, ...SectionId[]];
const EXPERIENCE_COUNT = profile.experience.length;

/** A BCP 47 tag the prompts support, normalised by validLang. */
export const langSchema = z
  .string()
  .max(35)
  .transform((tag, ctx) => {
    const lang = validLang(tag);
    if (!lang) {
      ctx.addIssue({ code: 'custom', message: 'unsupported language' });
      return z.NEVER;
    }
    return lang;
  });

/** Exactly one of a known project slug, an exact skill name, a role index or a section id. */
export const scopeSchema = z.union([
  z.strictObject({ project: z.enum(SLUGS) }),
  z.strictObject({ skill: z.enum(SKILL_NAMES) }),
  z.strictObject({ experience: z.number().int().min(0).max(EXPERIENCE_COUNT - 1) }),
  z.strictObject({ section: z.enum(SECTION_IDS) }),
]) satisfies ZodType<AskScope>;

export const questionSchema = z.string().trim().min(1).max(AI_LIMITS.question);

/** The visitor's own earlier questions: at most 6, 2000 characters in all. */
export const historySchema = z
  .array(z.string().max(AI_LIMITS.question))
  .max(AI_LIMITS.historyTurns)
  .superRefine((turns, ctx) => {
    const total = turns.reduce((n, t) => n + t.length, 0);
    if (total > AI_LIMITS.historyChars) {
      ctx.addIssue({ code: 'too_big', origin: 'string', maximum: AI_LIMITS.historyChars, inclusive: true, message: 'history too long', input: turns });
    }
  });

/** Citation ids from earlier answers, e.g. 'project:omni-lab#summary'. Unknown ids are ignored later by packContext. */
export const prevCitedSchema = z
  .array(
    z
      .string()
      .max(120)
      .regex(/^[a-z]+:[\w#.-]+$/),
  )
  .max(AI_LIMITS.prevCited);

/** A string that must be one of `known` (for example project slugs or corpus ids). */
export function targetIdSchema(known: Iterable<string>) {
  const set = new Set(known);
  return z
    .string()
    .max(160)
    .refine((id) => set.has(id), { message: 'unknown id' });
}

/** POST /api/ai/ask, composed from the parts above. */
export const askRequestSchema = z.strictObject({
  question: questionSchema,
  history: historySchema.optional(),
  prevCited: prevCitedSchema.optional(),
  scope: scopeSchema.optional(),
  tools: z.boolean().optional(),
  lang: langSchema.optional(),
}) satisfies ZodType<AskRequest>;
