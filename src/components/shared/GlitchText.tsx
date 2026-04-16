import { useEffect, useState, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  text: string;
  className?: string;
  intervalMs?: number;
};

export function GlitchText({ children, text, className = '', intervalMs = 12000 }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const schedule = () => {
      const jitter = intervalMs + Math.random() * 4000;
      return window.setTimeout(() => {
        setActive(true);
        window.setTimeout(() => setActive(false), 220);
        id = schedule();
      }, jitter);
    };
    let id = schedule();
    return () => window.clearTimeout(id);
  }, [intervalMs]);

  return (
    <span
      className={`relative inline-block ${active ? 'glitch-active' : ''} ${className}`}
      data-text={text}
    >
      {children}
    </span>
  );
}
