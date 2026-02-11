import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { PROJECTS } from '../constants';
import { ArrowUpRight } from 'lucide-react';
import ProjectModal from './ProjectModal';

const Projects: React.FC = () => {
    const [selectedProject, setSelectedProject] = useState<typeof PROJECTS[0] | null>(null);

    return (
        <section className="py-24 px-6 z-10 relative bg-void-black/80 backdrop-blur-sm">
            <div className="max-w-7xl mx-auto">
                <motion.h2
                    initial={{ opacity: 0, x: -50 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    className="text-4xl md:text-6xl font-oswald text-white mb-16 border-b border-white/10 pb-6"
                >
                    SELECTED <span className="text-influence-red">WORKS</span>
                </motion.h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {PROJECTS.map((project, index) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            index={index}
                            onClick={() => setSelectedProject(project)}
                        />
                    ))}
                </div>
            </div>

            {/* Cinematic Modal */}
            <ProjectModal
                project={selectedProject}
                onClose={() => setSelectedProject(null)}
            />
        </section>
    );
};

// ─── 3D Tilt Project Card ──────────────────────────────────────
interface ProjectCardProps {
    project: typeof PROJECTS[0];
    index: number;
    onClick: () => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, index, onClick }) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [transform, setTransform] = useState('perspective(800px) rotateX(0deg) rotateY(0deg)');
    const [isHovered, setIsHovered] = useState(false);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -8;
        const rotateY = ((x - centerX) / centerX) * 8;
        setTransform(`perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setTransform('perspective(800px) rotateX(0deg) rotateY(0deg) scale(1)');
        setIsHovered(false);
    }, []);

    return (
        <motion.div
            ref={cardRef}
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.15 }}
            className="group relative overflow-hidden rounded-lg border border-white/5 project-card-3d cursor-pointer"
            style={{ transform, transition: 'transform 0.15s ease-out' }}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={handleMouseLeave}
            onClick={onClick}
        >
            {/* Gradient sweep effect */}
            <div className="gradient-sweep" />

            {/* Glow border on hover */}
            <div
                className="absolute inset-0 rounded-lg pointer-events-none z-10 transition-opacity duration-300"
                style={{
                    opacity: isHovered ? 1 : 0,
                    boxShadow: '0 0 0 1px rgba(230,57,70,0.4), 0 0 30px rgba(230,57,70,0.1), inset 0 0 30px rgba(230,57,70,0.03)',
                }}
            />

            <div className="aspect-[4/5] overflow-hidden bg-card-dark relative">
                <img
                    src={project.image}
                    alt={project.title}
                    loading="lazy"
                    className="w-full h-full object-cover opacity-80 md:opacity-60 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700 md:grayscale group-hover:grayscale-0"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-void-black via-void-black/50 to-transparent opacity-90" />

                <div className="absolute bottom-0 left-0 p-6 w-full z-20">
                    <p className="text-influence-red font-oswald text-sm tracking-widest mb-2">{project.category}</p>
                    <h3 className="text-2xl font-oswald text-white mb-2 group-hover:text-influence-red transition-colors">{project.title}</h3>

                    {/* Description */}
                    <div className="md:h-0 md:overflow-hidden md:group-hover:h-auto md:transition-all md:duration-500">
                        <p className="text-text-muted font-playfair text-sm line-clamp-3 mb-3 md:opacity-0 md:group-hover:opacity-100 md:transform md:translate-y-4 md:group-hover:translate-y-0 transition-all duration-500">
                            {project.description}
                        </p>
                    </div>
                    <p className="md:hidden text-text-muted font-playfair text-sm line-clamp-3 mb-3">
                        {project.description}
                    </p>

                    {/* Stats bar — slides up on hover */}
                    <div className="flex gap-3 mb-3 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 delay-100">
                        {Object.entries(project.stats).map(([key, value]) => (
                            <span
                                key={key}
                                className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] font-oswald tracking-wider text-text-muted uppercase"
                            >
                                {key}: <span className="text-influence-red">{value}</span>
                            </span>
                        ))}
                    </div>

                    <span className="inline-flex items-center gap-2 text-white text-sm font-oswald uppercase tracking-wider border-b border-transparent group-hover:border-influence-red transition-all">
                        View Details <ArrowUpRight className="w-4 h-4" />
                    </span>
                </div>
            </div>
        </motion.div>
    );
};

export default Projects;
