import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Send, Sparkles } from 'lucide-react';
import { AI_RESPONSES } from '../constants';

interface Message {
    id: number;
    text: string;
    isBot: boolean;
}

const AIAssistant: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Send greeting on first open
    useEffect(() => {
        if (isOpen && messages.length === 0) {
            setIsTyping(true);
            setTimeout(() => {
                setMessages([{ id: 1, text: AI_RESPONSES.greeting, isBot: true }]);
                setIsTyping(false);
            }, 800);
        }
    }, [isOpen, messages.length]);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen]);

    const getResponse = useCallback((text: string): string => {
        const lower = text.toLowerCase();

        if (lower.includes('project') || lower.includes('work') || lower.includes('portfolio')) {
            return AI_RESPONSES.projects;
        }
        if (lower.includes('skill') || lower.includes('tech') || lower.includes('stack') || lower.includes('language')) {
            return AI_RESPONSES.skills;
        }
        if (lower.includes('summar') || lower.includes('recruit') || lower.includes('hire') || lower.includes('about')) {
            return AI_RESPONSES.summary;
        }
        if (lower.includes('experience') || lower.includes('job') || lower.includes('work history') || lower.includes('company')) {
            return AI_RESPONSES.experience;
        }
        if (lower.includes('educat') || lower.includes('degree') || lower.includes('university') || lower.includes('school')) {
            return AI_RESPONSES.education;
        }
        if (lower.includes('scroll') || lower.includes('show') || lower.includes('go to')) {
            // Scroll to projects
            const el = document.getElementById('projects');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
            return "Scrolling you to the projects section! 🔽";
        }
        if (lower.includes('hi') || lower.includes('hello') || lower.includes('hey')) {
            return AI_RESPONSES.greeting;
        }
        return AI_RESPONSES.fallback;
    }, []);

    const handleSend = useCallback(() => {
        if (!input.trim()) return;

        const userMsg: Message = { id: Date.now(), text: input.trim(), isBot: false };
        setMessages(prev => [...prev, userMsg]);
        setInput('');

        setIsTyping(true);
        const delay = 600 + Math.random() * 800;
        setTimeout(() => {
            const response = getResponse(userMsg.text);
            setMessages(prev => [...prev, { id: Date.now() + 1, text: response, isBot: true }]);
            setIsTyping(false);
        }, delay);
    }, [input, getResponse]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSend();
    }, [handleSend]);

    const quickActions = [
        { label: "Projects", query: "Tell me about projects" },
        { label: "Skills", query: "What are your skills?" },
        { label: "Summarize", query: "Summarize for recruiters" },
    ];

    return (
        <>
            {/* Floating Button */}
            <motion.button
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 3, type: 'spring', stiffness: 300 }}
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed bottom-6 right-6 z-[900] w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
                    isOpen
                        ? 'bg-white/10 border border-white/20 backdrop-blur-md'
                        : 'bg-influence-red hover:bg-influence-red/80 border border-influence-red/50'
                }`}
            >
                {isOpen ? (
                    <X className="w-5 h-5 text-white" />
                ) : (
                    <>
                        <Bot className="w-6 h-6 text-white" />
                        {/* Pulse ring */}
                        <span className="absolute inset-0 rounded-full border-2 border-influence-red animate-ping opacity-30" />
                    </>
                )}
            </motion.button>

            {/* Chat Panel */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className="fixed bottom-24 right-6 z-[900] w-80 md:w-96 max-h-[70vh] bg-card-dark/95 border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col overflow-hidden shadow-2xl"
                    >
                        {/* Header */}
                        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-influence-red/20 flex items-center justify-center">
                                <Sparkles className="w-4 h-4 text-influence-red" />
                            </div>
                            <div>
                                <h4 className="text-sm font-oswald tracking-wider text-white uppercase">AI Assistant</h4>
                                <p className="text-[10px] text-text-muted font-mono">Ask me anything about Oikantik</p>
                            </div>
                            <div className="ml-auto w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[400px]">
                            {messages.map((msg) => (
                                <motion.div
                                    key={msg.id}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`flex ${msg.isBot ? 'justify-start' : 'justify-end'}`}
                                >
                                    <div
                                        className={`max-w-[85%] px-3 py-2 rounded-xl text-sm font-inter leading-relaxed ${
                                            msg.isBot
                                                ? 'bg-white/5 text-text-muted border border-white/5'
                                                : 'bg-influence-red/20 text-white border border-influence-red/20'
                                        }`}
                                        style={{ whiteSpace: 'pre-wrap' }}
                                    >
                                        {msg.text}
                                    </div>
                                </motion.div>
                            ))}

                            {/* Typing indicator */}
                            {isTyping && (
                                <div className="flex justify-start">
                                    <div className="bg-white/5 border border-white/5 px-4 py-2 rounded-xl flex gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Quick Actions */}
                        {messages.length <= 1 && (
                            <div className="px-4 pb-2 flex gap-2 flex-wrap">
                                {quickActions.map((action) => (
                                    <button
                                        key={action.label}
                                        onClick={() => {
                                            setInput(action.query);
                                            setTimeout(() => {
                                                const userMsg: Message = { id: Date.now(), text: action.query, isBot: false };
                                                setMessages(prev => [...prev, userMsg]);
                                                setIsTyping(true);
                                                setTimeout(() => {
                                                    const response = getResponse(action.query);
                                                    setMessages(prev => [...prev, { id: Date.now() + 1, text: response, isBot: true }]);
                                                    setIsTyping(false);
                                                    setInput('');
                                                }, 800);
                                            }, 100);
                                        }}
                                        className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[11px] font-oswald tracking-wider text-text-muted hover:text-white hover:border-influence-red transition-all"
                                    >
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Input */}
                        <div className="px-3 py-3 border-t border-white/10 flex gap-2">
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Ask about projects, skills..."
                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-inter placeholder-text-muted/50 focus:outline-none focus:border-influence-red/50 transition-colors"
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim()}
                                className="px-3 py-2 bg-influence-red/20 border border-influence-red/30 rounded-lg hover:bg-influence-red/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <Send className="w-4 h-4 text-influence-red" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

export default AIAssistant;
