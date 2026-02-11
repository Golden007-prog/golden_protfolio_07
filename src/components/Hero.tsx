import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { PERSONAL_INFO, TYPING_ROLES } from '../constants';
import { Download, ChevronDown } from 'lucide-react';
import HeaderImg from '../assets/Headerimg1.png';

// Stagger container variant
const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.15, delayChildren: 0.2 },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } },
};

const Hero: React.FC = () => {
    // Typing animation state
    const [currentRoleIndex, setCurrentRoleIndex] = useState(0);
    const [displayText, setDisplayText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    // 3D tilt for avatar
    const avatarRef = useRef<HTMLDivElement>(null);
    const [tilt, setTilt] = useState({ x: 0, y: 0 });

    // Magnetic button
    const magnetRef = useRef<HTMLDivElement>(null);
    const [magnetOffset, setMagnetOffset] = useState({ x: 0, y: 0 });

    // Typing animation effect
    useEffect(() => {
        const currentRole = TYPING_ROLES[currentRoleIndex];
        let timeout: ReturnType<typeof setTimeout>;

        if (!isDeleting) {
            if (displayText.length < currentRole.length) {
                timeout = setTimeout(() => {
                    setDisplayText(currentRole.slice(0, displayText.length + 1));
                }, 80 + Math.random() * 40);
            } else {
                timeout = setTimeout(() => setIsDeleting(true), 2000);
            }
        } else {
            if (displayText.length > 0) {
                timeout = setTimeout(() => {
                    setDisplayText(displayText.slice(0, -1));
                }, 40);
            } else {
                setIsDeleting(false);
                setCurrentRoleIndex((prev) => (prev + 1) % TYPING_ROLES.length);
            }
        }

        return () => clearTimeout(timeout);
    }, [displayText, isDeleting, currentRoleIndex]);

    // Avatar 3D tilt on mouse move
    const handleAvatarMouseMove = useCallback((e: React.MouseEvent) => {
        if (!avatarRef.current) return;
        const rect = avatarRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const rotateY = ((e.clientX - centerX) / (rect.width / 2)) * 15;
        const rotateX = -((e.clientY - centerY) / (rect.height / 2)) * 15;
        setTilt({ x: rotateX, y: rotateY });
    }, []);

    const handleAvatarMouseLeave = useCallback(() => {
        setTilt({ x: 0, y: 0 });
    }, []);

    // Magnetic button effect
    const handleMagnetMouseMove = useCallback((e: React.MouseEvent) => {
        if (!magnetRef.current) return;
        const rect = magnetRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 120;

        if (distance < maxDist) {
            const strength = (1 - distance / maxDist) * 0.3;
            setMagnetOffset({ x: dx * strength, y: dy * strength });
        }
    }, []);

    const handleMagnetMouseLeave = useCallback(() => {
        setMagnetOffset({ x: 0, y: 0 });
    }, []);

    return (
        <section className="relative min-h-screen flex flex-col justify-center items-center z-10 px-6 pt-20 md:pt-0 overflow-hidden">
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="max-w-7xl w-full grid grid-cols-1 md:grid-cols-12 gap-8 items-center"
            >
                {/* Left: Socials & Intro (Desktop Only) */}
                <div className="md:col-span-1 relative h-full hidden md:flex flex-col justify-end pb-32">
                    <div className="flex gap-8 text-text-muted text-sm font-oswald tracking-widest -rotate-90 origin-bottom-left absolute bottom-32 left-8 whitespace-nowrap">
                        <a href={PERSONAL_INFO.socials.github} target="_blank" rel="noopener noreferrer" className="hover:text-influence-red transition-colors">GITHUB</a>
                        <a href={PERSONAL_INFO.socials.linkedin} target="_blank" rel="noopener noreferrer" className="hover:text-influence-red transition-colors">LINKEDIN</a>
                    </div>
                </div>

                {/* Center: Main Title */}
                <div className="md:col-span-11 flex flex-col justify-center items-center md:items-start">
                    {/* Typing Role Animation */}
                    <motion.div
                        variants={itemVariants}
                        className="text-influence-red font-oswald tracking-[0.2em] text-sm md:text-lg mb-4 text-center md:text-left h-7 flex items-center"
                    >
                        <span>{displayText}</span>
                        <span className="typing-cursor" />
                    </motion.div>

                    <div className="flex flex-col md:flex-row items-center gap-10 md:gap-16 lg:gap-24 w-full space-y-10 md:space-y-0">
                        <motion.h1
                            variants={itemVariants}
                            className="max-w-xl text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-bold font-oswald text-white leading-none mb-6 text-center md:text-left z-20"
                        >
                            OIKANTIK <br />
                            <span className="text-outline hover:text-white transition-colors duration-500">BASU</span>
                        </motion.h1>

                        {/* 3D Tilt Avatar */}
                        <motion.div
                            variants={itemVariants}
                            ref={avatarRef}
                            onMouseMove={handleAvatarMouseMove}
                            onMouseLeave={handleAvatarMouseLeave}
                            className="relative z-10 lg:ml-10 xl:ml-16 flex-shrink-0"
                            style={{ perspective: '800px' }}
                            animate={{ y: [0, -10, 0] }}
                            transition={{ repeat: Infinity, duration: 6, ease: 'easeInOut' }}
                        >
                            <motion.img
                                src={HeaderImg}
                                alt="Oikantik Basu"
                                className="w-48 sm:w-64 md:w-80 lg:w-96 object-cover block cursor-pointer drop-shadow-2xl"
                                style={{
                                    transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                                    transition: 'transform 0.15s ease-out',
                                }}
                                whileHover={{ scale: 1.03 }}
                                transition={{ duration: 0.4 }}
                            />
                            {/* Ambient glow under avatar */}
                            <div
                                className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-3/4 h-8 bg-influence-red/20 rounded-full blur-2xl pointer-events-none"
                                style={{
                                    transform: `translateX(calc(-50% + ${tilt.y * 2}px))`,
                                    transition: 'transform 0.15s ease-out',
                                }}
                            />
                        </motion.div>
                    </div>

                    <motion.div
                        variants={itemVariants}
                        className="max-w-xl mt-8 md:mt-0 text-center md:text-left"
                    >
                        <p className="text-text-muted text-base md:text-xl font-playfair italic border-l-0 md:border-l-2 border-influence-red pl-0 md:pl-6 mb-8">
                            "{PERSONAL_INFO.tagline}"
                        </p>

                        <div className="flex flex-col sm:flex-row gap-6 items-center justify-center md:justify-start">
                            {/* Magnetic Resume Button */}
                            <div
                                ref={magnetRef}
                                onMouseMove={handleMagnetMouseMove}
                                onMouseLeave={handleMagnetMouseLeave}
                                className="relative"
                            >
                                <motion.div
                                    className="relative group rounded-[20px] p-[1px] overflow-hidden inline-block"
                                    style={{
                                        transform: `translate(${magnetOffset.x}px, ${magnetOffset.y}px)`,
                                        transition: 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                                    }}
                                >
                                    {/* Rainbow Border Animation */}
                                    <div className="absolute inset-[-100%] bg-[conic-gradient(from_90deg_at_50%_50%,#E2CBFF_0%,#393BB2_50%,#E2CBFF_100%)] animate-[spin_2s_linear_infinite] opacity-70 group-hover:opacity-100 transition-opacity duration-500" />
                                    <div className="absolute inset-[-100%] bg-[conic-gradient(from_90deg_at_50%_50%,#ff0000_0%,#00ff00_33%,#0000ff_66%,#ff0000_100%)] animate-[spin_2s_linear_infinite] opacity-100 mix-blend-overlay" />

                                    <motion.a
                                        href="/Oikantik_Basu.pdf"
                                        download="Oikantik_Basu_Resume.pdf"
                                        whileHover={{ scale: 0.98 }}
                                        whileTap={{ scale: 0.95 }}
                                        className="relative flex items-center gap-3 px-8 py-3 bg-black rounded-[19px] text-white font-oswald tracking-widest text-sm hover:bg-gray-900 transition-all duration-300 z-10"
                                    >
                                        <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent group-hover:text-white transition-colors">
                                            DOWNLOAD RESUME
                                        </span>
                                        <Download className="w-4 h-4 text-influence-red group-hover:text-white transition-colors" />
                                    </motion.a>
                                </motion.div>
                            </div>

                            {/* Mobile Social Links */}
                            <div className="flex md:hidden gap-6 text-text-muted">
                                <a href={PERSONAL_INFO.socials.github} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GITHUB</a>
                                <a href={PERSONAL_INFO.socials.linkedin} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">LINKEDIN</a>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </motion.div>

            {/* Enhanced Scroll Indicator */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="absolute bottom-10 flex flex-col items-center gap-2 hidden md:flex"
            >
                <span className="text-text-muted/50 text-[10px] font-oswald tracking-[0.4em] uppercase">Scroll</span>
                <div className="scroll-indicator flex flex-col items-center">
                    <div className="w-[1px] h-6 bg-gradient-to-b from-influence-red to-transparent" />
                    <ChevronDown className="text-influence-red w-4 h-4 mt-1" />
                </div>
            </motion.div>
        </section>
    );
};

export default Hero;
