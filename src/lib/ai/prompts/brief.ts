/*
 * The custom role brief ('I'm hiring for: ___', POST /api/ai/brief) and the
 * precomputed lens pitches (scripts/ai/gen-recruiter.mjs). Both return claims
 * that are verified before anything renders, so the model is asked for short,
 * single-fact sentences with verbatim quotes.
 *
 * Pure: relative .ts imports only.
 */
import { AUDIENCE_LABEL, LENS_AUDIENCES, SOFTENER_PHRASES } from '../fit.ts';
import { buildSystem, untrusted } from './base.ts';

const NO_SOFTENERS = `Never soften a gap or guess at what he might know. Forbidden phrasings include: ${SOFTENER_PHRASES.map((p) => `'${p}'`).join(', ')}.`;
// buildSystem's honesty rules ask for [c:id] markers in prose; a JSON answer carries ids in its own fields.
const JSON_CITES = 'In this JSON answer, ids go only in the evidence or cites fields: write no [c:...] markers inside any text.';

const BRIEF_TASK = `A recruiter says what role they are hiring for. Write a short brief on how Oikantik's work on this site relates to that role.
Return JSON only:
- claims: three to six sentences in the third person, each stating one fact from CONTEXT that is relevant to the role. Each claim carries one to three evidence items: a CONTEXT chunk id and a short quote (2 to 12 words) copied character for character from that chunk.
- projects: up to three project slugs from CONTEXT (the part after 'project:' and before '#') that best show relevant work.
If CONTEXT has little that relates to the role, return fewer claims rather than stretching. Never claim he fits the role; state what the site shows.`;

export function briefSystem(opts: { context: string; canary: string }): string {
  return buildSystem({
    task: BRIEF_TASK,
    context: opts.context,
    canary: opts.canary,
    rules: [
      NO_SOFTENERS,
      JSON_CITES,
      'Quotes must be exact substrings of the cited chunk. Numbers must be copied as digits exactly from the chunk they cite.',
      'Each claim restates what its cited chunks say and adds nothing: never join facts from different chunks into a claim neither makes.',
    ],
  });
}

export function briefUserTurn(title: string): string {
  return untrusted('role title the recruiter is hiring for', title);
}

/* ---- lens pitches (build time) ---- */

const LENS_TASK = `Write a third-person pitch for Oikantik as seen through one lens, for a recruiter skimming his portfolio, in three versions:
${LENS_AUDIENCES.map((a) => `- ${a}: for a ${AUDIENCE_LABEL[a].toLowerCase()} reader${a === 'plain' ? ' (no jargon)' : a === 'manager' ? ' (what he has done and can take on)' : ' (the tools and techniques by name)'}.`).join('\n')}
Length matters: each version must total 100 to 115 words (count them). Write 6 or 7 sentences of about 16 to 18 words each; a version under 90 words is rejected, so when in doubt add a sentence with another fact from CONTEXT. Every sentence states only facts from CONTEXT and lists the CONTEXT ids it rests on in cites.
Return JSON only: {plain, manager, engineer}, each a list of {text, cites}.`;

export function lensSystem(opts: { lens: string; context: string; canary: string }): string {
  return buildSystem({
    task: `${LENS_TASK}\nThe lens: ${opts.lens}.`,
    context: opts.context,
    canary: opts.canary,
    rules: [
      NO_SOFTENERS,
      JSON_CITES,
      "Use no inflating words (expert, proficient, extensive experience, led, architected, senior, production-scale, world-class) unless CONTEXT says them verbatim, and don't use superlatives.",
      'Copy every number as digits, and every product, company and degree name, exactly as CONTEXT writes it. Never spell a number out in words.',
      "Each sentence restates what its cited chunks say and adds nothing: no inferred purposes, datasets, users, industries or tools. Never join facts from different chunks into a claim neither makes; a skill listed on the site is not evidence it was used in a particular role or project unless a cited chunk says so.",
      'The plain version uses simpler words for the same facts; it never adds a detail the other versions lack.',
    ],
  });
}
