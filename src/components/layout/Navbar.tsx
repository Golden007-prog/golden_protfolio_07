import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useScrollProgress } from '../../hooks/useScrollProgress';
import { cn } from '../../utils/cn';

const LINKS = [
  { href: '#hero', label: 'Home' },
  { href: '#about', label: 'About' },
  { href: '#skills', label: 'Skills' },
  { href: '#projects', label: 'Projects' },
  { href: '#experience', label: 'Experience' },
  { href: '#contact', label: 'Contact' },
];

export function Navbar() {
  const progress = useScrollProgress();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('hero');
  const [hidden, setHidden] = useState(false);
  const scrolled = progress > 0.01;

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: '-40% 0px -50% 0px' },
    );
    LINKS.forEach(({ href }) => {
      const el = document.querySelector(href);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 80) {
          setHidden(false);
        } else if (delta > 8) {
          setHidden(true);
        } else if (delta < -8) {
          setHidden(false);
        }
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 h-[2px] bg-transparent">
        <motion.div
          className="h-full bg-gradient-to-r from-violet via-violet-bright to-cyan-bright origin-left"
          style={{ scaleX: progress }}
        />
      </div>

      <motion.nav
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: hidden && !open ? -80 : 0, opacity: hidden && !open ? 0 : 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'fixed top-4 left-1/2 -translate-x-1/2 z-40',
          'flex items-center gap-1 rounded-full px-3 py-2',
          scrolled ? 'glass-strong' : 'glass',
        )}
      >
        <a href="#hero" className="font-display font-bold text-sm tracking-wide px-4 text-text-primary">
          OB<span className="text-violet-bright">.</span>
        </a>
        <div className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => {
            const isActive = active === l.href.slice(1);
            return (
              <a
                key={l.href}
                href={l.href}
                className={cn(
                  'relative px-4 py-1.5 text-sm font-medium rounded-full transition-colors',
                  isActive ? 'text-white' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="nav-active-pill"
                    className="absolute inset-0 rounded-full bg-gradient-to-r from-violet via-violet-bright to-cyan-bright shadow-[0_0_18px_rgba(168,85,247,0.45)]"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{l.label}</span>
              </a>
            );
          })}
        </div>
        <button
          className="md:hidden p-2 text-text-primary"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </motion.nav>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:hidden fixed top-20 left-4 right-4 z-40 glass-strong p-6 flex flex-col gap-3"
        >
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="text-text-secondary hover:text-text-primary font-medium"
            >
              {l.label}
            </a>
          ))}
        </motion.div>
      )}
    </>
  );
}
