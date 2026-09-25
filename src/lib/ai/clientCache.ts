import { safeStorage } from '../safeStorage.ts';

/*
 * Per-tab memo of AI results, so asking the same thing twice in one visit (a
 * reopened fit check, a repeated tour) costs nothing. Everything lives in
 * sessionStorage through safeStorage: gone when the tab closes, never sent
 * anywhere. Callers key entries with hashText(), so pasted text never becomes a
 * storage key in the clear.
 */

const PREFIX = 'ob-ai:';
const INDEX_KEY = `${PREFIX}index`;
const MAX_ENTRIES = 40;
// One oversized answer must not evict the rest of the tab's storage.
const MAX_VALUE_CHARS = 64 * 1024;

const entryKey = (feature: string, key: string) => `${PREFIX}${feature}:${key}`;

function readIndex(): string[] {
  const raw = safeStorage.get(INDEX_KEY, 'session');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string' && k.startsWith(PREFIX)) : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]) {
  if (keys.length) safeStorage.set(INDEX_KEY, JSON.stringify(keys), 'session');
  else safeStorage.remove(INDEX_KEY, 'session');
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// FNV-1a, for pages served without a secure context (no crypto.subtle).
// Only ever a cache key, never a security boundary.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `f${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** SHA-256 hex of the text (an FNV-1a digest where Web Crypto is unavailable). */
export async function hashText(s: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fnv1a(s);
  try {
    return toHex(await subtle.digest('SHA-256', new TextEncoder().encode(s)));
  } catch {
    return fnv1a(s);
  }
}

export function sessionGet<T = unknown>(feature: string, key: string): T | null {
  const raw = safeStorage.get(entryKey(feature, key), 'session');
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function sessionSet(feature: string, key: string, value: unknown): void {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return;
  }
  if (raw === undefined || raw.length > MAX_VALUE_CHARS) return;
  const k = entryKey(feature, key);
  const index = readIndex().filter((x) => x !== k);
  index.push(k);
  // Oldest first: past the cap the earliest answers go.
  while (index.length > MAX_ENTRIES) {
    const old = index.shift();
    if (old) safeStorage.remove(old, 'session');
  }
  safeStorage.set(k, raw, 'session');
  writeIndex(index);
}

/** Forgets every cached AI result in this tab. */
export function clearAiSession(): void {
  for (const k of readIndex()) safeStorage.remove(k, 'session');
  writeIndex([]);
}
