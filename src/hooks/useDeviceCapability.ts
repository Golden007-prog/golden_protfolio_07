'use client';

import { useEffect, useState } from 'react';

export type DeviceCapability = {
  /** Resolved after mount; false during SSR and the first client render. */
  ready: boolean;
  /** Coarse pointer or a narrow viewport. */
  isTouch: boolean;
  isSmall: boolean;
  /** User asked the OS to reduce motion. */
  reducedMotion: boolean;
  /** Data Saver, a metered connection, or 2g/3g. */
  saveData: boolean;
  /** Few cores or little RAM reported. */
  lowPower: boolean;
  /** Heavy WebGL scenes are worth mounting. */
  allowHeavy3D: boolean;
  /** Decorative background video is worth downloading. */
  allowVideo: boolean;
};

const SSR: DeviceCapability = {
  ready: false,
  isTouch: false,
  isSmall: false,
  reducedMotion: false,
  saveData: false,
  lowPower: false,
  // Assume capable so the markup matches on the server, then correct after mount.
  allowHeavy3D: true,
  allowVideo: true,
};

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

function measure(): DeviceCapability {
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const isSmall = window.matchMedia('(max-width: 900px)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  const saveData = Boolean(conn?.saveData) || /(^|-)2g$/.test(conn?.effectiveType ?? '');

  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const lowPower = cores <= 4 || memory <= 4;

  return {
    ready: true,
    isTouch,
    isSmall,
    reducedMotion,
    saveData,
    lowPower,
    allowHeavy3D: !reducedMotion && !saveData && !(isSmall && lowPower),
    allowVideo: !reducedMotion && !saveData,
  };
}

/**
 * One place to decide whether this device should be asked to run the expensive
 * parts of the page. Everything resolves after mount so server and client
 * markup agree.
 */
export function useDeviceCapability(): DeviceCapability {
  const [cap, setCap] = useState<DeviceCapability>(SSR);

  useEffect(() => {
    const sync = () => setCap(measure());
    sync();
    const queries = [
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(max-width: 900px)'),
      window.matchMedia('(prefers-reduced-motion: reduce)'),
    ];
    queries.forEach((q) => q.addEventListener('change', sync));
    return () => queries.forEach((q) => q.removeEventListener('change', sync));
  }, []);

  return cap;
}
