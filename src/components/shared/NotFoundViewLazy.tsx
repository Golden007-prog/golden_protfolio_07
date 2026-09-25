'use client';

import dynamic from 'next/dynamic';

// The root not-found boundary ships in every route's first load, where its view
// (header, footer, card, Lottie, the suggestion island) would sit as a second copy
// of modules the page already carries. As its own chunk it still renders on the
// server, and only a 404 ever fetches it.
export const NotFoundView = dynamic(() => import('./NotFoundView'));
