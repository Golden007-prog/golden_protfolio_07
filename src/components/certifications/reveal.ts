/*
 * 'Show me this credential' from outside the section (the command palette). A
 * window event, so the caller needs neither the section's chunk nor a shared
 * store: the section clears a filter that hides the card, opens the group it sits
 * in, then scrolls to it. A request made before the section mounts waits in
 * `pending` and is picked up on mount.
 */

const EVENT = 'ob:cert:reveal';

let pending: string | null = null;

export function revealCredential(id: string): void {
  if (typeof window === 'undefined') return;
  pending = id;
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }));
}

/** Subscribes to reveal requests; a request already waiting is delivered at once. */
export function onRevealCredential(fn: (id: string) => void): () => void {
  const handler = (e: Event) => {
    const id = (e as CustomEvent<string>).detail;
    if (typeof id !== 'string') return;
    pending = null;
    fn(id);
  };
  window.addEventListener(EVENT, handler);
  if (pending) {
    const id = pending;
    pending = null;
    fn(id);
  }
  return () => window.removeEventListener(EVENT, handler);
}
