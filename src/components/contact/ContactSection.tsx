'use client';

import { lazy, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import Image from 'next/image';
import { motion, useMotionValue, useScroll, useTransform, type MotionStyle } from 'framer-motion';
import { ArrowRight, Check, CircleAlert, Mail, Phone } from 'lucide-react';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { Reveal } from '@/components/motion';
import { BackgroundVideo } from '@/components/shared/BackgroundVideo';
import { Deferred3D } from '@/components/shared/Deferred3D';
import { GlassCard } from '@/components/shared/GlassCard';
import { LottieIcon, preloadLottie } from '@/components/shared/LottieIcon';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { Button, type ButtonStatus } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { LocalTime } from '@/components/ui/LocalTime';
import { SocialLinks } from '@/components/ui/SocialLinks';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useHydrated } from '@/hooks/useHydrated';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { track } from '@/lib/analytics';
import { emit, useAppEvent, type AppEvents } from '@/lib/events';
import { safeStorage } from '@/lib/safeStorage';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';

const ContactCanvas = lazy(() => import('./ContactCanvas'));

const ENDPOINT = `https://formsubmit.co/ajax/${process.env.NEXT_PUBLIC_FORMSUBMIT_ID || SITE.email}`;
const DRAFT_KEY = 'ob-contact-draft';
const SUBMIT_TIMEOUT_MS = 15_000;
const RESET_MS = 5_000;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Straight from the subtitle: "Open to research, full-time AI/ML roles, and ambitious freelance work."
const INTENTS = [
  { id: 'research', label: 'Research', subject: 'Research' },
  { id: 'fulltime', label: 'Full-time AI/ML role', subject: 'Full-time AI/ML role' },
  { id: 'freelance', label: 'Freelance work', subject: 'Freelance work' },
] as const;
type IntentId = (typeof INTENTS)[number]['id'];

type Fields = { name: string; email: string; message: string };
type FieldName = keyof Fields;
type Draft = Fields & { intent: IntentId | null; subject: string | null };
type Status = 'idle' | 'sending' | 'success' | 'error';
type Failure = 'offline' | 'network' | 'timeout' | 'server' | 'relay';

const EMPTY: Draft = { name: '', email: '', message: '', intent: null, subject: null };

const FAILURE_COPY: Record<Failure, string> = {
  offline: "You seem to be offline. Your draft is saved here, so send it when you're back, or email me directly.",
  network: "Couldn't reach the mail service. Check your connection and try again, or email me directly.",
  timeout: 'The mail service took too long to answer. Please try again, or email me directly.',
  server: 'The mail service is having trouble right now. Please try again in a moment, or email me directly.',
  relay: "The form couldn't deliver your message right now. Please email me directly; your draft is still here.",
};

function readDraft(): Draft {
  try {
    const raw = safeStorage.get(DRAFT_KEY);
    if (!raw) return EMPTY;
    const d = JSON.parse(raw) as Partial<Draft>;
    const intent = INTENTS.some((i) => i.id === d.intent) ? (d.intent as IntentId) : null;
    return {
      name: typeof d.name === 'string' ? d.name : '',
      email: typeof d.email === 'string' ? d.email : '',
      message: typeof d.message === 'string' ? d.message.slice(0, MESSAGE_MAX) : '',
      intent,
      subject: typeof d.subject === 'string' ? d.subject : null,
    };
  } catch {
    return EMPTY;
  }
}

const hasContent = (d: Draft) => Boolean(d.name.trim() || d.email.trim() || d.message.trim());

