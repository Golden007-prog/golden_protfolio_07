/**
 * Focus that survives a swap of the subtree it sits in. Deferred3D replaces its
 * fallback with the canvas (and a Suspense copy of the fallback while the chunk
 * loads), a re-suspended canvas is hidden with display:none behind a fresh copy,
 * and a failed or released canvas brings the fallback back. Each swap removes or
 * hides the focused control and drops focus to <body>. Controls that stand for the
 * same thing on both sides carry the same value of one attribute; when the focused
 * one goes, focus moves to its visible twin.
 */

function isShown(el: HTMLElement): boolean {
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0;
}

/** The visible element under `root` whose `key` attribute equals `value`, other than `not`. */
export function findTwin(root: ParentNode, key: string, value: string | null, not?: Element): HTMLElement | null {
  if (value === null) return null;
  for (const el of root.querySelectorAll<HTMLElement>(`[${key}]`)) {
    if (el !== not && el.getAttribute(key) === value && isShown(el)) return el;
  }
  return null;
}

/**
 * Keeps keyboard focus on the control named by its `key` attribute while `root`'s
 * contents are swapped underneath it. Active only while a keyed control inside
 * `root` has focus, so it never pulls focus back from anywhere else. Returns the
 * cleanup.
 */
export function carryFocus(root: HTMLElement, key: string): () => void {
  let last: HTMLElement | null = null;
  let settle = 0;

  const release = () => {
    last = null;
    observer.disconnect();
    window.clearTimeout(settle);
  };

  const rescue = () => {
    const from = last;
    if (!from) return;
    const active = document.activeElement;
    const lost = from.isConnected ? active === from && !isShown(from) : !active || active === document.body;
    if (!lost) return;
    const twin = findTwin(root, key, from.getAttribute(key), from);
    // focusin re-arms `last` with the twin.
    twin?.focus({ preventScroll: true });
    if (!twin || document.activeElement !== twin) release();
  };

  // One callback per React commit: removals, insertions and Suspense's display:none arrive together.
  const observer = new MutationObserver(rescue);

  const onFocusIn = (e: FocusEvent) => {
    const target = e.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute(key)) {
      release();
      return;
    }
    last = target;
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  };

  const onFocusOut = (e: FocusEvent) => {
    const to = e.relatedTarget;
    if (to instanceof Node && root.contains(to)) return;
    if (to) {
      release();
      return;
    }
    // No new target: the control was removed (a swap), the window lost focus, or a
    // click landed on nothing. Only the last leaves the control shown but unfocused.
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      if (last && last.isConnected && isShown(last) && document.activeElement !== last) release();
    });
  };

  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  return () => {
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    release();
  };
}
