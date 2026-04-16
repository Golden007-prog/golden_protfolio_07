import { motion } from 'framer-motion';
import { useTheme } from '../../contexts/ThemeContext';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      aria-pressed={!isDark}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className={`relative w-10 h-10 sm:w-11 sm:h-11 rounded-full glass flex items-center justify-center overflow-visible group ${className}`}
      style={{
        boxShadow: isDark
          ? '0 0 0 0 rgba(168, 85, 247, 0)'
          : '0 4px 18px rgba(245, 158, 11, 0.22)',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: isDark
            ? 'radial-gradient(circle at 50% 50%, rgba(168, 85, 247, 0.35), transparent 65%)'
            : 'radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.35), transparent 65%)',
        }}
      />

      <motion.svg
        viewBox="0 0 24 24"
        className="relative w-[18px] h-[18px] sm:w-5 sm:h-5"
        animate={{ rotate: isDark ? 0 : 180 }}
        transition={{ type: 'spring', stiffness: 160, damping: 18 }}
      >
        <defs>
          <mask id="tt-mask">
            <rect x="0" y="0" width="24" height="24" fill="white" />
            <motion.circle
              r="9"
              fill="black"
              animate={{ cx: isDark ? 16 : 30, cy: isDark ? 8 : -6 }}
              transition={{ type: 'spring', stiffness: 180, damping: 22 }}
            />
          </mask>
        </defs>

        {/* Sun rays — fade in when light */}
        <motion.g
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="text-amber"
          animate={{ opacity: isDark ? 0 : 1, scale: isDark ? 0.4 : 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: '12px 12px' }}
        >
          <line x1="12" y1="2.2" x2="12" y2="4.6" />
          <line x1="12" y1="19.4" x2="12" y2="21.8" />
          <line x1="2.2" y1="12" x2="4.6" y2="12" />
          <line x1="19.4" y1="12" x2="21.8" y2="12" />
          <line x1="4.9" y1="4.9" x2="6.6" y2="6.6" />
          <line x1="17.4" y1="17.4" x2="19.1" y2="19.1" />
          <line x1="4.9" y1="19.1" x2="6.6" y2="17.4" />
          <line x1="17.4" y1="6.6" x2="19.1" y2="4.9" />
        </motion.g>

        {/* Core disc — violet in dark (moon), amber in light (sun) */}
        <motion.circle
          cx="12"
          cy="12"
          r="5"
          mask="url(#tt-mask)"
          animate={{ fill: isDark ? '#A855F7' : '#F59E0B' }}
          transition={{ duration: 0.4 }}
        />
      </motion.svg>
    </motion.button>
  );
}
