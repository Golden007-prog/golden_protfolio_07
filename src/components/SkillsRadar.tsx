import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { SKILL_CATEGORIES } from '../constants';

const SkillsRadar: React.FC = () => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const sides = SKILL_CATEGORIES.length;
    const size = 200; // radius
    const center = size + 40; // center of SVG
    const svgSize = (size + 40) * 2;

    // Calculate polygon points for a given level (0-100)
    const getPolygonPoints = useMemo(() => {
        return (level: number) => {
            const points: string[] = [];
            for (let i = 0; i < sides; i++) {
                const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
                const r = (level / 100) * size;
                const x = center + r * Math.cos(angle);
                const y = center + r * Math.sin(angle);
                points.push(`${x},${y}`);
            }
            return points.join(' ');
        };
    }, [sides, size, center]);

    // Get label positions
    const labelPositions = useMemo(() => {
        return SKILL_CATEGORIES.map((_, i) => {
            const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
            const r = size + 25;
            return {
                x: center + r * Math.cos(angle),
                y: center + r * Math.sin(angle),
            };
        });
    }, [sides, size, center]);

    // Get dot positions for actual skill levels
    const dotPositions = useMemo(() => {
        return SKILL_CATEGORIES.map((cat, i) => {
            const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
            const r = (cat.level / 100) * size;
            return {
                x: center + r * Math.cos(angle),
                y: center + r * Math.sin(angle),
            };
        });
    }, [sides, size, center]);

    return (
        <div className="w-full flex flex-col items-center">
            <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="relative"
            >
                <svg
                    width={svgSize}
                    height={svgSize}
                    viewBox={`0 0 ${svgSize} ${svgSize}`}
                    className="max-w-full h-auto"
                >
                    {/* Grid rings */}
                    {[20, 40, 60, 80, 100].map((level) => (
                        <polygon
                            key={level}
                            points={getPolygonPoints(level)}
                            fill="none"
                            stroke="rgba(255,255,255,0.06)"
                            strokeWidth="1"
                        />
                    ))}

                    {/* Axis lines */}
                    {SKILL_CATEGORIES.map((_, i) => {
                        const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
                        const endX = center + size * Math.cos(angle);
                        const endY = center + size * Math.sin(angle);
                        return (
                            <line
                                key={i}
                                x1={center}
                                y1={center}
                                x2={endX}
                                y2={endY}
                                stroke="rgba(255,255,255,0.06)"
                                strokeWidth="1"
                            />
                        );
                    })}

                    {/* Filled area */}
                    <motion.polygon
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.3, duration: 1 }}
                        points={getPolygonPoints(0)}
                        animate={{ points: SKILL_CATEGORIES.map((cat, i) => {
                            const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
                            const r = (cat.level / 100) * size;
                            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
                        }).join(' ') }}
                        fill="rgba(230, 57, 70, 0.1)"
                        stroke="rgba(230, 57, 70, 0.6)"
                        strokeWidth="2"
                    />

                    {/* Data points (dots) */}
                    {dotPositions.map((pos, i) => (
                        <motion.circle
                            key={i}
                            cx={pos.x}
                            cy={pos.y}
                            r={hoveredIndex === i ? 7 : 4}
                            fill={hoveredIndex === i ? '#E63946' : 'rgba(230, 57, 70, 0.8)'}
                            stroke={hoveredIndex === i ? 'rgba(230, 57, 70, 0.4)' : 'none'}
                            strokeWidth={hoveredIndex === i ? 8 : 0}
                            className="cursor-pointer transition-all duration-200"
                            onMouseEnter={() => setHoveredIndex(i)}
                            onMouseLeave={() => setHoveredIndex(null)}
                            style={{ pointerEvents: 'all' }}
                            initial={{ opacity: 0, r: 0 }}
                            whileInView={{ opacity: 1, r: hoveredIndex === i ? 7 : 4 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.5 + i * 0.1 }}
                        />
                    ))}

                    {/* Labels */}
                    {SKILL_CATEGORIES.map((cat, i) => {
                        const pos = labelPositions[i];
                        const isHovered = hoveredIndex === i;
                        return (
                            <text
                                key={i}
                                x={pos.x}
                                y={pos.y}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill={isHovered ? '#E63946' : 'rgba(255,255,255,0.5)'}
                                fontSize="11"
                                fontFamily="Oswald, sans-serif"
                                letterSpacing="0.05em"
                                className="uppercase transition-colors duration-200 select-none"
                                style={{ pointerEvents: 'none' }}
                            >
                                {cat.name}
                            </text>
                        );
                    })}

                    {/* Level label on hover */}
                    {hoveredIndex !== null && (
                        <text
                            x={center}
                            y={center}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="#E63946"
                            fontSize="28"
                            fontFamily="Oswald, sans-serif"
                            fontWeight="bold"
                        >
                            {SKILL_CATEGORIES[hoveredIndex].level}%
                        </text>
                    )}
                </svg>
            </motion.div>

            {/* Hovered skill details */}
            <motion.div
                className="mt-4 h-16 flex flex-col items-center"
                animate={{ opacity: hoveredIndex !== null ? 1 : 0 }}
            >
                {hoveredIndex !== null && (
                    <>
                        <p className="text-sm font-oswald tracking-wider text-white uppercase mb-2">
                            {SKILL_CATEGORIES[hoveredIndex].name} — Related Skills
                        </p>
                        <div className="flex flex-wrap gap-2 justify-center">
                            {SKILL_CATEGORIES[hoveredIndex].skills.map((skill) => (
                                <span
                                    key={skill}
                                    className="px-2 py-0.5 bg-influence-red/10 border border-influence-red/20 rounded text-[10px] font-oswald tracking-wider text-influence-red"
                                >
                                    {skill}
                                </span>
                            ))}
                        </div>
                    </>
                )}
            </motion.div>
        </div>
    );
};

export default SkillsRadar;
