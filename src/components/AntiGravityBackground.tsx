import { useEffect, useRef } from 'react';
import { useLabMode } from './LabModeContext';

const AntiGravityBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const labModeRef = useRef(false);
    const { labMode } = useLabMode();

    // Keep ref in sync without re-running the effect
    useEffect(() => {
        labModeRef.current = labMode;
    }, [labMode]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = window.innerWidth;
        let height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;

        const particles: Particle[] = [];
        const particleCount = 120;
        let animationId: number;

        class Particle {
            x: number;
            y: number;
            size: number;
            speedY: number;
            color: string;
            originalX: number;
            opacity: number;

            constructor() {
                this.x = Math.random() * width;
                this.y = Math.random() * height + height;
                this.size = Math.random() * 2 + 0.5;
                this.speedY = Math.random() * 0.5 + 0.2;
                this.color = Math.random() > 0.8 ? '#E63946' : '#ffffff';
                this.originalX = this.x;
                this.opacity = Math.random() * 0.5 + 0.3;
            }

            update(mouseX: number, mouseY: number) {
                this.y -= this.speedY;

                if (this.y < -10) {
                    this.y = height + 10;
                    this.x = Math.random() * width;
                    this.originalX = this.x;
                }

                // Mouse interaction (Repel)
                const dx = this.x - mouseX;
                const dy = this.y - mouseY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const maxDistance = 150;

                if (distance < maxDistance) {
                    const forceDirectionX = dx / distance;
                    const forceDirectionY = dy / distance;
                    const force = (maxDistance - distance) / maxDistance;
                    this.x += forceDirectionX * force * 2;
                    this.y += forceDirectionY * force * 2;
                } else {
                    if (this.x !== this.originalX) {
                        const dx = this.x - this.originalX;
                        this.x -= dx * 0.02;
                    }
                }
            }

            draw() {
                if (!ctx) return;
                ctx.globalAlpha = this.opacity;
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }

        const init = () => {
            for (let i = 0; i < particleCount; i++) {
                particles.push(new Particle());
            }
        };

        let mouseX = -9999;
        let mouseY = -9999;

        const drawConnections = () => {
            if (!ctx || !labModeRef.current) return;
            const connectionDistance = 120;
            ctx.lineWidth = 0.5;

            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < connectionDistance) {
                        const opacity = (1 - dist / connectionDistance) * 0.2;
                        ctx.strokeStyle = `rgba(230, 57, 70, ${opacity})`;
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.stroke();
                    }
                }
            }
        };

        const animate = () => {
            ctx.clearRect(0, 0, width, height);
            particles.forEach(p => {
                p.update(mouseX, mouseY);
                p.draw();
            });
            drawConnections();
            animationId = requestAnimationFrame(animate);
        };

        const handleResize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
        };

        const handleMouseMove = (e: MouseEvent) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length > 0) {
                mouseX = e.touches[0].clientX;
                mouseY = e.touches[0].clientY;
            }
        };

        window.addEventListener('resize', handleResize);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('touchmove', handleTouchMove);
        window.addEventListener('touchstart', handleTouchMove);

        init();
        animate();

        return () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchstart', handleTouchMove);
        };
    }, []);

    return <canvas ref={canvasRef} />;
};

export default AntiGravityBackground;
