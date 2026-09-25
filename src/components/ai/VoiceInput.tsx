'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { useHydrated } from '@/hooks/useHydrated';
import { track } from '@/lib/analytics';
import { cn } from '@/utils/cn';

/* The Web Speech API is not in TypeScript's DOM lib; this is the slice used here. */
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = Event & { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = Event & { error: string };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Backstop: stop when nothing new has been heard for this long. */
const SILENCE_MS = 6000;

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked for this site.',
  'service-not-allowed': 'Voice input is not available in this browser.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice input needs a connection to the speech service.',
  'no-speech': "Didn't catch that. Try again, or type instead.",
};

type Props = {
  /** Each final phrase. Append it to the field; it is never sent on its own. */
  onText: (text: string) => void;
  /** The phrase being heard, before it is final. */
  onInterim?: (text: string) => void;
  /** BCP 47 tag for recognition; defaults to the browser language. */
  lang?: string;
  className?: string;
};

/**
 * Dictation for a text field. Starts only on click, shows what it hears as it
 * hears it, announces 'Listening…' and stops on Stop or after a silence. Not
 * rendered at all where the browser has no speech recognition. The tooltip says
 * where the audio goes: Chrome sends it to Google to transcribe.
 */
export function VoiceInput({ onText, onInterim, lang, className }: Props) {
  const hydrated = useHydrated();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const silence = useRef(0);
  const handlers = useRef({ onText, onInterim });
  useEffect(() => {
    handlers.current = { onText, onInterim };
  });

  useEffect(
    () => () => {
      window.clearTimeout(silence.current);
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.onresult = rec.onerror = rec.onend = null;
        rec.abort();
      }
    },
    [],
  );

  const Ctor = hydrated ? recognitionCtor() : null;
  if (!Ctor) return null;

  const armSilence = () => {
    window.clearTimeout(silence.current);
    silence.current = window.setTimeout(() => recRef.current?.stop(), SILENCE_MS);
  };

  const start = () => {
    setError(null);
    setInterim('');
    let rec: Recognition;
    try {
      rec = new Ctor();
    } catch {
      setError(ERRORS['service-not-allowed'] ?? null);
      return;
    }
    rec.lang = lang ?? (navigator.language || 'en-IN');
    rec.interimResults = true;
    // One utterance per click: the browser ends it at the first pause, which is
    // the 'stops after silence' behaviour and avoids Android's continuous-mode repeats.
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let finalText = '';
      let heard = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) finalText += r[0].transcript;
        else heard += r[0].transcript;
      }
      setInterim(heard);
      handlers.current.onInterim?.(heard);
      const phrase = finalText.trim();
      if (phrase) handlers.current.onText(phrase);
      armSilence();
    };
    rec.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? 'Voice input stopped.');
    };
    rec.onend = () => {
      window.clearTimeout(silence.current);
      if (recRef.current === rec) recRef.current = null;
      setListening(false);
      setInterim('');
      handlers.current.onInterim?.('');
    };
    try {
      rec.start();
    } catch {
      setError('Voice input is busy. Try again in a moment.');
      return;
    }
    recRef.current = rec;
    setListening(true);
    armSilence();
    track('ai_voice');
  };

  const stop = () => recRef.current?.stop();

  const button = (
    <Button
      variant="icon"
      aria-label={listening ? 'Stop voice input' : 'Voice input'}
      data-ai-voice={listening ? 'listening' : 'idle'}
      onClick={listening ? stop : start}
      className={cn(listening && 'border-violet-bright text-text-primary')}
    >
      {listening ? <Square aria-hidden="true" className="size-3.5 fill-current" /> : <Mic aria-hidden="true" className="size-4" />}
    </Button>
  );

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {/* Always wrapped, so starting doesn't remount the button and drop keyboard focus. */}
      <Tooltip
        disabled={listening}
        content="Dictate with your browser's speech recognition. In Chrome, the audio is sent to Google to be transcribed."
      >
        {button}
      </Tooltip>
      {listening ? (
        <span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-text-muted" aria-hidden="true">
          <span className="text-violet-bright">
            <LottieIcon
              name="wave"
              play="auto"
              loop
              lazy={false}
              className="block h-4 w-8"
              fallback={
                <span className="ai-wave">
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
              }
            />
          </span>
          <span className="min-w-0 truncate italic">{interim || 'Listening…'}</span>
        </span>
      ) : error ? (
        <span className="min-w-0 text-[13px] text-text-muted">{error}</span>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {listening ? 'Listening…' : (error ?? '')}
      </span>
    </span>
  );
}
