import { useState, Suspense, lazy, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Github, Linkedin, Mail, Phone, ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { SectionWrapper } from '../layout/SectionWrapper';
import { SectionHeading } from '../shared/SectionHeading';
import { ScrollReveal } from '../shared/ScrollReveal';
import { GlassCard } from '../shared/GlassCard';
import profile from '../../data/profile.json';

const ContactCanvas = lazy(() => import('./ContactCanvas').then((m) => ({ default: m.ContactCanvas })));

const fieldVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

type Status = 'idle' | 'sending' | 'success' | 'error';

const FORMSUBMIT_ENDPOINT = `https://formsubmit.co/ajax/${profile.email}`;

export function ContactSection() {
  const base = import.meta.env.BASE_URL;
  const [form, setForm] = useState({ name: '', email: '', message: '', _honey: '' });
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form._honey) return;
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setStatus('error');
      setErrorMsg('Please fill in every field.');
      return;
    }

    setStatus('sending');
    setErrorMsg('');

    try {
      const res = await fetch(FORMSUBMIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          message: form.message,
          _subject: `Portfolio inquiry from ${form.name}`,
          _template: 'table',
          _captcha: 'false',
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === 'false') {
        throw new Error(data?.message || 'Submission failed');
      }

      setStatus('success');
      setForm({ name: '', email: '', message: '', _honey: '' });
    } catch (err) {
      setStatus('error');
      setErrorMsg(
        err instanceof Error && err.message !== 'Submission failed'
          ? err.message
          : 'Could not send. Try the mail link below, or retry in a moment.',
      );
    }
  };

  const openMailto = () => {
    const body = encodeURIComponent(`From: ${form.name} <${form.email}>\n\n${form.message}`);
    window.location.href = `mailto:${profile.email}?subject=Portfolio%20inquiry&body=${body}`;
  };

  return (
    <SectionWrapper id="contact">
      <video
        autoPlay muted loop playsInline preload="metadata"
        poster={`${base}images/contact-bg.webp`}
        aria-hidden="true"
        className="absolute inset-0 -z-10 w-full h-full object-cover opacity-25 pointer-events-none dark-only"
      >
        <source src={`${base}videos/contact-bg.mp4`} type="video/mp4" />
      </video>
      <div
        className="absolute inset-0 -z-10 pointer-events-none light-only overflow-hidden"
        style={{
          maskImage:
            'radial-gradient(ellipse 85% 75% at 50% 50%, black 35%, rgba(0,0,0,0.35) 70%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 85% 75% at 50% 50%, black 35%, rgba(0,0,0,0.35) 70%, transparent 100%)',
        }}
      >
        <video
          autoPlay muted loop playsInline preload="metadata"
          aria-hidden="true"
          className="w-full h-full object-cover opacity-40"
          style={{ filter: 'saturate(0.75) brightness(1.02)' }}
        >
          <source src={`${base}videos/contact-bg-light.mp4`} type="video/mp4" />
        </video>
      </div>
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-bg-base/50 via-transparent to-bg-base/70 pointer-events-none light-only" />
      <div
        className="absolute inset-0 -z-10 opacity-35 pointer-events-none mix-blend-screen dark-only"
        style={{ backgroundImage: `url(${base}images/contact-bg.webp)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-bg-base/60 via-transparent to-bg-base pointer-events-none" />
      <SectionHeading
        kicker="05 / Contact"
        title="Let's build *something*."
        subtitle="Open to research, full-time AI/ML roles, and ambitious freelance work. I usually reply within a day."
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <ScrollReveal className="lg:col-span-2 relative flex items-center justify-center min-h-[320px] lg:min-h-[480px]">
          <div className="absolute -inset-4 bg-violet-bright/10 rounded-[2rem] blur-3xl pointer-events-none dark-only" />
          <div className="absolute -inset-8 bg-cyan-bright/5 rounded-[2rem] blur-3xl pointer-events-none dark-only" />
          <div className="relative w-full h-full">
            <Suspense fallback={<div className="w-full h-full glass animate-pulse rounded-3xl" />}>
              <ContactCanvas />
            </Suspense>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.2} className="lg:col-span-3">
          <GlassCard strong className="p-8 md:p-10">
            <motion.form
              onSubmit={onSubmit}
              className="space-y-5"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '0px 0px -10% 0px' }}
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
              }}
            >
              <motion.div className="grid md:grid-cols-2 gap-4" variants={fieldVariants}>
                <Field
                  label="Name"
                  id="name"
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                />
                <Field
                  label="Email"
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(v) => setForm({ ...form, email: v })}
                />
              </motion.div>
              <motion.div variants={fieldVariants}>
                <label htmlFor="message" className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-dim">
                  Message
                </label>
                <textarea
                  id="message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="mt-2 w-full bg-glass-fill border border-glass-border-strong rounded-xl px-4 py-3 text-text-primary placeholder-text-dim focus:outline-none focus:border-violet-bright focus:ring-2 focus:ring-violet-bright/20 transition-all resize-none"
                  placeholder="Tell me about the project…"
                />
              </motion.div>

              <input
                type="text"
                name="_honey"
                tabIndex={-1}
                autoComplete="off"
                value={form._honey}
                onChange={(e) => setForm({ ...form, _honey: e.target.value })}
                className="absolute left-[-9999px] opacity-0 pointer-events-none"
                aria-hidden="true"
              />

              <motion.div variants={fieldVariants} className="flex flex-wrap items-center gap-4">
                <motion.button
                  type="submit"
                  disabled={status === 'sending'}
                  whileHover={status === 'sending' ? undefined : { scale: 1.03 }}
                  whileTap={status === 'sending' ? undefined : { scale: 0.98 }}
                  className="group inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet to-violet-bright text-white font-medium hover:from-violet-bright hover:to-cyan-bright transition-all hover:glow-violet disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {status === 'sending' ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Sending…
                    </>
                  ) : status === 'success' ? (
                    <>
                      <CheckCircle2 size={16} />
                      Sent
                    </>
                  ) : (
                    <>
                      Send message
                      <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </motion.button>

                <AnimatePresence mode="wait">
                  {status === 'success' && (
                    <motion.p
                      key="ok"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-sm text-emerald-400 flex items-center gap-2"
                    >
                      <CheckCircle2 size={14} />
                      Thanks — I'll reply within a day.
                    </motion.p>
                  )}
                  {status === 'error' && (
                    <motion.div
                      key="err"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-sm text-rose-400 flex items-center gap-2 flex-wrap"
                    >
                      <AlertTriangle size={14} />
                      <span>{errorMsg}</span>
                      <button
                        type="button"
                        onClick={openMailto}
                        className="underline text-rose-300 hover:text-rose-200"
                      >
                        Email me directly
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.form>

            <div className="mt-10 pt-8 border-t border-glass-border grid sm:grid-cols-2 gap-5">
              <DirectLink icon={<Mail size={14} />} label={profile.email} href={`mailto:${profile.email}`} />
              <DirectLink icon={<Phone size={14} />} label={profile.phone} href={`tel:${profile.phone}`} />
            </div>

            <div className="mt-6 flex items-center gap-3">
              <SocialBtn href={profile.links.github} icon={<Github size={16} />} />
              <SocialBtn href={profile.links.linkedin} icon={<Linkedin size={16} />} />
            </div>
          </GlassCard>
        </ScrollReveal>
      </div>
    </SectionWrapper>
  );
}

function Field({ label, id, type = 'text', value, onChange }: { label: string; id: string; type?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-dim">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full bg-glass-fill border border-glass-border-strong rounded-xl px-4 py-3 text-text-primary placeholder-text-dim focus:outline-none focus:border-violet-bright focus:ring-2 focus:ring-violet-bright/20 transition-all"
      />
    </div>
  );
}

function DirectLink({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <a href={href} className="flex items-center gap-3 text-text-secondary hover:text-violet-bright transition-colors group">
      <span className="p-2 rounded-lg glass group-hover:border-violet-bright/60 transition-colors">{icon}</span>
      <span className="text-sm">{label}</span>
    </a>
  );
}

function SocialBtn({ href, icon }: { href: string; icon: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="p-3 rounded-full glass hover:border-violet-bright/60 hover:glow-violet text-text-secondary hover:text-text-primary transition-all"
    >
      {icon}
    </a>
  );
}
