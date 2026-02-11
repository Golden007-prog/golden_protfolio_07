import { useEffect, useRef, useCallback } from 'react';
import CursorImg from '/img/Cursor.png';

type CursorState = 'idle' | 'running' | 'pointing' | 'clicking' | 'grabbing';

const CLICKABLE_SELECTOR = 'a, button, [role="button"], .project-card, .clickable, input[type="submit"], [tabindex="0"]';
const DRAGGABLE_SELECTOR = '.draggable, [draggable="true"]';
const LERP_FACTOR = 0.15;
const IDLE_TIMEOUT = 300;
const CLICK_RESET_MS = 150;
const CURSOR_SIZE = 56;

const CharacterCursor: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const glowRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const labelRef = useRef<HTMLDivElement>(null);

    // Position refs — never trigger re-renders
    const mousePos = useRef({ x: -100, y: -100 });
    const currentPos = useRef({ x: -100, y: -100 });
    const velocity = useRef({ x: 0, y: 0 });
    const stateRef = useRef<CursorState>('idle');
    const prevStateRef = useRef<CursorState>('idle');
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rafRef = useRef<number>(0);
    const isHoveringClickable = useRef(false);
    const frameCount = useRef(0);
    const isTouchDevice = useRef(false);

    // Apply visual state to DOM directly — no React state
    const applyState = useCallback((state: CursorState) => {
        const container = containerRef.current;
        const img = imgRef.current;
        const glow = glowRef.current;
        const label = labelRef.current;
        if (!container || !img || !glow || !label) return;

        // Remove all state classes
        container.className = 'character-cursor';
        container.classList.add(`cc-${state}`);

        // State-specific transforms on the image
        switch (state) {
            case 'idle':
                img.style.transform = 'rotate(0deg) scale(1)';
                glow.style.opacity = '0.3';
                glow.style.transform = 'scale(1)';
                label.textContent = '';
                label.style.opacity = '0';
                break;
            case 'running': {
                const angle = Math.atan2(velocity.current.y, velocity.current.x) * (180 / Math.PI);
                const tilt = Math.max(-15, Math.min(15, angle * 0.15));
                const bounce = Math.sin(frameCount.current * 0.3) * 3;
                img.style.transform = `rotate(${tilt}deg) scale(1.05) translateY(${bounce}px)`;
                glow.style.opacity = '0.5';
                glow.style.transform = 'scale(1.1)';
                label.textContent = '';
                label.style.opacity = '0';
                break;
            }
            case 'pointing':
                img.style.transform = 'rotate(0deg) scale(1.2)';
                glow.style.opacity = '1';
                glow.style.transform = 'scale(1.4)';
                label.textContent = '👉';
                label.style.opacity = '1';
                break;
            case 'clicking':
                img.style.transform = 'rotate(0deg) scale(0.85)';
                glow.style.opacity = '1';
                glow.style.transform = 'scale(0.8)';
                label.textContent = '👆';
                label.style.opacity = '1';
                break;
            case 'grabbing':
                img.style.transform = 'rotate(-8deg) scaleX(0.9) scaleY(1.1)';
                glow.style.opacity = '0.8';
                glow.style.transform = 'scale(1.2)';
                label.textContent = '✊';
                label.style.opacity = '1';
                break;
        }
    }, []);

    const setState = useCallback((newState: CursorState) => {
        if (stateRef.current === newState) return;
        prevStateRef.current = stateRef.current;
        stateRef.current = newState;
        applyState(newState);
    }, [applyState]);

    // Animation loop
    const tick = useCallback(() => {
        const mx = mousePos.current.x;
        const my = mousePos.current.y;
        const cx = currentPos.current.x;
        const cy = currentPos.current.y;

        // Lerp toward target
        const nx = cx + (mx - cx) * LERP_FACTOR;
        const ny = cy + (my - cy) * LERP_FACTOR;

        velocity.current.x = nx - cx;
        velocity.current.y = ny - cy;

        currentPos.current.x = nx;
        currentPos.current.y = ny;

        // Update DOM position via translate3d
        if (containerRef.current) {
            containerRef.current.style.transform =
                `translate3d(${nx - CURSOR_SIZE / 2}px, ${ny - CURSOR_SIZE / 2}px, 0)`;
        }

        // Update running tilt each frame if in running state
        if (stateRef.current === 'running') {
            frameCount.current++;
            applyState('running');
        }

        rafRef.current = requestAnimationFrame(tick);
    }, [applyState]);

    useEffect(() => {
        // Touch device detection — don't show custom cursor
        isTouchDevice.current = window.matchMedia('(pointer: coarse)').matches;
        if (isTouchDevice.current) return;

        // Start RAF loop
        rafRef.current = requestAnimationFrame(tick);

        // --- Event handlers ---

        const onMouseMove = (e: MouseEvent) => {
            mousePos.current.x = e.clientX;
            mousePos.current.y = e.clientY;

            // Clear idle timer
            if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
            }

            // Set running if not pointing/clicking/grabbing
            if (stateRef.current !== 'pointing' && stateRef.current !== 'clicking' && stateRef.current !== 'grabbing') {
                setState('running');
            }

            // Idle timeout
            idleTimerRef.current = setTimeout(() => {
                if (stateRef.current === 'running') {
                    setState('idle');
                }
            }, IDLE_TIMEOUT);
        };

        const onMouseOver = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest(CLICKABLE_SELECTOR)) {
                isHoveringClickable.current = true;
                if (stateRef.current !== 'clicking' && stateRef.current !== 'grabbing') {
                    setState('pointing');
                }
            }
        };

        const onMouseOut = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest(CLICKABLE_SELECTOR)) {
                isHoveringClickable.current = false;
                if (stateRef.current === 'pointing') {
                    setState('idle');
                }
            }
        };

        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest(DRAGGABLE_SELECTOR)) {
                setState('grabbing');
            } else {
                setState('clicking');
                if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                clickTimerRef.current = setTimeout(() => {
                    // Return to appropriate state
                    if (isHoveringClickable.current) {
                        setState('pointing');
                    } else {
                        setState('idle');
                    }
                }, CLICK_RESET_MS);
            }
        };

        const onMouseUp = () => {
            if (stateRef.current === 'grabbing') {
                if (isHoveringClickable.current) {
                    setState('pointing');
                } else {
                    setState('idle');
                }
            }
        };

        // Hide cursor when leaving viewport
        const onMouseLeave = () => {
            if (containerRef.current) {
                containerRef.current.style.opacity = '0';
            }
        };
        const onMouseEnter = () => {
            if (containerRef.current) {
                containerRef.current.style.opacity = '1';
            }
        };

        window.addEventListener('mousemove', onMouseMove, { passive: true });
        document.addEventListener('mouseover', onMouseOver, { passive: true });
        document.addEventListener('mouseout', onMouseOut, { passive: true });
        window.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mouseup', onMouseUp);
        document.documentElement.addEventListener('mouseleave', onMouseLeave);
        document.documentElement.addEventListener('mouseenter', onMouseEnter);

        return () => {
            cancelAnimationFrame(rafRef.current);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
            window.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseover', onMouseOver);
            document.removeEventListener('mouseout', onMouseOut);
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            document.documentElement.removeEventListener('mouseleave', onMouseLeave);
            document.documentElement.removeEventListener('mouseenter', onMouseEnter);
        };
    }, [tick, setState]);

    // Don't render on touch devices
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
        return null;
    }

    return (
        <div ref={containerRef} className="character-cursor cc-idle">
            {/* Glow trail */}
            <div ref={glowRef} className="cc-glow" />

            {/* Character avatar */}
            <img
                ref={imgRef}
                src={CursorImg}
                alt=""
                className="cc-avatar"
                draggable={false}
            />

            {/* State emoji label */}
            <div ref={labelRef} className="cc-label" />
        </div>
    );
};

export default CharacterCursor;
