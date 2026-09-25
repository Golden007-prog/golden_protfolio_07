import type { AskOpenRequest, FitOpenRequest } from './protocol.ts';
import { emit } from '../events.ts';
import { safeStorage } from '../safeStorage.ts';

/*
 * Requests to open the assistant or the fit check. The dock is idle-loaded and
 * the fit sheet is lazy, so neither may be listening when the palette, the
 * mobile menu, a case study or a timeline card asks. Each request therefore
 * lands in a pending slot as well as firing its event, and the consumer drains
 * the slot with takePending() both on mount and in its event handler. The newest
 * request wins; a request nobody picks up expires.
 *
 * The slots are mirrored to sessionStorage so a request made just before a full
 * page load (a subpage link back to '/') still arrives.
 */

type Requests = { ask: AskOpenRequest; fit: FitOpenRequest };
export type PendingKind = keyof Requests;

type Slot<K extends PendingKind> = { req: Requests[K]; at: number };
type Slots = { [K in PendingKind]?: Slot<K> };

/** Long enough for an idle-loaded dock on a slow phone, short enough that a stale request never surprises. */
export const PENDING_TTL_MS = 60_000;
const STORAGE_KEY = 'ob-ai-pending';

const memory: Slots = {};

function readStored(): Slots {
  const raw = safeStorage.get(STORAGE_KEY, 'session');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Slots) : {};
  } catch {
    return {};
  }
}

function writeStored(slots: Slots) {
  if (slots.ask || slots.fit) safeStorage.set(STORAGE_KEY, JSON.stringify(slots), 'session');
  else safeStorage.remove(STORAGE_KEY, 'session');
}

// Requests are plain JSON; a copy keeps a caller's later mutation out of the slot.
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x ?? {})) as T;

function put<K extends PendingKind>(kind: K, req: Requests[K], now: number) {
  const slot = { req: copy(req), at: now } as Slot<K>;
  (memory as Record<K, Slot<K>>)[kind] = slot;
  const stored = readStored();
  (stored as Record<K, Slot<K>>)[kind] = slot;
  writeStored(stored);
}

/** Opens the concierge, optionally scoped, prefilled or sent at once. */
export function openAssistant(req: AskOpenRequest = {}, now: number = Date.now()): void {
  put('ask', req, now);
  emit('ask:open', copy(req));
}

/** Opens the recruiter fit check, optionally with a job description. */
export function openFit(req: FitOpenRequest = {}, now: number = Date.now()): void {
  put('fit', req, now);
  emit('fit:open', copy(req));
}

/** Returns and clears the pending request of one kind, or null when none is fresh. */
export function takePending<K extends PendingKind>(kind: K, now: number = Date.now()): Requests[K] | null {
  const stored = readStored();
  const slot = (memory[kind] ?? stored[kind]) as Slot<K> | undefined;
  delete memory[kind];
  if (stored[kind]) {
    delete stored[kind];
    writeStored(stored);
  }
  if (!slot || typeof slot.at !== 'number' || now - slot.at > PENDING_TTL_MS || now < slot.at) return null;
  return slot.req;
}
