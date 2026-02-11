import { motion } from 'framer-motion';
import { EXPERIENCE, EDUCATION } from '../constants';
import SkillsRadar from './SkillsRadar';

const sectionVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.08 },
    },
};

const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
};

const Experience: React.FC = () => {
    return (
        <section id="experience" className="py-24 px-6 z-10 relative">
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24">

                {/* Experience Column */}
                <div>
                    <motion.h2
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="text-3xl md:text-5xl font-oswald text-white mb-12 border-b border-white/10 pb-4 inline-block"
                    >
                        EXPERIENCE
                    </motion.h2>

                    <motion.div
                        variants={sectionVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        className="space-y-12"
                    >
                        {EXPERIENCE.map((exp) => (
                            <motion.div
                                key={exp.id}
                                variants={itemVariants}
                                className="border-l-2 border-white/10 pl-8 relative group hover:border-influence-red/50 transition-colors duration-300"
                            >
                                <span className="absolute -left-[9px] top-0 w-4 h-4 bg-influence-red rounded-full ring-4 ring-void-black group-hover:ring-influence-red/20 transition-all" />
                                <h3 className="text-2xl font-oswald text-white group-hover:text-influence-red transition-colors">{exp.role}</h3>
                                <p className="text-influence-red font-oswald tracking-wide mb-2 text-sm md:text-base">{exp.company} | {exp.period}</p>
                                <p className="text-text-muted font-playfair text-sm md:text-base leading-relaxed">{exp.description}</p>
                            </motion.div>
                        ))}
                    </motion.div>
                </div>

                {/* Skills & Education Column */}
                <div className="flex flex-col gap-16">
                    {/* Skills Radar */}
                    <div>
                        <motion.h2
                            initial={{ opacity: 0, x: -50 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            className="text-3xl md:text-5xl font-oswald text-white mb-12 border-b border-white/10 pb-4 inline-block"
                        >
                            TECHNICAL <span className="text-outline-red">ARSENAL</span>
                        </motion.h2>

                        <SkillsRadar />
                    </div>

                    {/* Education */}
                    <div>
                        <motion.h2
                            initial={{ opacity: 0, x: -50 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            className="text-3xl md:text-5xl font-oswald text-white mb-12 border-b border-white/10 pb-4 inline-block"
                        >
                            EDUCATION
                        </motion.h2>

                        <motion.div
                            variants={sectionVariants}
                            initial="hidden"
                            whileInView="visible"
                            viewport={{ once: true }}
                            className="space-y-12"
                        >
                            {EDUCATION.map((edu) => (
                                <motion.div
                                    key={edu.id}
                                    variants={itemVariants}
                                    className="border-l-2 border-white/10 pl-8 relative group hover:border-white/30 transition-colors duration-300"
                                >
                                    <span className="absolute -left-[9px] top-0 w-4 h-4 bg-white rounded-full ring-4 ring-void-black" />
                                    <h3 className="text-xl md:text-2xl font-oswald text-white">{edu.institution}</h3>
                                    <p className="text-influence-red font-oswald tracking-wide mb-2 text-sm md:text-base">{edu.degree}</p>
                                    <p className="text-text-muted font-playfair text-xs md:text-sm mb-2 italic">{edu.period}</p>
                                    <p className="text-text-muted font-playfair text-sm md:text-base leading-relaxed">{edu.description}</p>
                                </motion.div>
                            ))}
                        </motion.div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Experience;
