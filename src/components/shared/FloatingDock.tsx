'use client';

import { useLayoutEffect, useRef } from 'react';
import { AmbientSoundToggle } from '@/components/shared/AmbientSoundToggle';
import { AskMeBot } from '@/components/shared/AskMeBot';
import { LiveStatusBar } from '@/components/shared/LiveStatusBar';
import { useIntro } from '@/contexts/IntroContext';
import { scrollState, subscribeScroll, usePointerTracking } from '@/lib/pointerStore';

// Scroll this far down in one go before the dock tucks away; any upward scroll brings it back.
const HIDE_AFTER_PX = 32;
// Near the top of the page the dock shows, unless it would cover a [data-dock-avoid] control.
const ALWAYS_SHOW_ABOVE_PX = 200;
// Controls the dock must not sit on while the scroll rules would show it: the hero's
// calls to action reach the bottom band on short phones (320x568, 360x592).
const AVOID_AREA = '[data-dock-avoid]';
const AVOID_CONTROLS = 'a[href], button, input';
// While a field is focused, how often to notice it left the page without a focusout.
const FOCUS_POLL_MS = 500;

const NO_KEYBOARD_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** Whether a control inside a [data-dock-avoid] area overlaps the dock's resting box. */
function coversAvoided(dock: HTMLElement): boolean {
  const d = dock.getBoundingClientRect();
  if (d.width === 0 || d.height === 0) return false;
  const hits = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left < d.right && r.right > d.left && r.top < d.bottom && r.bottom > d.top;
  for (const area of document.querySelectorAll<HTMLElement>(AVOID_AREA)) {
    if (!hits(area.getBoundingClientRect())) continue;
    for (const el of area.querySelectorAll<HTMLElement>(AVOID_CONTROLS)) if (hits(el.getBoundingClientRect())) return true;
  }
  return false;
}

function findFooter(): HTMLElement | null {
  return document.getElementById('site-footer') ?? document.querySelector<HTMLElement>('body footer');
}

/** A field that raises the on-screen keyboard: text-like inputs, textareas, selects and editable content. */
function isTextEntry(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD_INPUTS.has(el.type);
  return el.isContentEditable;
}

/**
 * One safe-area-aware home for the floating controls: the latest-push pill, the
 * ambient sound toggle and the AskMeBot launcher (its desktop panel opens above
 * it). Fixed at var(--dock-clearance) and z-dock, below the nav. It tucks away on
 * a downward scroll and returns on an upward one (or when anything in it takes
 * focus), and rides up above #site-footer while the footer is on screen, so every
 * footer link stays clickable. Where that would put it under the nav, or over a
 * toast, it hides instead. While a text field elsewhere on the page has focus
 * (the on-screen keyboard is up, and the dock would sit on the field) it hides,
 * and it returns when the field loses focus; fields inside a dialog are left
 * alone, since the dialog already covers the dock. While a chat answer streams
 * the launcher stays in view. Where it would cover a [data-dock-avoid] control
 * (the hero's calls to action on a short phone) it stays tucked until those
 * scroll clear; focusing anything in it still brings it back. Scroll work writes
 * attributes directly: no re-renders.
 */
