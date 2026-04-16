import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useScrollProgress } from '../../hooks/useScrollProgress';
import { cn } from '../../utils/cn';
import { ThemeToggle } from '../shared/ThemeToggle';

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

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
          'fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-1rem)]',
          'flex items-center gap-0.5 sm:gap-1 rounded-full px-2 sm:px-3 py-1.5 sm:py-2',
          scrolled ? 'glass-strong' : 'glass',
        )}
      >
        <a
          href="#hero"
          className="font-display font-bold text-sm tracking-wide px-3 sm:px-4 text-text-primary"
        >
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
        <ThemeToggle className="ml-0.5 sm:ml-1" />
        <button
          className="md:hidden p-2 text-text-primary rounded-full hover:bg-glass-fill-strong transition-colors"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.span
                key="x"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="inline-flex"
              >
                <X size={18} />
              </motion.span>
            ) : (
              <motion.span
                key="m"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="inline-flex"
              >
                <Menu size={18} />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </motion.nav>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="nav-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="md:hidden fixed inset-0 z-30 bg-bg-base/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <motion.div
              key="nav-sheet"
              initial={{ opacity: 0, y: -20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="md:hidden fixed top-20 left-4 right-4 z-40 glass-strong p-5 sm:p-6 flex flex-col gap-1"
              role="dialog"
              aria-modal="true"
            >
              {LINKS.map((l, i) => {
                const isActive = active === l.href.slice(1);
                return (
                  <motion.a
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 * i + 0.1, duration: 0.3 }}
                    className={cn(
                      'py-3 px-3 rounded-lg text-base font-medium transition-colors flex items-center justify-between',
                      isActive
                        ? 'text-text-primary bg-glass-fill-strong'
                        : 'text-text-secondary hover:text-text-primary hover:bg-glass-fill',
                    )}
                  >
                    <span>{l.label}</span>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-bright shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                    )}
                  </motion.a>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
