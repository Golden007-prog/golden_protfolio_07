import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  onComplete: () => void;
}

export default function LoadingScreen({ onComplete }: Props) {
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [hoveringButton, setHoveringButton] = useState(false);

  useEffect(() => {
    const start = Date.now();
    const minDuration = 2500;

    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / minDuration) * 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(interval);
        setTimeout(() => setReady(true), 300);
      }
    }, 30);

    return () => clearInterval(interval);
  }, []);

  const handleEnterClick = () => {
    setDismissing(true);
    setTimeout(onComplete, 900);
  };

  const titleWord = 'Portfolio';
  const charsRevealed = Math.floor((progress / 100) * titleWord.length);

  return (
    <AnimatePresence>
      {!dismissing && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.8, ease: [0.76, 0, 0.24, 1] } }}
          className="fixed inset-0 z-[200] bg-bg-base flex flex-col items-center justify-center overflow-hidden"
        >
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at 25% 40%, rgba(168, 85, 247, 0.18), transparent 55%), radial-gradient(ellipse at 75% 60%, rgba(6, 182, 212, 0.14), transparent 55%)',
              filter: 'blur(40px)',
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
            className="relative z-10 flex flex-col items-center"
          >
            <h1
              className="font-elegant text-[32px] md:text-[44px] font-light tracking-tight flex items-baseline"
              style={{ fontFamily: 'var(--font-elegant)' }}
            >
              <span className="italic font-light text-white/90">Oikantik&rsquo;s</span>
              <span className="font-semibold ml-3">
                {titleWord.split('').map((char, i) => {
                  const revealed = i < charsRevealed;
                  return (
                    <motion.span
                      key={i}
                      animate={{
                        opacity: revealed ? 1 : 0.15,
                      }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      style={
                        revealed
                          ? {
                              background:
                                'linear-gradient(135deg, #A855F7 0%, #06B6D4 100%)',
                              WebkitBackgroundClip: 'text',
                              backgroundClip: 'text',
                              WebkitTextFillColor: 'transparent',
                              color: 'transparent',
                            }
                          : { color: '#3a3a3a' }
                      }
                    >
                      {char}
                    </motion.span>
                  );
                })}
              </span>
            </h1>
          </motion.div>

          <div className="relative z-10 mt-10 h-10 flex items-center justify-center">
            <AnimatePresence>
              {ready && (
                <motion.button
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                  onClick={handleEnterClick}
                  onMouseEnter={() => setHoveringButton(true)}
                  onMouseLeave={() => setHoveringButton(false)}
                  className="relative px-9 py-2.5 rounded-full overflow-hidden border border-purple-400/40 text-xs tracking-[0.25em] uppercase font-medium"
                >
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: hoveringButton ? 1.25 : 0,
                      opacity: hoveringButton ? 1 : 0,
                    }}
                    transition={{ duration: 0.4, ease: [0.76, 0, 0.24, 1] }}
                    style={{
                      background:
                        'linear-gradient(135deg, #A855F7 0%, #06B6D4 100%)',
                    }}
                  />
                  <span
                    className={`relative z-10 transition-colors duration-300 ${
                      hoveringButton ? 'text-black' : 'text-white/90'
                    }`}
                  >
                    Enter
                  </span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {!ready && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-10"
            >
              <div className="w-24 h-px bg-white/10 overflow-hidden rounded-full">
                <motion.div
                  className="h-full"
                  style={{
                    background:
                      'linear-gradient(90deg, #A855F7 0%, #06B6D4 100%)',
                  }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
              <span className="text-[10px] tracking-[0.3em] uppercase text-white/40 font-mono">
                {progress >= 100 ? 'Ready' : 'Loading'}
              </span>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