export function FloatingDock() {
  usePointerTracking();
  const { done } = useIntro();
  const rootRef = useRef<HTMLDivElement>(null);
  const askOpen = useRef(false);
  const askBusy = useRef(false);
  const scheduleRef = useRef<() => void>(() => {});

  // A layout effect, so a dock that starts over the hero's calls to action is tucked
  // before its first paint instead of sliding away in front of the visitor.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let footer: HTMLElement | null = findFooter();
    let footerVisible = false;
    let travel = 0;
    let lastY = scrollState.y;
    let frame = 0;
    let lift = -1;
    let hidden = false;
    let typing = false;
    let poll = 0;
    const navOffset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-offset')) || 88;

    const setHidden = (v: boolean) => {
      if (v === hidden) return;
      hidden = v;
      if (v) root.setAttribute('data-hidden', '');
      else root.removeAttribute('data-hidden');
    };

    const typingElsewhere = () => {
      const el = document.activeElement;
      return isTextEntry(el) && !root.contains(el) && !el.closest('[data-dialog-root]');
    };

    const update = () => {
      frame = 0;
      const y = scrollState.y;
      const dy = y - lastY;
      lastY = y;
      travel = dy > 0 ? Math.max(0, travel) + dy : dy < 0 ? 0 : travel;

      const wasTyping = typing;
      typing = typingElsewhere();
      if (typing !== wasTyping) {
        root.toggleAttribute('data-typing', typing);
        window.clearInterval(poll);
        poll = typing ? window.setInterval(schedule, FOCUS_POLL_MS) : 0;
        // Back from the keyboard: the dock returns wherever the page now is.
        if (!typing) travel = 0;
      }

      let wanted = 0;
      let blocked = false;
      if (footerVisible && footer) {
        const vh = window.innerHeight;
        wanted = Math.max(0, Math.round(vh - footer.getBoundingClientRect().top));
        if (wanted > 0) {
          // Where the lifted dock's top edge would land, from the top of the viewport.
          const restBottom = parseFloat(getComputedStyle(root).bottom) || 0;
          const top = vh - restBottom - root.offsetHeight - wanted;
          blocked = top < navOffset || document.querySelector('[data-toast-region] [data-toast]') !== null;
        }
      }
      const applied = blocked ? 0 : wanted;
      if (applied !== lift) {
        lift = applied;
        root.style.setProperty('--dock-lift', `${lift}px`);
      }

      if (askOpen.current) setHidden(false);
      else if (typing) setHidden(true);
      else if (blocked) setHidden(true);
      else if (askBusy.current) setHidden(false);
      else if (wasTyping || y < ALWAYS_SHOW_ABOVE_PX || dy < 0) setHidden(coversAvoided(root));
      else if (travel > HIDE_AFTER_PX) setHidden(true);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scheduleRef.current = schedule;

    const unsubscribe = subscribeScroll(schedule);
    window.addEventListener('resize', schedule, { passive: true });
    // Focus moving in or out of a field; visualViewport follows the on-screen keyboard.
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', schedule, { passive: true });

    let io: IntersectionObserver | null = null;
    const watchFooter = () => {
      footer = findFooter();
      if (!footer || typeof IntersectionObserver === 'undefined') return;
      io = new IntersectionObserver(([entry]) => {
        footerVisible = Boolean(entry?.isIntersecting);
        schedule();
      });
      io.observe(footer);
    };
    watchFooter();
    // The footer may mount after the dock (it is lazily rendered in some layouts).
    const retry = footer ? 0 : window.setTimeout(watchFooter, 1500);

    // A toast appearing while the dock is lifted re-checks the overlap.
    const toastObserver = new MutationObserver(schedule);
    const observeToasts = () => {
      const region = document.querySelector('[data-toast-region]');
      if (region) toastObserver.observe(region, { childList: true, subtree: true });
      return Boolean(region);
    };
    const toastRetry = observeToasts() ? 0 : window.setTimeout(observeToasts, 1500);

    // Avoided controls move without a scroll when the text above them rewraps (fonts, the role ticker).
    const avoidObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    document.querySelectorAll(AVOID_AREA).forEach((el) => {
      avoidObserver?.observe(el);
      if (el.parentElement) avoidObserver?.observe(el.parentElement);
    });

    // Once now, so the first paint already has the right state, and once more on the
    // next frame, when the scroll store has caught up with a restored position.
    update();
    schedule();
    return () => {
      scheduleRef.current = () => {};
      unsubscribe();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      vv?.removeEventListener('resize', schedule);
      io?.disconnect();
      toastObserver.disconnect();
      avoidObserver?.disconnect();
      window.clearTimeout(retry);
      window.clearTimeout(toastRetry);
      window.clearInterval(poll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const onAskOpenChange = (open: boolean) => {
    askOpen.current = open;
    if (open) rootRef.current?.removeAttribute('data-hidden');
    scheduleRef.current();
  };

  const onAskBusyChange = (busy: boolean) => {
    askBusy.current = busy;
    scheduleRef.current();
  };

  return (
    <div ref={rootRef} data-dock="" data-pre-intro={done ? undefined : ''} className="dock z-dock">
      <div className="dock-inner relative">
        <LiveStatusBar />
        <AmbientSoundToggle />
        <AskMeBot onOpenChange={onAskOpenChange} onBusyChange={onAskBusyChange} />
      </div>
    </div>
  );
}