function validate(field: FieldName, value: string): string | null {
  const v = value.trim();
  if (field === 'name') return v ? null : 'Please add your name.';
  if (field === 'email') {
    if (!v) return 'Please add your email so I can reply.';
    return EMAIL_RE.test(v) ? null : 'That email looks incomplete, for example name@example.com.';
  }
  if (v.length < MESSAGE_MIN) return `Please write at least ${MESSAGE_MIN} characters.`;
  if (value.length > MESSAGE_MAX) return `Please keep it under ${MESSAGE_MAX.toLocaleString('en-US')} characters.`;
  return null;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  window.setTimeout(() => c.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  return c.signal;
}

function classify(err: unknown): Failure {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  return 'network';
}

function mailtoFor(d: Draft): string {
  const subject = d.subject ?? (d.intent ? `Portfolio inquiry: ${INTENTS.find((i) => i.id === d.intent)?.subject}` : 'Portfolio inquiry');
  const body = `${d.message.slice(0, 1600)}\n\n${d.name}${d.email ? ` <${d.email}>` : ''}`.trim();
  return `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const LABEL = 'font-mono text-[11px] uppercase leading-4 tracking-[0.2em] text-text-muted';
const FIELD =
  'w-full rounded-xl border border-glass-border-strong bg-glass-fill px-4 py-3 text-base text-text-primary ring-focus transition-colors placeholder:text-text-muted hover:border-violet-bright/50 focus:border-violet-bright aria-[invalid=true]:border-danger';

const SEND_ON_ACCENT = { dark: { '#22D3EE': '#FFFFFF' }, light: { '#22D3EE': '#FFFFFF' } };
const ERROR_ON_ACCENT = { light: { '#E2E8F0': '#FFFFFF' } };

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error: string | null;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        {hint}
      </div>
      <div className="mt-2">{children}</div>
      <p id={`${id}-error`} className={cn('text-sm leading-5 text-danger', error && 'mt-2')} data-field-error="">
        {error ? (
          <>
            <CircleAlert aria-hidden="true" className="mr-1.5 inline size-3.5 align-[-2px]" />
            {error}
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The contact form. Mounted twice: an empty one for the server render, then, once
 * hydrated, a fresh one that restores the saved draft, so no storage read ever
 * causes a hydration mismatch.
 */
function ContactForm({ restore }: { restore: boolean }) {
  const [initial] = useState<Draft>(() => (restore ? readDraft() : EMPTY));
  const [draft, setDraft] = useState<Draft>(initial);
  const [restored, setRestored] = useState(() => hasContent(initial));
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({ name: false, email: false, message: false });
  const [status, setStatus] = useState<Status>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);

  const ids = useId();
  const fieldId = (f: FieldName) => `${ids}-${f}`;
  const statusId = `${ids}-status`;
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fieldEl = (f: FieldName) => (f === 'name' ? nameRef : f === 'email' ? emailRef : messageRef).current;
  const saveTimer = useRef<number | undefined>(undefined);
  const resetTimer = useRef<number | undefined>(undefined);
  const typingSent = useRef(false);
  const honeyRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const errors: Record<FieldName, string | null> = {
    name: touched.name ? validate('name', draft.name) : null,
    email: touched.email ? validate('email', draft.email) : null,
    message: touched.message ? validate('message', draft.message) : null,
  };

  const persist = (next: Draft) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (hasContent(next)) safeStorage.set(DRAFT_KEY, JSON.stringify(next));
      else safeStorage.remove(DRAFT_KEY);
    }, 400);
  };

  const update = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    persist(next);
    if (status === 'error' || status === 'success') {
      window.clearTimeout(resetTimer.current);
      setStatus('idle');
      setFailure(null);
    }
    if (!typingSent.current) {
      typingSent.current = true;
      emit('contact:status', { status: 'typing' });
    }
  };

  const onField = (field: FieldName) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    update({ [field]: e.target.value } as Partial<Draft>);
  const onBlur = (field: FieldName) => () => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));

  const clearDraft = () => {
    safeStorage.remove(DRAFT_KEY);
    window.clearTimeout(saveTimer.current);
    setDraft(EMPTY);
    setTouched({ name: false, email: false, message: false });
    setRestored(false);
    nameRef.current?.focus();
  };

  const finish = (next: Status, why: Failure | null = null) => {
    setStatus(next);
    setFailure(why);
    emit('contact:status', { status: next });
    window.clearTimeout(resetTimer.current);
    if (next === 'success' || next === 'error') {
      // The button returns to 'Send message'; an error message and its mail link stay put.
      resetTimer.current = window.setTimeout(() => {
        setStatus((s) => (s === next ? 'idle' : s));
        if (next === 'success') emit('contact:status', { status: 'idle' });
      }, RESET_MS);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    if (honeyRef.current?.value) return;
    setTouched({ name: true, email: true, message: true });
    const first = (['name', 'email', 'message'] as const).find((f) => validate(f, draft[f]));
    if (first) {
      fieldEl(first)?.focus();
      return;
    }

    // Known offline: say so now. A request started offline can sit until the 15s timeout.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      finish('error', 'offline');
      track('contact_submit', { ok: false, reason: 'offline' });
      return;
    }
    preloadLottie('send');
    preloadLottie('error');
    finish('sending');
    const intent = INTENTS.find((i) => i.id === draft.intent);
    const topic = draft.subject ?? intent?.subject;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          email: draft.email.trim(),
          message: draft.message.trim(),
          _subject: topic ? `Portfolio inquiry: ${topic} (from ${draft.name.trim()})` : `Portfolio inquiry from ${draft.name.trim()}`,
          _template: 'table',
          _captcha: 'false',
        }),
        signal: timeoutSignal(SUBMIT_TIMEOUT_MS),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: unknown };
      if (!res.ok) throw Object.assign(new Error('http'), { failure: res.status >= 500 ? 'server' : 'relay' });
      // FormSubmit answers 200 with success "false" (for example before the inbox is activated).
      if (String(data.success) === 'false') throw Object.assign(new Error('relay'), { failure: 'relay' });

      safeStorage.remove(DRAFT_KEY);
      window.clearTimeout(saveTimer.current);
      setDraft(EMPTY);
      setTouched({ name: false, email: false, message: false });
      setRestored(false);
      typingSent.current = false;
      finish('success');
      track('contact_submit', { ok: true, intent: draft.intent ?? 'none' });
    } catch (err) {
      const why = (err as { failure?: Failure }).failure ?? classify(err);
      finish('error', why);
      track('contact_submit', { ok: false, reason: why });
    }
  };

  // AskMeBot (or anything else) can hand over a draft: fill it, bring the field into view, focus it.
  useAppEvent('contact:prefill', (d: AppEvents['contact:prefill']) => {
    const patch: Partial<Draft> = {};
    // Never clobber what the visitor already wrote: a handoff is appended below it.
    const current = draft.message.trim();
    if (d.message && !current.includes(d.message)) {
      patch.message = (current ? `${current}\n\n${d.message}` : d.message).slice(0, MESSAGE_MAX);
    }
    if (d.subject) patch.subject = d.subject;
    update(patch);
    const field = messageRef.current;
    if (!field) return;
    smoothScrollTo(field, { offset: -160, focus: false });
    requestAnimationFrame(() => {
      field.focus({ preventScroll: true });
      const end = field.value.length;
      field.setSelectionRange(end, end);
    });
  });

  const buttonStatus: ButtonStatus =
    status === 'sending' ? 'loading' : status === 'success' ? 'success' : status === 'error' ? 'error' : 'idle';
  const statusText =
    status === 'sending'
      ? 'Sending your message…'
      : status === 'success'
        ? 'Thanks, your message is on its way. I usually reply within a day.'
        : failure
          ? FAILURE_COPY[failure]
          : '';
  const length = draft.message.length;
  const describedBy = (f: FieldName, extra?: string) => [errors[f] ? `${fieldId(f)}-error` : null, extra].filter(Boolean).join(' ') || undefined;

  return (
    <form noValidate onSubmit={submit} className="space-y-6" data-contact-form="" aria-describedby={statusId}>
      <div role="group" aria-labelledby={`${ids}-intent`}>
        <p id={`${ids}-intent`} className={LABEL}>
          What is it about? <span className="normal-case tracking-normal">(optional)</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {INTENTS.map((intent) => {
            const on = draft.intent === intent.id;
            return (
              <button
                key={intent.id}
                type="button"
                aria-pressed={on}
                data-intent={intent.id}
                onClick={() => update({ intent: on ? null : intent.id })}
                className={cn(
                  'tap-safe gap-2 rounded-full border px-4 text-sm ring-focus transition-colors',
                  on
                    ? 'border-violet-bright bg-violet text-white'
                    : 'border-glass-border bg-glass-fill text-text-secondary hover:border-glass-border-strong hover:text-text-primary',
                )}
              >
                {on ? <Check aria-hidden="true" className="size-3.5" /> : null}
                {intent.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-x-4 gap-y-2 md:grid-cols-2">
        <Field id={fieldId('name')} label="Name" error={errors.name}>
          <input
            ref={nameRef}
            id={fieldId('name')}
            name="name"
            type="text"
            autoComplete="name"
            required
            value={draft.name}
            onChange={onField('name')}
            onBlur={onBlur('name')}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy('name')}
            className={FIELD}
          />
        </Field>
        <Field id={fieldId('email')} label="Email" error={errors.email}>
          <input
            ref={emailRef}
            id={fieldId('email')}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            required
            value={draft.email}
            onChange={onField('email')}
            onBlur={onBlur('email')}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy('email')}
            className={FIELD}
          />
        </Field>
      </div>

      <Field
        id={fieldId('message')}
        label="Message"
        error={errors.message}
        hint={
          <span
            id={`${fieldId('message')}-count`}
            className={cn('font-mono text-xs tabular-nums', length > MESSAGE_MAX ? 'text-danger' : 'text-text-muted')}
            data-char-count=""
          >
            {length.toLocaleString('en-US')} / {MESSAGE_MAX.toLocaleString('en-US')}
          </span>
        }
      >
        <textarea
          ref={messageRef}
          id={fieldId('message')}
          name="message"
          required
          rows={5}
          minLength={MESSAGE_MIN}
          maxLength={MESSAGE_MAX + 200}
          value={draft.message}
          onChange={onField('message')}
          onBlur={onBlur('message')}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={describedBy('message', `${fieldId('message')}-count`)}
          placeholder="Tell me about the project…"
          className={cn(FIELD, 'min-h-36 resize-y')}
        />
      </Field>

      {/* Spam trap: people never see or reach it; bots that fill every field do. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto size-px overflow-hidden">
        <label>
          Leave this empty
          <input ref={honeyRef} type="text" name="_honey" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {restored ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm leading-6 text-text-muted" data-draft-restored="">
          <span>Draft restored</span>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={clearDraft} className="tap-safe-sm rounded-md px-1 text-text-secondary underline underline-offset-4 ring-focus hover:text-text-primary">
            Clear
          </button>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button
          type="submit"
          size="lg"
          status={buttonStatus}
          loadingLabel="Sending…"
          successLabel="Sent"
          errorLabel="Not sent"
          trailingIcon={<ArrowRight aria-hidden="true" className="size-4" />}
          statusIcons={{
            success: (
              <LottieIcon
                name="send"
                play="once"
                loop={false}
                lazy={false}
                colors={SEND_ON_ACCENT}
                className="-my-1 block size-6 shrink-0"
                fallback={<Check aria-hidden="true" className="size-4" />}
              />
            ),
            error: (
              <LottieIcon
                name="error"
                play="once"
                loop={false}
                lazy={false}
                colors={ERROR_ON_ACCENT}
                className="-my-1 block size-6 shrink-0"
                fallback={<CircleAlert aria-hidden="true" className="size-4" />}
              />
            ),
          }}
          data-contact-submit=""
        >
          Send message
        </Button>
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          data-contact-status={status}
          className={cn(
            'min-w-0 flex-1 basis-56 text-sm leading-6',
            status === 'success' ? 'text-success' : status === 'error' || failure ? 'text-danger' : 'text-text-muted',
          )}
        >
          {statusText}
        </p>
      </div>

      {failure ? (
        <p className="text-sm leading-6 text-text-secondary">
          <a
            href={mailtoFor(draft)}
            className="tap-safe-sm inline-flex gap-1.5 rounded-md font-medium text-text-primary underline underline-offset-4 ring-focus"
            data-mailto-fallback=""
          >
            <Mail aria-hidden="true" className="size-4" />
            Email me this message instead
          </a>
        </p>
      ) : null}
    </form>
  );
}

function ContactRow({
  icon,
  label,
  value,
  href,
  copyLabel,
  toastMessage,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  href: string;
  copyLabel: string;
  toastMessage?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <a
        href={href}
        className="group/row flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl pr-2 text-text-secondary ring-focus transition-colors hover:text-text-primary"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-glass-border bg-surface-tint text-violet-bright transition-colors group-hover/row:border-glass-border-strong">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="sr-only">{label}: </span>
          <span className="block truncate text-sm">{value}</span>
        </span>
      </a>
      <CopyButton value={value} label={copyLabel} toastMessage={toastMessage} iconOnly size="md" variant="ghost" />
    </div>
  );
}

/** Poster for the 3D column: always there under reduced motion, on opt-out devices and while the model loads. */
function Poster({ onError }: { onError: () => void }) {
  return (
    <div className="relative size-full overflow-clip rounded-3xl border border-glass-border">
      <Image
        src="/images/contact-bg.webp"
        alt=""
        fill
        sizes="(min-width: 1024px) 40vw, 1px"
        className="object-cover object-[70%_50%]"
        onError={onError}
      />
    </div>
  );
}

/**
 * Contact: a validated, draft-saving form that posts to FormSubmit, direct email
 * and phone with copy buttons, the profile links and local time, and the 3D
 * envelope (poster fallback) beside it on desktop. On desktop, scrolling into the
 * section draws a conic border around the form card and eases the heading up;
 * that is the section's one scroll-linked effect, and it is static on lite
 * devices and under reduced motion.
 */
export function ContactSection() {
  const hydrated = useHydrated();
  const { reduce, lite } = useMotionPrefs();
  const scrub = !reduce && !lite;
  const [posterFailed, setPosterFailed] = useState(false);
  const [fallbackFinal, setFallbackFinal] = useState(false);
  const scrubRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({ target: scrubRef, offset: ['start end', 'center center'] });
  // Always bound, but flattened when the scrub is off, so a lite or reduced visit
  // never keeps an inline transform or sweep left over from the hydration render.
  const scrubOn = useMotionValue(1);
  useEffect(() => {
    scrubOn.set(scrub ? 1 : 0);
  }, [scrub, scrubOn]);
  const headingY = useTransform(() => scrubOn.get() * (1 - scrollYProgress.get()) * 32);
  const sweep = useTransform(() =>
    scrubOn.get() ? `${Math.round(Math.min(1, Math.max(0, (scrollYProgress.get() - 0.2) / 0.8)) * 360)}deg` : '360deg',
  );

  // With neither the model nor its poster to show, the form takes the whole row.
  const visual = !(posterFailed && fallbackFinal);

  return (
    <SectionWrapper id="contact">
      <BackgroundVideo
        variant="dark"
        src="/videos/contact-bg.mp4"
        poster="/images/contact-bg.webp"
        className="dark-only pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-25"
      />
      <div
        className="light-only pointer-events-none absolute inset-0 -z-10 overflow-clip"
        style={{
          maskImage: 'radial-gradient(ellipse 85% 75% at 50% 50%, #000 35%, rgb(0 0 0 / 0.35) 70%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 85% 75% at 50% 50%, #000 35%, rgb(0 0 0 / 0.35) 70%, transparent 100%)',
        }}
      >
        <BackgroundVideo
          variant="light"
          src="/videos/contact-bg-light.mp4"
          className="h-full w-full object-cover opacity-40"
          style={{ filter: 'saturate(0.75) brightness(1.02)' }}
        />
      </div>
      <div className="light-only pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-bg-base/50 via-transparent to-bg-base/70" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-bg-base/60 via-transparent to-bg-base" />

      <div ref={scrubRef}>
        <motion.div style={{ y: headingY }}>
          <SectionHeading
            sectionId="contact"
            title="Let's build *something*."
            subtitle="Open to research, full-time AI/ML roles, and ambitious freelance work. I usually reply within a day."
          />
        </motion.div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          {visual ? (
            <Reveal className="relative hidden lg:col-span-2 lg:block">
              <div aria-hidden="true" className="dark-only pointer-events-none absolute -inset-4 rounded-[2rem] bg-violet-bright/10 blur-3xl" />
              <div aria-hidden="true" className="dark-only pointer-events-none absolute -inset-8 rounded-[2rem] bg-cyan-bright/5 blur-3xl" />
              <Deferred3D
                id="contact"
                rootMargin="400px"
                className="relative h-full min-h-[480px]"
                onFallback={() => setFallbackFinal(true)}
                fallback={<Poster onError={() => setPosterFailed(true)} />}
              >
                <ContactCanvas />
              </Deferred3D>
            </Reveal>
          ) : null}

          <Reveal delay={0.1} className={visual ? 'lg:col-span-3' : 'lg:col-span-5'}>
            <div className="relative rounded-[1.25rem]">
              <GlassCard strong className="p-6 sm:p-8 md:p-10">
                <ContactForm key={hydrated ? 'client' : 'server'} restore={hydrated} />

                <div className="mt-10 border-t border-hairline pt-8">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ContactRow
                      icon={<Mail aria-hidden="true" className="size-4" />}
                      label="Email"
                      value={SITE.email}
                      href={SITE.mailtoHref}
                      copyLabel="Copy email address"
                      toastMessage="Email address copied"
                    />
                    <ContactRow
                      icon={<Phone aria-hidden="true" className="size-4" />}
                      label="Phone"
                      value={SITE.phone}
                      href={SITE.phoneHref}
                      copyLabel="Copy phone number"
                      toastMessage="Phone number copied"
                    />
                  </div>
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                    <SocialLinks include={['github', 'linkedin', 'leetcode', 'email']} />
                    <LocalTime showOffset />
                  </div>
                </div>
              </GlassCard>
              <motion.span
                aria-hidden="true"
                data-contact-border=""
                data-static={scrub ? undefined : ''}
                className="contact-border"
                style={{ '--contact-sweep': sweep } as MotionStyle}
              />
            </div>
          </Reveal>
        </div>
      </div>
    </SectionWrapper>
  );
}
