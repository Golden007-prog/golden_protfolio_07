'use client';

import { useEffect, useRef, type RefObject } from 'react';

type Options = {
  /** Focused on activation. Otherwise [autofocus], then fallbackFocusRef, then the first tabbable. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Used when there is no initialFocusRef or [autofocus] (Dialog passes its panel). */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  /** Refocus the element that had focus before activation. Default true. */
  returnFocus?: boolean;
};

const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

function isVisible(el: HTMLElement): boolean {
  const withCheck = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (typeof withCheck.checkVisibility === 'function') return withCheck.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

export function getTabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert]') && isVisible(el),
  );
}

type Trap = { container: HTMLElement; portal: HTMLElement; inerted: HTMLElement[] };
const stack: Trap[] = [];

/** The child of <body> that holds the element (its portal root). */
function bodyChildOf(el: HTMLElement): HTMLElement {
  let node = el;
  while (node.parentElement && node.parentElement !== document.body) node = node.parentElement;
  return node;
}

function isExempt(el: Element, portal: HTMLElement): boolean {
  // nextjs-portal is the development error overlay.
  return el === portal || el.hasAttribute('data-toast-region') || el.localName === 'nextjs-portal';
}

function activate(container: HTMLElement): Trap {
  const portal = bodyChildOf(container);
  const inerted: HTMLElement[] = [];
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || isExempt(child, portal) || child.inert) continue;
    if (child instanceof HTMLScriptElement || child instanceof HTMLStyleElement || child instanceof HTMLTemplateElement) continue;
    child.inert = true;
    inerted.push(child);
  }
  const trap = { container, portal, inerted };
  stack.push(trap);
  return trap;
}

function deactivate(trap: Trap) {
  const index = stack.indexOf(trap);
  if (index === -1) return;
  stack.splice(index, 1);
  const above = stack[index];
  if (above) {
    // Closed out of order: the trap now on top still needs the background inert.
    for (const el of trap.inerted) {
      if (el === above.portal) el.inert = false;
      else above.inerted.push(el);
    }
    return;
  }
  for (const el of trap.inerted) el.inert = false;
}

function focusEl(el: HTMLElement | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

/**
 * Keeps keyboard focus inside `ref` while `active`: moves focus in, cycles Tab and
 * Shift+Tab, pulls stray focus back, makes every other child of <body> inert
 * (except the trap's own portal and [data-toast-region]) and restores focus to the
 * previously focused element on release. Traps stack.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  opts: Options = {},
): void {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trap = activate(container);
    const isTop = () => stack[stack.length - 1] === trap;

    const { initialFocusRef, fallbackFocusRef } = optsRef.current;
    const initial =
      initialFocusRef?.current ??
      container.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
      fallbackFocusRef?.current ??
      getTabbables(container)[0] ??
      null;
    if (!focusEl(initial)) {
      if (!container.hasAttribute('tabindex')) container.tabIndex = -1;
      focusEl(container);
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTop()) return;
      const list = getTabbables(container);
      if (list.length === 0) {
        e.preventDefault();
        focusEl(container);
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const outside = !current || !list.includes(current);
      if (e.shiftKey && (current === first || outside)) {
        e.preventDefault();
        focusEl(last);
      } else if (!e.shiftKey && (current === last || (outside && !container.contains(current)))) {
        e.preventDefault();
        focusEl(first);
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!isTop()) return;
      const target = e.target as HTMLElement | null;
      if (!target || container.contains(target) || target.closest('[data-toast-region]')) return;
      // Something outside grabbed focus (a stray programmatic focus): bring it back.
      if (!focusEl(getTabbables(container)[0])) focusEl(container);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      deactivate(trap);
      // After un-inerting, or the opener could not take focus.
      if (optsRef.current.returnFocus !== false && previous && !container.contains(previous)) focusEl(previous);
    };
  }, [active, ref]);
}
