'use client';

import { useSyncExternalStore } from 'react';
import { getDeviceSignals, getMotionPrefs, subscribeMotionPrefs } from './useMotionPrefs';

export type DeviceCapability = {
  /** False on the server and during hydration; true once real values are known. */
  ready: boolean;
  /** Coarse primary pointer. */
  isTouch: boolean;
  /** Narrower than 640px. */
  isSmall: boolean;
  /** useMotionPrefs().reduce, so the in-page override counts. */
  reducedMotion: boolean;
  /** Data Saver on, or a 2g/3g connection. */
  saveData: boolean;
  /** At most 4 cores or 4 GB, or Data Saver. */
  lowPower: boolean;
  hover: boolean;
  finePointer: boolean;
  /** Heavy WebGL scenes are worth downloading and mounting. */
  allowHeavy3D: boolean;
  /** Decorative background video is worth downloading. */
  allowVideo: boolean;
};

// Nothing heavy is assumed before the client has measured, so SSR HTML carries no
// canvas and hydration never pulls the three chunk on devices that opt out.
const SERVER_CAPABILITY: DeviceCapability = Object.freeze({
  ready: false,
  isTouch: false,
  isSmall: false,
  reducedMotion: false,
  saveData: false,
  lowPower: false,
  hover: false,
  finePointer: false,
  allowHeavy3D: false,
  allowVideo: false,
});

let cached: DeviceCapability | null = null;

// Software rasterisers (a blocklisted GPU, a VM, headless CI) draw these scenes at a
// few frames per second while holding the main thread for every frame, so the page
// gets the stills instead. No WebGL at all counts the same way.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;
let gpuOk: boolean | null = null;

function hasHardwareWebGL(): boolean {
  if (gpuOk !== null) return gpuOk;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      gpuOk = false;
    } else {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      gpuOk = !SOFTWARE_RENDERER.test(renderer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    gpuOk = false;
  }
  return gpuOk;
}

function getCapability(): DeviceCapability {
  if (typeof window === 'undefined') return SERVER_CAPABILITY;
  const prefs = getMotionPrefs();
  const s = getDeviceSignals();
  const saveData = s.saveData || s.slowNetwork;
  const heavyWanted = !prefs.reduce && !saveData && !(s.belowSm && s.lowPower);
  const next: DeviceCapability = {
    ready: true,
    isTouch: s.coarse,
    isSmall: s.belowSm,
    reducedMotion: prefs.reduce,
    saveData,
    lowPower: s.lowPower,
    hover: prefs.hover,
    finePointer: prefs.finePointer,
    allowHeavy3D: heavyWanted && hasHardwareWebGL(),
    allowVideo: !prefs.reduce && !saveData && !s.belowSm,
  };
  if (cached && (Object.keys(next) as (keyof DeviceCapability)[]).every((k) => cached![k] === next[k])) {
    return cached;
  }
  cached = next;
  return next;
}

/** One shared store for every consumer; it rides on the motion-prefs listeners. */
export function useDeviceCapability(): DeviceCapability {
  return useSyncExternalStore(subscribeMotionPrefs, getCapability, () => SERVER_CAPABILITY);
}
