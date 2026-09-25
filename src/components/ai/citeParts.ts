/*
 * Answer text split into prose and citation chips, and the same answer as plain
 * prose. Pure: relative .ts imports only, so `node --test` can load it.
 */
import { splitCitations } from '../../lib/ai/citations.ts';
import type { AiSource } from '../../lib/ai/protocol.ts';

export type Part = { kind: 'text'; text: string } | { kind: 'cite'; source: AiSource; n: number };

// splitCitations leaves a malformed marker ('[c:fake]') as text; the server's
// allow-list removes those, and this keeps one from ever showing if it slips through.
const STRAY_MARKER = /\[c:[^[\]\n]*(\]|$)/g;

/**
 * Text and citation chips in reading order. A chip is numbered by its source's
 * first appearance; markers naming a source the answer did not list are dropped.
 */
export function citeParts(text: string, sources: readonly AiSource[] = []): Part[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const numbers = new Map<string, number>();
  const out: Part[] = [];
  for (const p of splitCitations(text)) {
    if ('cite' in p) {
      const source = byId.get(p.cite);
      if (!source) continue;
      if (!numbers.has(source.id)) numbers.set(source.id, numbers.size + 1);
      out.push({ kind: 'cite', source, n: numbers.get(source.id) ?? 0 });
    } else {
      const clean = p.text.replace(STRAY_MARKER, '');
      if (clean) out.push({ kind: 'text', text: clean });
    }
  }
  return out;
}

/** The answer as a screen reader should hear it: no markers, no doubled spaces. */
export function plainAnswer(parts: readonly Part[]): string {
  return parts
    .map((p) => (p.kind === 'text' ? p.text : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}
