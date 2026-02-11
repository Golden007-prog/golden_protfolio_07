import React, { useState, useEffect } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { MORE_PROJECTS } from '../constants';
import { Youtube, Globe, ArrowUpRight, Play } from 'lucide-react';
import useMeasure from 'react-use-measure';

const ProjectSlider: React.FC = () => {
    const [ref, { width }] = useMeasure();
    const xTranslation = useMotionValue(0);
    const [mustFinish, setMustFinish] = useState(false);
    const [rerender, setRerender] = useState(false);

    // Speed of the carousel
    const FAST_DURATION = 25;
    const SLOW_DURATION = 75;

    const [duration, setDuration] = useState(FAST_DURATION);

    useEffect(() => {
        let controls;
        const finalPosition = -width / 2 - 8;

        if (mustFinish) {
            controls = animate(xTranslation, [xTranslation.get(), finalPosition], {
                ease: 'linear',
                duration: duration * (1 - xTranslation.get() / finalPosition),
                onComplete: () => {
                    setMustFinish(false);
                    setRerender(!rerender);
                },
            });
        } else {
            controls = animate(xTranslation, [0, finalPosition], {
                ease: 'linear',
                duration: duration,
                repeat: Infinity,
                repeatType: 'loop',
                repeatDelay: 0,
            });
        }

        return controls?.stop;
    }, [xTranslation, width, duration, rerender, mustFinish]);

    return (
        <section className="py-24 bg-void-black border-t border-white/5 overflow-hidden">
            <div className="max-w-7xl mx-auto px-6 mb-12">
                <motion.h2
                    initial={{ opacity: 0, x: -50 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    className="text-3xl md:text-5xl font-oswald text-white"
                >
                    MORE <span className="text-influence-red">EXPLORATIONS</span>
                </motion.h2>
                <p className="text-text-muted mt-4 font-playfair">
                    A collection of videos, experiments, and past web projects.
                </p>
            </div>

            <div className="relative w-full overflow-hidden">
                <motion.div
                    className="flex gap-8 absolute left-0"
                    style={{ x: xTranslation }}
                    ref={ref}
                    onHoverStart={() => {
                        setMustFinish(true);
                        setDuration(SLOW_DURATION);
                    }}
                    onHoverEnd={() => {
                        setMustFinish(true);
                        setDuration(FAST_DURATION);
                    }}
                >
                    {[...MORE_PROJECTS, ...MORE_PROJECTS].map((project, index) => (
                        <Card key={index} project={project} />
                    ))}
                </motion.div>
                {/* Visual height spacer since the absolute motion div won't take up space */}
                <div className="flex gap-8 invisible">
                    {[...MORE_PROJECTS].map((project, index) => (
                        <Card key={index} project={project} />
                    ))}
                </div>
            </div>
        </section>
    );
};

interface CardProps {
    project: typeof MORE_PROJECTS[0];
}

const Card: React.FC<CardProps> = ({ project }) => {
    return (
        <a
            href={project.link}
            target="_blank"
            rel="noopener noreferrer"
            className="relative h-[250px] w-[350px] md:h-[300px] md:w-[450px] overflow-hidden rounded-xl border border-white/10 bg-card-dark shrink-0 group"
        >
            <div className="absolute inset-0 bg-gradient-to-t from-void-black to-transparent opacity-60 z-10" />

            <img
                src={project.image}
                alt={project.title}
                className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500 group-hover:scale-110"
            />

            <div className="absolute top-4 left-4 z-20">
                {project.type === 'video' ? (
                    <div className="bg-red-600/90 p-2 rounded-full backdrop-blur-sm">
                        <Youtube className="w-5 h-5 text-white" />
                    </div>
                ) : (
                    <div className="bg-blue-600/90 p-2 rounded-full backdrop-blur-sm">
                        <Globe className="w-5 h-5 text-white" />
                    </div>
                )}
            </div>

            <div className="absolute inset-0 z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                {project.type === 'video' ? (
                    <div className="bg-influence-red/80 p-4 rounded-full backdrop-blur-md transform scale-50 group-hover:scale-100 transition-transform duration-300">
                        <Play className="w-8 h-8 text-white fill-current" />
                    </div>
                ) : (
                    <div className="bg-white/10 p-4 rounded-full backdrop-blur-md border border-white/20 transform scale-50 group-hover:scale-100 transition-transform duration-300">
                        <ArrowUpRight className="w-8 h-8 text-white" />
                    </div>
                )}
            </div>

            <div className="absolute bottom-0 left-0 w-full p-6 z-20 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                <h3 className="text-white font-oswald text-xl md:text-2xl mb-1 truncate">{project.title}</h3>
                <p className="text-text-muted text-xs md:text-sm font-playfair uppercase tracking-widest">{project.type === 'video' ? 'YouTube Content' : 'Web Project'}</p>
            </div>
        </a>
    );
};

export default ProjectSlider;
