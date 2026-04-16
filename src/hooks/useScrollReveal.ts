import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!ref.current) return;
    const children = ref.current.querySelectorAll<HTMLElement>('[data-reveal]');
    const triggers: ScrollTrigger[] = [];

    children.forEach((child, i) => {
      const t = gsap.from(child, {
        y: 60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        delay: i * 0.08,
        scrollTrigger: {
          trigger: child,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
      });
      if (t.scrollTrigger) triggers.push(t.scrollTrigger);
    });

    return () => {
      triggers.forEach((st) => st.kill());
    };
  }, []);

  return ref;
}
