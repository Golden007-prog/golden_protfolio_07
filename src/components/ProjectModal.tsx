import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Github, ExternalLink } from 'lucide-react';
import { PROJECTS } from '../constants';

interface ProjectModalProps {
    project: typeof PROJECTS[0] | null;
    onClose: () => void;
}

const ProjectModal: React.FC<ProjectModalProps> = ({ project, onClose }) => {
    // Close on ESC
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    }, [onClose]);

    useEffect(() => {
        if (project) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'unset';
        };
    }, [project, handleKeyDown]);

    return (
        <AnimatePresence>
            {project && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed inset-0 z-[1000] flex items-center justify-center p-4 md:p-8"
                    onClick={onClose}
                >
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-void-black/90 backdrop-blur-xl" />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ opacity: 0, y: 60, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 40, scale: 0.97 }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        className="relative z-10 w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-card-dark/80 border border-white/10 rounded-2xl backdrop-blur-md"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 z-20 p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all hover:border-influence-red group"
                        >
                            <X className="w-5 h-5 text-text-muted group-hover:text-white transition-colors" />
                        </button>

                        {/* Hero Image */}
                        <div className="relative w-full h-48 md:h-72 overflow-hidden rounded-t-2xl">
                            <img
                                src={project.image}
                                alt={project.title}
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-card-dark/90 via-card-dark/30 to-transparent" />

                            {/* Category badge */}
                            <div className="absolute top-4 left-4">
                                <span className="px-3 py-1 bg-influence-red/80 backdrop-blur-sm rounded-full text-xs font-oswald tracking-wider text-white uppercase">
                                    {project.category}
                                </span>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6 md:p-10">
                            <motion.h2
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                className="text-3xl md:text-4xl font-oswald text-white mb-4"
                            >
                                {project.title}
                            </motion.h2>

                            <motion.p
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="text-text-muted font-playfair text-base md:text-lg leading-relaxed mb-8"
                            >
                                {project.longDescription}
                            </motion.p>

                            {/* Stats Grid */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.35 }}
                                className="grid grid-cols-3 gap-4 mb-8"
                            >
                                {Object.entries(project.stats).map(([key, value], i) => (
                                    <div
                                        key={key}
                                        className="bg-white/5 border border-white/10 rounded-lg p-4 text-center"
                                    >
                                        <AnimatedStat value={value} delay={0.4 + i * 0.1} />
                                        <p className="text-text-muted text-xs font-oswald tracking-wider uppercase mt-1">{key}</p>
                                    </div>
                                ))}
                            </motion.div>

                            {/* Tech Stack */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.45 }}
                                className="mb-8"
                            >
                                <h4 className="text-sm font-oswald tracking-widest text-text-muted mb-3 uppercase">Tech Stack</h4>
                                <div className="flex flex-wrap gap-2">
                                    {project.techStack.map((tech) => (
                                        <span
                                            key={tech}
                                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-md text-xs font-oswald tracking-wider text-white hover:border-influence-red transition-colors"
                                        >
                                            {tech}
                                        </span>
                                    ))}
                                </div>
                            </motion.div>

                            {/* Action Buttons */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.5 }}
                                className="flex flex-wrap gap-4"
                            >
                                <a
                                    href={project.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 hover:border-influence-red hover:bg-influence-red/10 rounded-lg font-oswald tracking-wider text-sm text-white transition-all duration-300 group"
                                >
                                    <Github className="w-4 h-4 group-hover:text-influence-red transition-colors" />
                                    View on GitHub
                                </a>
                                <a
                                    href={project.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-6 py-3 bg-influence-red/10 border border-influence-red/30 hover:bg-influence-red/20 rounded-lg font-oswald tracking-wider text-sm text-white transition-all duration-300 group"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                    Live Demo
                                </a>
                            </motion.div>
                        </div>

                        {/* Bottom decorative line */}
                        <div className="h-[2px] bg-gradient-to-r from-transparent via-influence-red/50 to-transparent" />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// Animated stat value that counts up for numbers
const AnimatedStat: React.FC<{ value: string; delay: number }> = ({ value, delay }) => {
    return (
        <motion.p
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="text-xl md:text-2xl font-oswald text-influence-red font-bold"
        >
            {value}
        </motion.p>
    );
};

export default ProjectModal;
