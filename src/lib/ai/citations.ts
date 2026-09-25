/*
 * Citation markers in model text: '[c:<id>]', one id per marker, or several
 * separated by commas ('[c:exp:0, exp:1]'). Parsing never throws; a malformed
 * marker is plain text to splitCitations() and is removed by keepAllowed().
 *
 * Pure: relative .ts imports only.
 */
import { targetHref } from './actions.ts';
import type { AiSource } from './protocol.ts';

export type CitePart = { text: string } | { cite: string };

const ID = /^[a-z]+:[\w#.-]+$/;
const MARKER = /\[c:([^[\]\n]*)\]/g;
const DANGLING = /\[c:[^\]\n]*$/;

function idsIn(inner: string): string[] | null {
  const ids = inner
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/^c:/, ''))
    .filter(Boolean);
  return ids.length && ids.every((id) => ID.test(id)) ? ids : null;
}

/** Text and citation parts in order; adjacent text parts are merged. */
export function splitCitations(text: string): CitePart[] {
  const out: CitePart[] = [];
  if (typeof text !== 'string' || !text) return out;
  const pushText = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && 'text' in prev) prev.text += t;
    else out.push({ text: t });
  };
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    const ids = idsIn(m[1]);
    if (!ids) continue;
    pushText(text.slice(last, m.index));
    for (const id of ids) out.push({ cite: id });
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}

type IdSet = ReadonlySet<string> | readonly string[];

function has(set: IdSet, id: string): boolean {
  return Array.isArray(set) ? set.includes(id) : (set as ReadonlySet<string>).has(id);
}

/**
 * Keeps markers whose ids are allowed (one '[c:id]' per id) and removes the
 * rest, with the space before them. `dropped` counts every removed id, plus one
 * per malformed or unterminated marker. `cited` lists kept ids once, in order.
 */
export function keepAllowed(text: string, allowed: IdSet): { text: string; cited: string[]; dropped: number } {
  if (typeof text !== 'string') return { text: '', cited: [], dropped: 0 };
  let dropped = 0;
  const cited: string[] = [];
  // Removed markers become a sentinel first, so the spacing around them can be
  // tidied in one place: none before punctuation or a line end, one space otherwise.
  const GONE = '\u0001';
  let out = text.replace(MARKER, (_whole, inner: string) => {
    const ids = idsIn(inner);
    if (!ids) {
      dropped += 1;
      return GONE;
    }
    const kept = ids.filter((id) => has(allowed, id));
    dropped += ids.length - kept.length;
    if (!kept.length) return GONE;
    for (const id of kept) if (!cited.includes(id)) cited.push(id);
    return kept.map((id) => `[c:${id}]`).join('');
  });
  if (DANGLING.test(out)) {
    dropped += 1;
    out = out.replace(DANGLING, GONE);
  }
  out = out
    .replace(/[ \t]*\u0001+(?=[.,;:!?)\]\n]|$)/g, '')
    .replace(/[ \t]*\u0001+[ \t]*/g, ' ');
  return { text: out, cited, dropped };
}

/** The line every exported answer carries. */
export const AI_EXPORT_NOTE = 'AI-generated from the content of basuoikantik.in. It may be wrong; check the sources.';

/**
 * The answer as Markdown: each cited source becomes a numbered footnote (numbered
 * by first use) linking to the page that shows it, then the AI-generated line.
 * Markers for unknown sources are dropped.
 */
export function toMarkdown(
  text: string,
  sources: readonly AiSource[],
  opts: { origin: string; caseStudySlugs: ReadonlySet<string> | readonly string[] },
): string {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const order: string[] = [];
  const origin = opts.origin.replace(/\/+$/, '');
  let body = '';
  for (const part of splitCitations(typeof text === 'string' ? text.replace(DANGLING, '') : '')) {
    if ('text' in part) {
      body += part.text;
      continue;
    }
    if (!byId.has(part.cite)) continue;
    if (!order.includes(part.cite)) order.push(part.cite);
    body += `[^${order.indexOf(part.cite) + 1}]`;
  }
  body = body.replace(/[ \t]+(\[\^\d+\])/g, '$1').trim();
  const notes = order.map((id, i) => {
    const s = byId.get(id)!;
    const extra = [s.cls === 'reference' ? 'general reference' : '', s.asOf ? `as of ${s.asOf}` : ''].filter(Boolean).join(', ');
    return `[^${i + 1}]: [${s.label.replace(/[[\]]/g, '')}](${origin}${targetHref(s.target, opts.caseStudySlugs)})${extra ? ` (${extra})` : ''}`;
  });
  return [body, notes.join('\n'), `_${AI_EXPORT_NOTE}_`].filter(Boolean).join('\n\n');
}
