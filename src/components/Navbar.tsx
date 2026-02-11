import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, FlaskConical } from 'lucide-react';
import { useLabMode } from './LabModeContext';

const Navbar: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const { labMode, toggleLabMode } = useLabMode();

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
    }, [isOpen]);

    const navLinks = [
        { name: 'Home', href: '#' },
        { name: 'Projects', href: '#projects' },
        { name: 'Experience', href: '#experience' },
        { name: 'Contact', href: '#contact' },
    ];

    const menuVariants = {
        closed: {
            opacity: 0,
            x: "100%",
            transition: { stiffness: 400, damping: 40 }
        },
        open: {
            opacity: 1,
            x: 0,
            transition: { stiffness: 400, damping: 40 }
        }
    };

    const linkVariants = {
        closed: { x: 50, opacity: 0 },
        open: (i: number) => ({
            x: 0,
            opacity: 1,
            transition: { delay: i * 0.1, stiffness: 300, damping: 24 }
        })
    };

    return (
        <nav className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${scrolled || isOpen ? 'bg-void-black/90 backdrop-blur-md py-4 border-b border-white/5' : 'py-6 bg-transparent'}`}>
            <div className="max-w-7xl mx-auto px-6 flex justify-between items-center relative z-50">
                <a href="#" className="text-2xl font-oswald font-bold text-white tracking-widest z-50">
                    OIKANTIK<span className="text-influence-red">.</span>
                </a>

                {/* Desktop Menu */}
                <div className="hidden md:flex gap-8 items-center">
                    {navLinks.map((link) => (
                        <a
                            key={link.name}
                            href={link.href}
                            className="text-sm font-oswald uppercase tracking-wider text-text-muted hover:text-white transition-colors relative group"
                        >
                            {link.name}
                            <span className="absolute -bottom-1 left-0 w-0 h-[2px] bg-influence-red transition-all duration-300 group-hover:w-full" />
                        </a>
                    ))}

                    {/* Lab Mode Toggle */}
                    <button
                        onClick={toggleLabMode}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-oswald tracking-wider uppercase transition-all duration-300 ${
                            labMode
                                ? 'border-influence-red bg-influence-red/10 text-influence-red shadow-[0_0_15px_rgba(230,57,70,0.2)]'
                                : 'border-white/10 text-text-muted hover:border-white/30 hover:text-white'
                        }`}
                    >
                        <FlaskConical className="w-3.5 h-3.5" />
                        <span>Lab</span>
                        <span className={`w-1.5 h-1.5 rounded-full transition-colors ${labMode ? 'bg-influence-red animate-pulse' : 'bg-text-muted/50'}`} />
                    </button>
                </div>

                {/* Mobile Menu Button */}
                <div className="flex md:hidden items-center gap-3">
                    <button
                        onClick={toggleLabMode}
                        className={`p-2 rounded-full border transition-all ${
                            labMode ? 'border-influence-red text-influence-red' : 'border-white/10 text-text-muted'
                        }`}
                    >
                        <FlaskConical className="w-4 h-4" />
                    </button>
                    <button
                        className="text-white z-50 hover:text-influence-red transition-colors"
                        onClick={() => setIsOpen(!isOpen)}
                        aria-label="Toggle Menu"
                    >
                        {isOpen ? <X size={32} /> : <Menu size={32} />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial="closed"
                        animate="open"
                        exit="closed"
                        variants={menuVariants}
                        className="fixed inset-0 bg-void-black z-40 flex flex-col justify-center items-center md:hidden"
                    >
                        <div className="flex flex-col gap-8 text-center">
                            {navLinks.map((link, i) => (
                                <motion.a
                                    key={link.name}
                                    href={link.href}
                                    custom={i}
                                    variants={linkVariants}
                                    onClick={() => setIsOpen(false)}
                                    className="text-4xl font-oswald uppercase tracking-widest text-white hover:text-influence-red transition-colors"
                                >
                                    {link.name}
                                </motion.a>
                            ))}
                        </div>

                        <div className="absolute bottom-0 left-0 w-full h-1/3 bg-gradient-to-t from-influence-red/10 to-transparent pointer-events-none" />
                    </motion.div>
                )}
            </AnimatePresence>
        </nav>
    );
};

export default Navbar;
