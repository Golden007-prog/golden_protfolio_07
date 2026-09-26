/*
 * Copy guard for everything the portfolio says about CoreForge.
 *
 * The ₹ figures on goldensdmat.in were a time-limited launch sale, so any amount
 * quoted here would go stale the day it changed. Promotional copy says
 * 'Free plan — no card, no expiry' and links to /pricing instead. The same rule
 * filters the live news feed, whose history includes a superseded price entry.
 *
 * Pure, so node --test can import it.
 */

const PATTERNS: readonly RegExp[] = [
  // Any rupee sign at all, with or without a number beside it.
  /₹/,
  // A currency symbol next to a number, on either side: '€150', '299 €', '$ 5'.
  /[€$£]\s?\d/,
  /\d\s?[€$£]/,
  // Currency codes and words next to a number: 'Rs. 299', 'INR 1,999', '150 euros'.
  /\b(?:rs\.?|inr|eur|usd|gbp)\s?\d/i,
  /\d[\d,.]*\s?(?:inr|eur|usd|gbp|rupees?|euros?|dollars?)\b/i,
  // Billing rates: '299/month', '1,999 a year', '167 per month'.
  /\d[\d,.]*\s*(?:\/\s*(?:mo|month|yr|year)\b|(?:a|per)\s+(?:month|year)\b)/i,
];

/** True when `text` quotes a price, a currency amount or a billing rate. */
export function containsPrice(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

/** Every string inside `value` (objects, arrays and nested values), for audits and tests. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}
