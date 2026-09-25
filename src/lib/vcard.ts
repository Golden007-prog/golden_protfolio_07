/*
 * vCard 3.0 (RFC 2426) builder. Pure and JSON-free: callers pass the profile
 * values in. Lines end in CRLF and fold at 75 octets, as the RFC requires.
 */

export type VCardInput = {
  /** Display name, e.g. 'Oikantik Basu'. The last word becomes the family name. */
  name: string;
  email?: string;
  /** Any formatting ('+91 7001124396'); only digits and a leading '+' are kept. */
  phone?: string;
  title?: string;
  locality?: string;
  country?: string;
  urls?: readonly string[];
};

const CRLF = '\r\n';
const MAX_OCTETS = 75;

/** Escapes a text value (RFC 2426 s.4): backslash, comma, semicolon and newlines. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** '+91 7001124396' -> '+917001124396' */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/** Folds one content line into <=75-octet pieces; continuation lines start with a space. Never splits a UTF-8 sequence. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_OCTETS) return line;
  const pieces: string[] = [];
  let current = '';
  let octets = 0;
  // The first line holds 75 octets; continuations hold 74 after their leading space.
  let limit = MAX_OCTETS;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > limit) {
      pieces.push(current);
      current = '';
      octets = 0;
      limit = MAX_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  pieces.push(current);
  return pieces.join(`${CRLF} `);
}

function splitName(name: string): { given: string; family: string } {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return { given: words[0], family: '' };
  return { given: words.slice(0, -1).join(' '), family: words[words.length - 1] };
}

export function buildVCard(input: VCardInput): string {
  const { given, family } = splitName(input.name);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeText(family)};${escapeText(given)};;;`, `FN:${escapeText(input.name.trim())}`];

  if (input.title) lines.push(`TITLE:${escapeText(input.title)}`);
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET:${input.email.trim()}`);
  if (input.phone) lines.push(`TEL;TYPE=CELL:${normalizePhone(input.phone)}`);
  if (input.locality || input.country) {
    // ADR: PO box; extended; street; locality; region; postal code; country
    lines.push(`ADR;TYPE=WORK:;;;${escapeText(input.locality ?? '')};;;${escapeText(input.country ?? '')}`);
  }
  for (const url of input.urls ?? []) lines.push(`URL:${url}`);
  lines.push('END:VCARD');

  return lines.map(foldLine).join(CRLF) + CRLF;
}
