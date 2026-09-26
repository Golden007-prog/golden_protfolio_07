'use client';

import { createContext, useContext } from 'react';
import type { KaggleData } from '@/lib/kaggle/types';

/**
 * The Kaggle data app/page.tsx read on the server (live when a token is set, else the
 * committed snapshot), handed down so the About strip and the Kaggle section render
 * the same numbers in the prerendered HTML. Null outside the home page.
 */
export const KaggleDataContext = createContext<KaggleData | null>(null);

export function useKaggleData(): KaggleData | null {
  return useContext(KaggleDataContext);
}
