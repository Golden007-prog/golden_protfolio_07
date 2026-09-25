/*
 * Output hygiene for model text and model-proposed UI actions. cleanText strips
 * markup, scrubContacts removes any URL, email or phone number that is not on
 * the site's own allow-list, and validTarget/validAction turn untrusted JSON into
 * a target or action the app knows, or null.
 *
 * Pure: relative .ts imports only.
 */
import { AI_LIMITS } from './config.ts';
import type { AiAction, AiTarget } from './protocol.ts';
import type { SectionId } from '../site.ts';

/* ---------------------------------------------------------------------------
 * Text
 * ------------------------------------------------------------------------- */

/**
 * Plain text from model output: script/style blocks and HTML tags removed,
 * Markdown links and images reduced to their text, invisible and control
 * characters dropped, runs of spaces collapsed. Newlines and '**' emphasis stay.
 */
export function cleanText(s: string): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)?/g, '$1')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)?/g, '$1')
    .replace(/<\/?[A-Za-z][^<>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}

/* ---------------------------------------------------------------------------
 * Contacts
 * ------------------------------------------------------------------------- */

export type ContactAllow = {
  urls: readonly string[];
  emails: readonly string[];
  phones?: readonly string[];
};

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const EMAIL_RE = /\b(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
/**
 * Phone-shaped digit runs: an optional +country code, an optional (area) code,
 * then groups of 2 to 5 digits joined by single separators, or one unbroken run
 * of 8 to 13 digits. isPhone() then requires enough digits, so years, dates,
 * versions and metrics ('2026', '2025-09-25', 'Python 3.12', 'R² 0.999') never qualify.
 */
export const PHONE_RE =
  /(?<![\w+])(?<!\d\.)(?:\+\d{1,3}[\s.-]*)?(?:\(\d{1,5}\)[\s.-]*)?(?:\d{2,5}(?:[\s.-]\d{2,5}){1,5}|\d{8,13})(?!\w|\.\d)/g;

export function isPhone(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  const prefixed = /^\s*\+|^\s*\(/.test(match);
  return digits.length >= 10 ? digits.length <= 15 : prefixed && digits.length >= 8;
}

function normUrl(u: string): string {
  return u
    .trim()
    .replace(/^www\./i, 'https://www.')
    .replace(/^http:\/\//i, 'https://')
    .replace(/^https:\/\/www\./i, 'https://')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function urlAllowed(url: string, allow: readonly string[]): boolean {
  const u = normUrl(url);
  if (/^https:\/\/basuoikantik\.in(?:\/|$)/.test(u)) return true;
  return allow.some((a) => {
    const n = normUrl(a);
    return n && (u === n || u.startsWith(`${n}/`));
  });
}

function splitTrailing(s: string): [string, string] {
  const m = /[.,;:!?)\]}'"]+$/.exec(s);
  return m ? [s.slice(0, m.index), m[0]] : [s, ''];
}

/**
 * Removes every URL, email and phone number not on the allow-list. The site's
 * own origin is always allowed. Removed items leave no placeholder.
 */
export function scrubContacts(s: string, allow: ContactAllow): string {
  if (typeof s !== 'string') return '';
  const emails = new Set(allow.emails.map((e) => e.toLowerCase()));
  const phones = new Set((allow.phones ?? []).map((p) => p.replace(/\D/g, '')));
  // Removed items become a sentinel, then the spacing around them is tidied
  // without touching whitespace anywhere else in the text.
  const GONE = '\u0001';
  let out = s.replace(URL_RE, (raw) => {
    const [url, tail] = splitTrailing(raw);
    return urlAllowed(url, allow.urls) ? raw : GONE + tail;
  });
  out = out.replace(EMAIL_RE, (raw) => {
    const address = raw.replace(/^mailto:/i, '');
    return emails.has(address.toLowerCase()) ? raw : GONE;
  });
  out = out.replace(PHONE_RE, (raw) => (!isPhone(raw) || phones.has(raw.replace(/\D/g, '')) ? raw : GONE));
  return out
    .replace(/[ \t]*\u0001+(?=[.,;:!?)\]\n]|$)/g, '')
    .replace(/[ \t]*\u0001+[ \t]*/g, ' ');
}

/* ---------------------------------------------------------------------------
 * Targets and actions
 * ------------------------------------------------------------------------- */

type NameSet = ReadonlySet<string> | readonly string[];

export type KnownTargets = {
  slugs: NameSet;
  skills: NameSet;
  sections: NameSet;
  expCount: number;
  eduCount: number;
  readingCount: number;
  tenetCount: number;
  /** When given, filter actions may only name these project categories. */
  categories?: NameSet;
};

function list(set: NameSet): readonly string[] {
  return Array.isArray(set) ? set : [...(set as ReadonlySet<string>)];
}

/** The canonical member equal to `value`, case-insensitively as a fallback. */
function member(set: NameSet, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  const all = list(set);
  if (all.includes(v)) return v;
  const lower = v.toLowerCase();
  return all.find((x) => x.toLowerCase() === lower) ?? null;
}

function index(value: unknown, count: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : null;
}

/** A target the app knows, rebuilt with only its own fields, or null. */
export function validTarget(t: unknown, known: KnownTargets): AiTarget | null {
  if (!t || typeof t !== 'object') return null;
  const x = t as Record<string, unknown>;
  switch (x.kind) {
    case 'project': {
      const slug = typeof x.slug === 'string' && list(known.slugs).includes(x.slug) ? x.slug : null;
      return slug ? { kind: 'project', slug } : null;
    }
    case 'skill': {
      const name = member(known.skills, x.name);
      return name ? { kind: 'skill', name } : null;
    }
    case 'section': {
      const id = typeof x.id === 'string' && list(known.sections).includes(x.id) ? (x.id as SectionId) : null;
      return id ? { kind: 'section', id } : null;
    }
    case 'experience':
    case 'education':
    case 'reading':
    case 'tenet': {
      const count = { experience: known.expCount, education: known.eduCount, reading: known.readingCount, tenet: known.tenetCount }[x.kind];
      const i = index(x.index, count);
      return i === null ? null : { kind: x.kind, index: i };
    }
    case 'cv':
      return { kind: 'cv' };
    case 'contact':
      return { kind: 'contact' };
    default:
      return null;
  }
}

const MESSAGE_MAX = 2000;

function capped(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = cleanText(value).replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return v || undefined;
}

/** An action the app can run, rebuilt with only its own fields, or null. */
export function validAction(a: unknown, known: KnownTargets): AiAction | null {
  if (!a || typeof a !== 'object') return null;
  const x = a as Record<string, unknown>;
  switch (x.kind) {
    case 'open': {
      const target = validTarget(x.target, known);
      return target ? { kind: 'open', target } : null;
    }
    case 'filter': {
      const out: Extract<AiAction, { kind: 'filter' }> = { kind: 'filter' };
      const cat = capped(x.cat, AI_LIMITS.filterPhrase);
      if (cat) {
        const c = known.categories ? member(known.categories, cat) : cat;
        if (!c) return null;
        out.cat = c;
      }
      const tech = capped(x.tech, AI_LIMITS.filterPhrase);
      if (tech) out.tech = tech;
      const q = capped(x.q, AI_LIMITS.filterPhrase);
      if (q) out.q = q;
      if (x.live === true) out.live = true;
      return out;
    }
    case 'prefill': {
      const message = typeof x.message === 'string' ? cleanText(x.message).trim().slice(0, MESSAGE_MAX).trim() : '';
      if (!message) return null;
      const subject = capped(x.subject, AI_LIMITS.title);
      return subject ? { kind: 'prefill', subject, message } : { kind: 'prefill', message };
    }
    case 'cv':
    case 'vcard':
    case 'copyEmail':
      return { kind: x.kind };
    default:
      return null;
  }
}
