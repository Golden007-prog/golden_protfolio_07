/*
 * What a screen reader hears when a concierge message joins the conversation:
 * its words, once, without the badges, chips, links and buttons drawn around
 * them. The conversation log itself is silent (aria-live="off"), because a
 * live region reads every control inside an added bubble.
 *
 * Pure: relative .ts imports only, so `node --test` can load it.
 */
import { citeParts, plainAnswer } from '../citeParts.ts';
import type { RuleNote } from './useConversation.ts';

/** One run of speech; `lang` marks a non-English answer so the reader can switch voice. */
export type SpokenPart = { text: string; lang?: string };

// Copy shared with the bubbles, so what is heard matches what is shown.
export const AI_SPOKEN = 'AI-generated, may be wrong.';
export const DEGRADED_NOTE = "Some statements couldn't be checked against the site and were removed.";
export const INCOMPLETE_NOTE = 'The answer is incomplete.';
export const ASK_DIRECTLY = 'You can ask Oikantik directly; the question goes into the contact form for you to send.';
export const QUICK_IN_ENGLISH = 'Quick answers are in English.';

export function englishOnlyNote(language: string): string {
  return `Shown in English: the ${language} version couldn't be checked against it.`;
}

/** The site has nothing on the question: the bubble offers to write to Oikantik instead of an answer. */
export function asksDirectly(note: RuleNote | undefined, intent: string | undefined): boolean {
  return note === 'nothing' && (!intent || intent === 'fallback');
}

/** Rule text ('**bold**' spans, '· ' bullets, one item per line) as spoken sentences. */
export function ruleSpeech(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/\*\*/g, '')
        .replace(/^\s*·\s*/, '')
        .replace(/\s+·\s+/g, ', ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`))
    .join(' ');
}

/** Model text without its citation markers. */
export function answerSpeech(text: string): string {
  return plainAnswer(citeParts(text));
}

// The status line ('Stopped', 'Nothing on this site covers that.') has already said these.
const NOTES_THE_STATUS_SAYS: ReadonlySet<RuleNote> = new Set<RuleNote>(['stopped', 'nothing']);

/** A rule bubble: why it stands in for an AI answer (when it does), then the quick answer. */
export function ruleSpoken(m: {
  text: string;
  intent?: string;
  note?: RuleNote;
  /** The fallback line the bubble shows for `note`. */
  noteText?: string | null;
  english?: boolean;
}): SpokenPart[] {
  const out: string[] = [];
  if (m.note && m.noteText && !NOTES_THE_STATUS_SAYS.has(m.note)) out.push(m.noteText);
  out.push(asksDirectly(m.note, m.intent) ? ASK_DIRECTLY : ruleSpeech(m.text));
  if (m.english) out.push(QUICK_IN_ENGLISH);
  const text = out.filter(Boolean).join(' ');
  return text ? [{ text }] : [];
}

/** An AI bubble: the disclosure once, the answer in its own language, then any note about it. */
export function aiSpoken(m: {
  text: string;
  /** A whitelisted tag when the answer is not English. */
  lang?: string | null;
  stopped?: boolean;
  degraded?: boolean;
  /** The quick answer a degraded bubble shows under the note. */
  ruleText?: string;
  /** The language asked for, by name, when the answer fell back to English. */
  englishFrom?: string | null;
}): SpokenPart[] {
  const out: SpokenPart[] = [{ text: AI_SPOKEN }];
  const answer = answerSpeech(m.text);
  if (answer) out.push(m.lang ? { text: answer, lang: m.lang } : { text: answer });
  const notes: string[] = [];
  if (answer && m.stopped) notes.push(INCOMPLETE_NOTE);
  if (answer && m.englishFrom) notes.push(englishOnlyNote(m.englishFrom));
  if (m.degraded) notes.push(DEGRADED_NOTE, ruleSpeech(m.ruleText ?? ''));
  const tail = notes.filter(Boolean).join(' ');
  if (tail) out.push({ text: tail });
  return out;
}

export function spokenText(parts: readonly SpokenPart[]): string {
  return parts.map((p) => p.text).join(' ');
}
