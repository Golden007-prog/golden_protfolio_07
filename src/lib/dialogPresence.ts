import { afterNextPaint } from './afterPaint.ts';

export type DialogPresence = {
  /** Marks one dialog open until the returned release runs (idempotent). */
  hold(): () => void;
  subscribe(listener: () => void): () => void;
  /** Whether any dialog is open, as last published. */
  isOpen(): boolean;
};

type Schedule = (fn: () => void) => () => void;

/**
 * Counts open dialogs for things that should idle underneath them (the hero's WebGL
 * loop). Changes are published through `schedule`, after the next paint by default,
 * so a subscriber's re-render never lands in the tap that opened or closed a dialog.
 * An open and a close before the publish cancel out and notify nobody.
 */
export function createDialogPresence(schedule: Schedule = afterNextPaint): DialogPresence {
  let count = 0;
  let published = false;
  let pending: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = () => {
    pending = null;
    const next = count > 0;
    if (next === published) return;
    published = next;
    for (const listener of Array.from(listeners)) listener();
  };

  const changed = () => {
    if (!pending) pending = schedule(publish);
  };

  return {
    hold() {
      count += 1;
      changed();
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        count -= 1;
        changed();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isOpen: () => published,
  };
}

const presence = createDialogPresence();

export const holdDialogPresence = presence.hold;
export const subscribeDialogPresence = presence.subscribe;
export const isDialogOpen = presence.isOpen;
