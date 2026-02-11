import { useEffect, useCallback } from 'react';
import AntiGravityBackground from './components/AntiGravityBackground';
import Hero from './components/Hero';
import Projects from './components/Projects';
import ProjectSlider from './components/ProjectSlider';
import Experience from './components/Experience';
import Navbar from './components/Navbar';
import Contact from './components/Contact';
import CharacterCursor from './components/CharacterCursor';
import LoadingScreen from './components/LoadingScreen';
import AIAssistant from './components/AIAssistant';
import { LabModeProvider, useLabMode } from './components/LabModeContext';
import { PERSONAL_INFO } from './constants';

function AppContent() {
    const { labMode } = useLabMode();

    // Cursor spotlight — track mouse via CSS custom properties
    const handleMouseMove = useCallback((e: MouseEvent) => {
        document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
        document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    }, []);

    // Click ripple effect
    const handleClick = useCallback((e: MouseEvent) => {
        const ripple = document.createElement('div');
        ripple.className = 'click-ripple';
        ripple.style.left = `${e.clientX}px`;
        ripple.style.top = `${e.clientY}px`;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove, { passive: true });
        window.addEventListener('click', handleClick);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('click', handleClick);
        };
    }, [handleMouseMove, handleClick]);

    return (
        <div className="relative min-h-screen bg-void-black text-white overflow-x-hidden selection:bg-influence-red selection:text-white">
            <LoadingScreen />
            <CharacterCursor />

            {/* Cursor spotlight glow */}
            <div className="cursor-spotlight" />

            {/* Lab mode grid overlay */}
            <div className={`lab-grid-overlay ${labMode ? 'active' : ''}`} />

            <AntiGravityBackground />
            <Navbar />

            <main className="relative z-10">
                <Hero />
                <div id="projects">
                    <Projects />
                    <ProjectSlider />
                </div>
                <div id="experience">
                    <Experience />
                </div>
                <Contact />

                <footer className="py-12 border-t border-white/10 text-center bg-void-black">
                    <p className="font-oswald text-text-muted tracking-widest text-sm">
                        © {new Date().getFullYear()} {PERSONAL_INFO.name}. ALL RIGHTS RESERVED.
                    </p>
                </footer>
            </main>

            <AIAssistant />
        </div>
    );
}

function App() {
    return (
        <LabModeProvider>
            <AppContent />
        </LabModeProvider>
    );
}

export default App;
