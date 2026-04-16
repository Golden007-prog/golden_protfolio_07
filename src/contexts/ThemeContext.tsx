import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light' | 'system';
type Resolved = 'dark' | 'light';

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: Resolved;
  setTheme: (t: Theme) => void;
  toggleTheme: (origin?: { x: number; y: number }) => void;
};

const STORAGE_KEY = 'theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolve(theme: Theme): Resolved {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
  return 'dark';
}

type DocWithViewTransition = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void> };
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitial);
  const [resolvedTheme, setResolvedTheme] = useState<Resolved>(() => resolve(readInitial()));
  const originRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const apply = () => {
      const r = resolve(theme);
      setResolvedTheme(r);
      document.documentElement.setAttribute('data-theme', r);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', r === 'dark' ? '#060609' : '#FAFAF7');
    };
    apply();
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { window.localStorage.setItem(STORAGE_KEY, t); } catch { /* quota/private mode */ }
  }, []);

  const runWithTransition = useCallback((next: Theme, origin?: { x: number; y: number }) => {
    const doc = document as DocWithViewTransition;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!doc.startViewTransition || prefersReduced) {
      setTheme(next);
      return;
    }

    originRef.current = origin ?? null;
    const root = document.documentElement;
    if (origin) {
      root.style.setProperty('--theme-origin-x', `${origin.x}px`);
      root.style.setProperty('--theme-origin-y', `${origin.y}px`);
    } else {
      root.style.removeProperty('--theme-origin-x');
      root.style.removeProperty('--theme-origin-y');
    }
    root.classList.add('theme-transitioning');

    const transition = doc.startViewTransition(() => {
      setTheme(next);
    });
    transition.ready.finally(() => {
      setTimeout(() => root.classList.remove('theme-transitioning'), 700);
    });
  }, [setTheme]);

  const toggleTheme = useCallback((origin?: { x: number; y: number }) => {
    const next: Theme = resolvedTheme === 'dark' ? 'light' : 'dark';
    runWithTransition(next, origin);
  }, [resolvedTheme, runWithTransition]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
