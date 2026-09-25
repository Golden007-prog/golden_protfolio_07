'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/** False on the server and during hydration, true in every render after that. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
