import { motion } from 'framer-motion';
import { PERSONAL_INFO } from '../constants';
import { Mail, Github, Linkedin } from 'lucide-react';

const Contact: React.FC = () => {
    return (
        <section id="contact" className="py-24 px-6 z-10 relative bg-gradient-to-b from-void-black to-card-dark/50">
            <div className="max-w-4xl mx-auto text-center">
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-4xl md:text-6xl font-oswald text-white mb-8"
                >
                    LET'S <span className="text-influence-red">CONNECT</span>
                </motion.h2>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 }}
                    className="text-text-muted font-playfair text-lg md:text-xl mb-12 max-w-2xl mx-auto px-4"
                >
                    Interested in collaborating or have a project in mind?
                    Let's turn your data into actionable insights.
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 }}
                    className="flex flex-col md:flex-row justify-center items-center gap-8"
                >
                    <a
                        href={`mailto:${PERSONAL_INFO.email}`}
                        className="group flex items-center gap-3 px-8 py-4 bg-white/5 border border-white/10 hover:border-influence-red hover:bg-influence-red/10 transition-all duration-300 rounded-sm w-full md:w-auto justify-center"
                    >
                        <Mail className="text-influence-red group-hover:scale-110 transition-transform" />
                        <span className="font-oswald tracking-widest text-white">SAY HELLO</span>
                    </a>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.6 }}
                    className="mt-16 flex justify-center gap-8 md:gap-12"
                >
                    <a href={PERSONAL_INFO.socials.github} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-white hover:scale-110 transition-all p-2" aria-label="GitHub">
                        <Github className="w-6 h-6 md:w-8 md:h-8" />
                    </a>
                    <a href={PERSONAL_INFO.socials.linkedin} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-white hover:scale-110 transition-all p-2" aria-label="LinkedIn">
                        <Linkedin className="w-6 h-6 md:w-8 md:h-8" />
                    </a>
                    <a href={PERSONAL_INFO.socials.researchgate} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-white hover:scale-110 transition-all p-2" title="ResearchGate" aria-label="ResearchGate">
                        <svg role="img" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 md:w-8 md:h-8">
                            <path d="M19.586 0c-.818 0-1.508.19-2.073.565-.564.377-.97.91-1.215 1.602l-1.218 3.487H8.026c-.163 0-.296.06-.4.18-.103.12-.154.266-.154.437v1.82c0 .166.05.312.153.437.104.12.237.18.4.18h6.21l-1.485 4.25H5.16l-.596-1.706c-.164-.47-.44-.84-.826-1.11-.387-.27-.83-.406-1.334-.406H1.277c-.36 0-.667.13-.918.39-.25.26-.376.58-.376.953v.042c0 .36.125.67.376.93.25.26.558.39.918.39h1.125l4.314 12.35c.162.465.438.832.825 1.1.388.27.832.405 1.335.405h2.05c.503 0 .947-.135 1.334-.405.387-.268.663-.635.825-1.1l.54-1.545h6.14c.163 0 .296-.06.4-.18.103-.12.154-.266.154-.437v-1.82c0-.166-.05-.312-.153-.437-.104-.12-.237-.18-.4-.18h-5.23l1.485-4.25h5.97c.818 0 1.51-.19 2.074-.566.564-.376.97-.91 1.215-1.603l1.217-3.487c.163-.465.245-.96.245-1.483 0-.52-.082-1.014-.245-1.48-.245-.693-.65-1.226-1.215-1.603C21.096.19 20.404 0 19.586 0z" />
                        </svg>
                    </a>
                    <a href={PERSONAL_INFO.socials.leetcode} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-white hover:scale-110 transition-all p-2" title="LeetCode" aria-label="LeetCode">
                        <svg role="img" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 md:w-8 md:h-8">
                            <path d="M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.94-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-1.045-2.774-1.202l2.015-2.158A1.384 1.384 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z" />
                        </svg>
                    </a>
                </motion.div>
            </div>
        </section>
    );
};

export default Contact;
