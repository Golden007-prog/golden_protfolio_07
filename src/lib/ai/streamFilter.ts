/*
 * The streaming sentence filter. Model deltas are buffered into sentences and a
 * sentence is released only after it passes every check, so nothing unverified
 * reaches the screen or a copied answer:
 *   1. HTML and Markdown links are stripped (cleanText);
 *   2. URLs, emails and phones not on the site allow-list are removed;
 *   3. the canary is looked for in the whole stream so far, so one split across
 *      deltas still trips, and a hit blocks the rest of the answer;
 *   4. citation ids outside the allowed set are removed (keepAllowed);
 *   5. the tripwire runs against the facts the sentence cites;
 *   6. a claim about Oikantik with no surviving citation, or citing only
 *      'reference' chunks, is dropped.
 * More than 30% of sentences dropped marks the answer degraded.
 *
 * Pure: relative .ts imports only.
 */
import { keepAllowed } from './citations.ts';
import { cleanText, scrubContacts, type ContactAllow } from './sanitize.ts';
import { orgAliases, tripwire, type ClaimEntities } from './verify.ts';

export type SentenceFilterOptions = {
  allowed: ReadonlySet<string> | readonly string[];
  facts: ReadonlyMap<string, string>;
  entities: ClaimEntities & { degrees?: readonly string[] };
  canary: string;
  allow: ContactAllow;
};

export type FilterEnd = {
  emit: string[];
  cited: string[];
  /** Sentences withheld by a check. */
  dropped: number;
  /** Sentences released. */
  kept: number;
  degraded: boolean;
  blocked?: 'canary';
};

export type SentenceFilter = {
  push(delta: string): { emit: string[]; blocked?: 'canary' };
  end(): FilterEnd;
};

export const DEGRADED_RATIO = 0.3;

// Words whose trailing period is not a sentence end.
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'approx', 'dr', 'mr', 'ms', 'mrs', 'st', 'no', 'fig', 'u.s', 'jr', 'sr', 'inc', 'ltd', 'sept']);

/**
 * The first sentence boundary in `buf`: end punctuation, closing quotes or
 * emphasis, any citation markers that follow it, then whitespace and the start
 * of the next sentence. A line break also ends a sentence. Null while the buffer
 * could still grow into a longer sentence (for instance '. [c' at its end).
 */
function nextBoundary(buf: string): { end: number; sep: string } | null {
  const re = /([.!?…]+)["'’”)*_]*((?:[ \t]*\[c:[^\]\n]*\])*)([ \t]*\n+[ \t]*|[ \t]+)(?=[^\s[]|\[[^c]|\[c[^:])|\n+(?=\S)/g;
  for (const m of buf.matchAll(re)) {
    if (m[1] === undefined) {
      return { end: m.index, sep: m[0] };
    }
    if (m[1] === '.') {
      const before = buf.slice(0, m.index);
      const word = /([A-Za-z][A-Za-z.]*)$/.exec(before)?.[1]?.toLowerCase() ?? '';
      if (ABBREVIATIONS.has(word) || /^[a-z]$/.test(word)) continue;
    }
    const end = m.index + m[0].length - m[3].length;
    return { end, sep: m[3] };
  }
  return null;
}

function canaryKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const META =
  /\b(?:isn['’]t|is not|aren['’]t|are not|not (?:listed|stated|mentioned|shown|given|on this site|available|covered|included)|no (?:information|details|mention|record)|doesn['’]t (?:say|mention|list|state|show)|does not (?:say|mention|list|state|show)|(?:couldn['’]t|can['’]t|could not|cannot) (?:find|see|confirm)|(?:don['’]t|do not) (?:have|know|see)|contact form|write to (?:him|Oikantik)|message (?:him|Oikantik))\b/i;
const ABOUT_HIM = /\b(?:he|his|him|himself|he['’]s|oikantik|basu)\b/i;

export function createSentenceFilter(opts: SentenceFilterOptions): SentenceFilter {
  const canary = canaryKey(opts.canary);
  const names = [
    ...opts.entities.companies.flatMap(orgAliases),
    ...opts.entities.institutions.flatMap(orgAliases),
    ...(opts.entities.projectNames ?? []),
    ...(opts.entities.degrees ?? []),
    // A listed credential named without a citation is a claim about him too.
    ...(opts.entities.certifications ?? []).map((c) => (typeof c === 'string' ? c : c.title)),
  ]
    .filter((n) => n.length >= 3)
    .map((n) => n.toLowerCase());

  let buf = '';
  let seen = '';
  let blocked = false;
  let kept = 0;
  let dropped = 0;
  const cited: string[] = [];

  /** True when an uncited sentence still states something about him. */
  const isClaim = (plain: string): boolean => {
    if (META.test(plain)) return false;
    if (ABOUT_HIM.test(plain) || /\d/.test(plain)) return true;
    const lower = plain.toLowerCase();
    return names.some((n) => lower.includes(n));
  };

  const check = (raw: string, sep: string): string | null => {
    if (canary && canaryKey(raw).includes(canary)) {
      blocked = true;
      return null;
    }
    const scrubbed = scrubContacts(cleanText(raw), opts.allow);
    const { text, cited: ids } = keepAllowed(scrubbed, opts.allowed);
    const plain = text.replace(/\[c:[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(plain)) {
      // Layout only (a stray marker, a rule, emphasis marks): pass the separator through.
      return plain ? `${text.trim()}${sep}` : sep.includes('\n') ? sep : null;
    }
    const evidence = ids.map((id) => opts.facts.get(id)).filter((f): f is string => typeof f === 'string');
    const reason = tripwire(text, evidence, opts.entities);
    // Reference chunks (ref:) describe a technology, never his use of it, so they
    // cannot carry a sentence about him on their own.
    const onlyReference = ids.length > 0 && ids.every((id) => id.startsWith('ref:'));
    if (reason || (ids.length === 0 && isClaim(plain)) || (onlyReference && ABOUT_HIM.test(plain) && !META.test(plain))) {
      dropped += 1;
      return null;
    }
    kept += 1;
    for (const id of ids) if (!cited.includes(id)) cited.push(id);
    return `${text.trim()}${sep}`;
  };

  const drain = (): string[] => {
    const out: string[] = [];
    for (let b = nextBoundary(buf); b && !blocked; b = nextBoundary(buf)) {
      const raw = buf.slice(0, b.end);
      buf = buf.slice(b.end + b.sep.length);
      const s = check(raw, b.sep.includes('\n') ? b.sep.replace(/[ \t]/g, '') : ' ');
      if (s) out.push(s);
    }
    return blocked ? [] : out;
  };

  return {
    push(delta: string) {
      if (blocked) return { emit: [], blocked: 'canary' };
      if (typeof delta !== 'string' || !delta) return { emit: [] };
      buf += delta;
      if (canary) {
        seen = (seen + canaryKey(delta)).slice(-(canary.length + 256));
        if (seen.includes(canary)) {
          blocked = true;
          buf = '';
          return { emit: [], blocked: 'canary' };
        }
      }
      const emit = drain();
      return blocked ? { emit: [], blocked: 'canary' } : { emit };
    },
    end() {
      const emit = blocked ? [] : drain();
      if (!blocked && buf.trim()) {
        const s = check(buf.trim(), '');
        if (s) emit.push(s);
      }
      buf = '';
      const total = kept + dropped;
      return {
        emit: blocked ? [] : emit,
        cited: [...cited],
        dropped,
        kept,
        degraded: blocked || (total > 0 && dropped / total > DEGRADED_RATIO),
        ...(blocked ? { blocked: 'canary' as const } : {}),
      };
    },
  };
}
