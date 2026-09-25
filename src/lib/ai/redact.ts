/*
 * Best-effort PII redaction for text visitors paste (job descriptions, contact
 * notes) before it reaches Gemini: email addresses, phone numbers, and URLs that
 * carry credentials in their query or fragment (key, token, sig, auth and their
 * common spellings). It is not a guarantee, so AiNotice still asks visitors not
 * to paste confidential text.
 *
 * Pure: relative .ts imports only.
 */
import { isPhone, PHONE_RE } from './sanitize.ts';

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
// A query or fragment key that names a credential: key, apikey, api_key,
// access_token, x-amz-signature, sig, auth, authorization, secret, password.
const SECRET_KEY = /(?:^|[_.-])(?:api)?(?:key|token|sig|signature|auth|authorization|secret|password|pwd)(?:$|[_.-])|^(?:apikey|accesstoken|authtoken)$/i;

export type Redaction = {
  text: string;
  /** Total items removed. */
  removed: number;
  counts: { emails: number; phones: number; urls: number };
};

function hasSecretParam(url: string): boolean {
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  const tail = url.slice(Math.min(...[q, h].filter((i) => i >= 0), url.length) + 1);
  if (!tail) return false;
  return tail.split(/[&#?;]/).some((pair) => {
    const name = decodeURIComponentSafe(pair.split('=')[0] ?? '');
    return name !== '' && SECRET_KEY.test(name);
  });
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function redact(text: string): Redaction {
  const counts = { emails: 0, phones: 0, urls: 0 };
  if (typeof text !== 'string' || !text) return { text: '', removed: 0, counts };
  let out = text.replace(URL_RE, (raw) => {
    const url = raw.replace(/[.,;:!?)\]}'"]+$/, '');
    if (!hasSecretParam(url)) return raw;
    counts.urls += 1;
    return `[link removed]${raw.slice(url.length)}`;
  });
  out = out.replace(EMAIL_RE, () => {
    counts.emails += 1;
    return '[email removed]';
  });
  out = out.replace(PHONE_RE, (raw) => {
    if (!isPhone(raw)) return raw;
    counts.phones += 1;
    return '[phone removed]';
  });
  return { text: out, removed: counts.emails + counts.phones + counts.urls, counts };
}
