type Area = 'local' | 'session';

// Accessing window.localStorage itself throws (SecurityError) when site data is
// blocked, so every step, including the lookup, sits inside the try.
function area(which: Area): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return which === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export const safeStorage = {
  get(key: string, which: Area = 'local'): string | null {
    try {
      return area(which)?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string, which: Area = 'local'): void {
    try {
      area(which)?.setItem(key, value);
    } catch {
      /* quota exceeded or storage blocked */
    }
  },
  remove(key: string, which: Area = 'local'): void {
    try {
      area(which)?.removeItem(key);
    } catch {
      /* storage blocked */
    }
  },
};
