'use client';

import { useEffect, useRef } from 'react';
import { AmbientSoundToggle } from '@/components/shared/AmbientSoundToggle';
import { AskMeBot } from '@/components/shared/AskMeBot';
import { LiveStatusBar } from '@/components/shared/LiveStatusBar';
import { useIntro } from '@/contexts/IntroContext';
import { scrollState, subscribeScroll, usePointerTracking } from '@/lib/pointerStore';

// Scroll this far down in one go before the dock tucks away; any upward scroll brings it back.
const HIDE_AFTER_PX = 32;
// Near the top of the page the dock always shows.
const ALWAYS_SHOW_ABOVE_PX = 200;
// While a field is focused, how often to notice it left the page without a focusout.
const FOCUS_POLL_MS = 500;

const NO_KEYBOARD_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

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
 * the launcher stays in view. Scroll work writes attributes directly: no re-renders.
 */
export function FloatingDock() {
  usePointerTracking();
  const { done } = useIntro();
  const rootRef = useRef<HTMLDivElement>(null);
  const askOpen = useRef(false);
  const askBusy = useRef(false);
  const scheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
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
      else if (askBusy.current || wasTyping) setHidden(false);
      else if (y < ALWAYS_SHOW_ABOVE_PX || dy < 0) setHidden(false);
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
