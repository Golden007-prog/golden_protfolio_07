/*
 * Follow-up questions and starter prompts for the concierge.
 *
 * The model ends an answer with a 'FOLLOWUPS: a | b | c' line. The route cuts
 * that line off before the sentence filter sees it (createFollowupSplitter), and
 * keeps at most three follow-ups, only those that name a known project, skill,
 * company or section and no organisation the site doesn't list (keepFollowups).
 * A follow-up is only ever a suggested question: tapping one sends it through the
 * rule-first path like typed text, so it can't smuggle a claim into an answer.
 *
 * startersFor() picks the starter chips for where the visitor is: an open
 * project, then the section in view, then the static starters.
 *
 * Pure: relative .ts imports only, no JSON.
 */
import { visible, type StoreEntry } from './reviewGate.ts';
import { cleanText } from './sanitize.ts';
import { KNOWN_ORGS, orgAliases } from './verify.ts';

export const MAX_FOLLOWUPS = 3;
export const MAX_STARTERS = 4;
const MAX_QUESTION = 140;

/* ---------------------------------------------------------------------------
 * Splitting the FOLLOWUPS line off a stream
 * ------------------------------------------------------------------------- */

// The marker at the start of a line, allowing Markdown decoration ('**Follow-ups:**').
// Matched against '\n' + buffer when the buffer itself starts a line.
const MARKER = /\n[ \t>*_#-]*follow[- ]?ups?[ \t*_]*:[ \t*_]*/i;
const MARKER_WORDS = ['followups:', 'follow-ups:', 'follow ups:', 'followup:', 'follow-up:', 'follow up:'];

/** True when `line` could still grow into the marker ('FOLL', '**Follow-'). */
function couldBeMarker(line: string): boolean {
  const bare = line.replace(/^[ \t>*_#-]*/, '').toLowerCase();
  if (!bare) return line.length > 0 && line.length < 8;
  return bare.length < 16 && MARKER_WORDS.some((m) => m.startsWith(bare.replace(/[ \t*_]+$/, '')) || bare.startsWith(m));
}

export type FollowupSplitter = {
  /** Text safe to pass on to the sentence filter now. */
  push(delta: string): string;
  /** The rest of the answer text, and whatever followed the marker. */
  end(): { text: string; raw: string };
};

export function createFollowupSplitter(): FollowupSplitter {
  let buf = '';
  let raw = '';
  let found = false;
  // Whether buf begins at the start of a line (the answer's first line does).
  let lineStart = true;

  const forward = (out: string): string => {
    if (out) lineStart = out.endsWith('\n');
    return out;
  };

  const scan = (final: boolean): string => {
    const lead = lineStart ? 1 : 0;
    const probe = (lineStart ? '\n' : '') + buf;
    const m = MARKER.exec(probe);
    if (m) {
      found = true;
      const out = buf.slice(0, Math.max(0, m.index - lead));
      raw += probe.slice(m.index + m[0].length);
      buf = '';
      return out;
    }
    if (final) {
      const out = buf;
      buf = '';
      return forward(out);
    }
    // Hold back a last line that may be the start of the marker.
    const nl = buf.lastIndexOf('\n');
    const last = buf.slice(nl + 1);
    if ((nl >= 0 || lineStart) && couldBeMarker(last)) {
      const out = buf.slice(0, nl + 1);
      buf = last;
      return forward(out);
    }
    const out = buf;
    buf = '';
    return forward(out);
  };

  return {
    push(delta) {
      if (typeof delta !== 'string' || !delta) return '';
      if (found) {
        raw += delta;
        return '';
      }
      buf += delta;
      return scan(false);
    },
    end() {
      const text = found ? '' : scan(true);
      return { text, raw };
    },
  };
}

/** The raw FOLLOWUPS text as candidate questions: split on '|', ';' or new lines, list markers removed. */
export function parseFollowups(raw: string): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/\s*\|\s*|\s*;\s*|\n+/)
    .map((s) =>
      s
        .replace(/^[\s>*_#-]*(?:\d{1,2}[.)]\s*)?/, '')
        .replace(/^["'“”‘’]+|["'“”‘’*_]+$/g, '')
        .trim(),
    )
    .filter(Boolean);
}

/* ---------------------------------------------------------------------------
 * Keeping only grounded follow-ups
 * ------------------------------------------------------------------------- */

export type FollowupNames = {
  projects: readonly string[];
  skills: readonly string[];
  companies: readonly string[];
  /** Section labels ('Experience', 'Principles'); they count only as '<label> section'. */
  sections: readonly string[];
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (name: string, flags: string) => new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, flags);

function names(n: FollowupNames): string[] {
  return [...new Set([...n.projects, ...n.skills, ...n.companies.flatMap(orgAliases)].filter((x) => x.trim().length >= 2))];
}

/** Organisations the site does not list: KNOWN_ORGS minus any that are part of a known name ('IBM' in a project name). */
function foreignOrgs(known: readonly string[]): string[] {
  const lower = known.map((k) => k.toLowerCase());
  return KNOWN_ORGS.filter((org) => !lower.some((k) => word(org.toLowerCase(), 'i').test(k)));
}

function mentions(q: string, list: readonly string[]): boolean {
  // Names that differ only in case from another technology keep their case (ReAct is not React).
  return list.some((n) => word(n, /[a-z][A-Z]/.test(n) ? '' : 'i').test(q));
}

/**
 * At most `max` follow-ups that read as questions, name a known project, skill,
 * company or '<section> section', and name no organisation the site doesn't list.
 */
export function keepFollowups(candidates: readonly string[], known: FollowupNames, max = MAX_FOLLOWUPS): string[] {
  const all = names(known);
  const foreign = foreignOrgs(all);
  const sections = known.sections.map((s) => new RegExp(`\\b${escape(s)}\\s+section\\b`, 'i'));
  const out: string[] = [];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const q = cleanText(c)
      .replace(/\[c:[^\]]*\]/g, '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (q.length < 8 || q.length > MAX_QUESTION || !q.endsWith('?')) continue;
    if (/https?:\/\/|www\.|@/.test(q)) continue;
    if (foreign.some((org) => word(org, '').test(q))) continue;
    if (!mentions(q, all) && !sections.some((re) => re.test(q))) continue;
    if (out.some((x) => x.toLowerCase() === q.toLowerCase())) continue;
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Starter prompts
 * ------------------------------------------------------------------------- */

export type StarterValue = { questions: string[] };
export type StarterEntries = Readonly<Record<string, StoreEntry<StarterValue> | undefined>>;

/** Store key for a section's or a project's starters. */
export const starterKey = {
  section: (id: string) => `section:${id}`,
  project: (slug: string) => `project:${slug}`,
};

function questionsOf(entry: StoreEntry<StarterValue> | undefined, showUnreviewed: boolean): string[] {
  if (!entry || !visible(entry, showUnreviewed)) return [];
  const qs = Array.isArray(entry.value?.questions) ? entry.value.questions : [];
  return qs
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.replace(/\s+/g, ' ').trim())
    .filter((q) => q.length > 0 && q.length <= MAX_QUESTION)
    .slice(0, MAX_STARTERS);
}

/** Starters for an open project, else the section in view, else `fallback` (the static STARTERS). */
export function startersFor(opts: {
  entries: StarterEntries | null | undefined;
  showUnreviewed: boolean;
  project?: string | null;
  section?: string | null;
  fallback: readonly string[];
}): string[] {
  const entries = opts.entries ?? {};
  if (opts.project) {
    const qs = questionsOf(entries[starterKey.project(opts.project)], opts.showUnreviewed);
    if (qs.length) return qs;
  }
  if (opts.section) {
    const qs = questionsOf(entries[starterKey.section(opts.section)], opts.showUnreviewed);
    if (qs.length) return qs;
  }
  return [...opts.fallback];
}
