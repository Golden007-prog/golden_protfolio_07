/*
 * The contact form's limits and its two text operations: the contact:prefill
 * hand-off contract and dictation's append. They live apart from draft.ts so the
 * form (on the home page's first load) doesn't carry the draft filter and its
 * verifier; draft.ts re-exports them for the AI side.
 *
 * Pure: relative .ts imports only, no JSON, so node --test runs it directly.
 */
import { AI_LIMITS } from './config.ts';

/** The contact form's message limits. The form, the check route and every insert respect them. */
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;
export const SUBJECT_MAX = AI_LIMITS.title;

export type PrefillFields = { message: string; subject: string | null };

/**
 * The contact:prefill contract every hand-off relies on (concierge, recruiter,
 * discovery). The message goes below what the visitor already wrote, is skipped
 * when the field already contains it, and the result is capped at `max`. A subject
 * applies only while the visitor's own subject is empty. Returns only what changes.
 */
export function applyPrefill(
  current: PrefillFields,
  incoming: { message?: string; subject?: string },
  max: number = MESSAGE_MAX,
): Partial<PrefillFields> {
  const patch: Partial<PrefillFields> = {};
  const message = typeof incoming.message === 'string' ? incoming.message.trim() : '';
  if (message && !current.message.includes(message)) {
    const mine = current.message.trimEnd();
    const next = (mine ? `${mine}\n\n${message}` : message).slice(0, max);
    if (next !== current.message) patch.message = next;
  }
  const subject = typeof incoming.subject === 'string' ? incoming.subject.replace(/\s+/g, ' ').trim().slice(0, SUBJECT_MAX) : '';
  if (subject && !current.subject?.trim()) patch.subject = subject;
  return patch;
}

/** Appends a dictated phrase after the text, with one space between, capped at `max`. */
export function appendText(current: string, addition: string, max: number = MESSAGE_MAX): string {
  const add = typeof addition === 'string' ? addition.replace(/\s+/g, ' ').trim() : '';
  if (!add) return current;
  const joined = !current ? add : /\s$/.test(current) ? current + add : `${current} ${add}`;
  return joined.slice(0, max);
}
