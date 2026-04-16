import { useEffect, useRef, useState } from 'react';

export function useInView<T extends Element = HTMLDivElement>(opts: IntersectionObserverInit = { threshold: 0.15, rootMargin: '0px 0px -10% 0px' }) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        io.disconnect();
      }
    }, opts);
    io.observe(el);
    return () => io.disconnect();
  }, [opts]);
  return { ref, inView };
}
