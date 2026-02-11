import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const LoadingScreen: React.FC = () => {
    const [isVisible, setIsVisible] = useState(true);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    return 100;
                }
                return prev + Math.random() * 15 + 5;
            });
        }, 120);

        const timer = setTimeout(() => setIsVisible(false), 2400);
        return () => {
            clearTimeout(timer);
            clearInterval(interval);
        };
    }, []);

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: 'easeInOut' }}
                    className="fixed inset-0 z-[9999] bg-void-black flex flex-col items-center justify-center"
                >
                    {/* Scanner sweep */}
                    <motion.div
                        className="absolute inset-0 pointer-events-none"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 0.15, 0] }}
                        transition={{ duration: 2, repeat: Infinity }}
                    >
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(230,57,70,0.15)_0%,_transparent_70%)]" />
                    </motion.div>

                    {/* Horizontal scan line */}
                    <motion.div
                        className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-influence-red to-transparent opacity-40"
                        initial={{ top: '0%' }}
                        animate={{ top: '100%' }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                    />

                    {/* Logo text with glitch */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5 }}
                        className="relative"
                    >
                        <h1 className="text-5xl md:text-7xl font-oswald font-bold text-white tracking-[0.3em] relative">
                            <motion.span
                                animate={{
                                    textShadow: [
                                        '0 0 10px rgba(230,57,70,0)',
                                        '0 0 20px rgba(230,57,70,0.8)',
                                        '0 0 10px rgba(230,57,70,0)',
                                    ],
                                }}
                                transition={{ duration: 2, repeat: Infinity }}
                            >
                                OIKANTIK
                            </motion.span>
                            <span className="text-influence-red">.</span>
                        </h1>

                        {/* Glitch layers */}
                        <motion.h1
                            className="absolute inset-0 text-5xl md:text-7xl font-oswald font-bold text-influence-red/30 tracking-[0.3em] select-none"
                            animate={{
                                x: [0, -3, 3, 0],
                                opacity: [0, 0.5, 0],
                            }}
                            transition={{ duration: 0.3, repeat: Infinity, repeatDelay: 2 }}
                        >
                            OIKANTIK<span className="text-influence-red">.</span>
                        </motion.h1>
                    </motion.div>

                    {/* Subtitle */}
                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="mt-4 text-text-muted font-oswald tracking-[0.5em] text-xs md:text-sm uppercase"
                    >
                        Initializing Lab
                    </motion.p>

                    {/* Progress bar */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="mt-8 w-48 md:w-64 h-[1px] bg-white/10 relative overflow-hidden"
                    >
                        <motion.div
                            className="absolute left-0 top-0 h-full bg-influence-red"
                            style={{ width: `${Math.min(progress, 100)}%` }}
                            transition={{ duration: 0.1 }}
                        />
                    </motion.div>

                    {/* Status text */}
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.5 }}
                        transition={{ delay: 0.6 }}
                        className="mt-3 text-text-muted/50 font-mono text-[10px] tracking-widest"
                    >
                        SYS.LOAD &gt; {Math.min(Math.round(progress), 100)}%
                    </motion.p>

                    {/* Corner decorations */}
                    <div className="absolute top-6 left-6 w-8 h-8 border-l border-t border-white/10" />
                    <div className="absolute top-6 right-6 w-8 h-8 border-r border-t border-white/10" />
                    <div className="absolute bottom-6 left-6 w-8 h-8 border-l border-b border-white/10" />
                    <div className="absolute bottom-6 right-6 w-8 h-8 border-r border-b border-white/10" />
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default LoadingScreen;
