type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toKey(rgb: Rgb): string {
  return rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function isColorArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 3 && v.length <= 4 && v.every((n) => typeof n === 'number');
}

/**
 * Returns a copy of a Lottie document with solid fill, stroke and solid-layer
 * colours swapped by hex (case-insensitive, #rgb or #rrggbb), static or keyframed.
 * Gradients and text are left alone. The input is never mutated.
 */
export function recolorLottie<T>(json: T, map: Record<string, string>): T {
  const lookup = new Map<string, Rgb>();
  for (const [from, to] of Object.entries(map)) {
    const a = parseHex(from);
    const b = parseHex(to);
    if (a && b) lookup.set(toKey(a), b);
  }
  const clone = structuredClone(json);
  if (lookup.size === 0) return clone;

  // Lottie stores channels as 0..1 floats; a few old exporters wrote 0..255.
  const swapArray = (arr: number[]) => {
    const scale = arr.slice(0, 3).some((n) => n > 1) ? 1 : 255;
    const key = toKey(arr.slice(0, 3).map((n) => Math.round(n * scale)) as Rgb);
    const target = lookup.get(key);
    if (!target) return;
    for (let i = 0; i < 3; i++) arr[i] = target[i] / scale;
  };

  const swapProperty = (prop: unknown) => {
    if (!prop || typeof prop !== 'object') return;
    const k = (prop as { k?: unknown }).k;
    if (isColorArray(k)) {
      swapArray(k);
      return;
    }
    if (Array.isArray(k)) {
      for (const frame of k) {
        if (!frame || typeof frame !== 'object') continue;
        const { s, e } = frame as { s?: unknown; e?: unknown };
        if (isColorArray(s)) swapArray(s);
        if (isColorArray(e)) swapArray(e);
      }
    }
  };

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if ((obj.ty === 'fl' || obj.ty === 'st') && 'c' in obj) swapProperty(obj.c);
    if (obj.ty === 1 && typeof obj.sc === 'string') {
      const rgb = parseHex(obj.sc);
      const target = rgb && lookup.get(toKey(rgb));
      if (target) obj.sc = `#${toKey(target)}`;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') walk(value);
    }
  };

  walk(clone);
  return clone;
}
