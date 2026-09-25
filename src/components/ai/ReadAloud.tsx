'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useHydrated } from '@/hooks/useHydrated';
import { track } from '@/lib/analytics';
import { cn } from '@/utils/cn';

/** Markdown and citation markers out, so the voice reads prose, not syntax. */
export function speakable(text: string): string {
  return text
    .replace(/\[c:[^\]]*\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

// Chrome cuts off a long utterance mid-sentence, so very long sentences split at clause breaks.
const MAX_SENTENCE = 220;

export function sentencesOf(text: string, lang = 'en'): string[] {
  let out: string[];
  const Seg = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined;
  if (Seg) {
    out = Array.from(new Seg(lang, { granularity: 'sentence' }).segment(text), (s) => s.segment.trim());
  } else {
    out = text.split(/(?<=[.!?।])\s+/).map((s) => s.trim());
  }
  return out
    .filter(Boolean)
    .flatMap((s) => (s.length <= MAX_SENTENCE ? [s] : s.split(/(?<=[,;:])\s+/).filter(Boolean)));
}

/** A voice for the language, on-device where there is one: Indian English by default. */
function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const want = lang.toLowerCase();
  const base = want.split('-')[0] ?? want;
  const exact = voices.filter((v) => v.lang.toLowerCase().replace('_', '-') === want);
  const family = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const pool = exact.length ? exact : family;
  return pool.find((v) => v.localService) ?? pool[0];
}

type Props = {
  text: string;
  /** BCP 47 tag of the text. Default en-IN. */
  lang?: string;
  /** Button label (default 'Listen'). */
  label?: string;
  /** Called as each sentence starts (-1 when reading ends), to highlight it in the caller's own text. */
  onSentence?: (index: number, sentence: string) => void;
  /** Show the sentence being read under the button (default true). */
  caption?: boolean;
  className?: string;
};

/**
 * Reads text aloud with the browser's speech synthesis, one sentence at a time,
 * highlighting the sentence being spoken. Starts only from a click; stops on
 * Stop, on unmount and on a route change. Not rendered where speech synthesis
 * is missing.
 */
export function ReadAloud({ text, lang = 'en-IN', label = 'Listen', onSentence, caption = true, className }: Props) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const [index, setIndex] = useState(-1);
  const playing = index >= 0;
  const sentences = useMemo(() => sentencesOf(speakable(text), lang), [text, lang]);
  // Each play() is a session; utterance callbacks from an older one (cancelled by
  // a new play, Stop or another reader) are ignored. 0 = nothing speaking.
  const session = useRef(0);
  const active = useRef(0);
  const onSentenceRef = useRef(onSentence);
  useEffect(() => {
    onSentenceRef.current = onSentence;
  });

  const finish = useCallback((id: number) => {
    if (active.current !== id) return;
    active.current = 0;
    setIndex(-1);
    onSentenceRef.current?.(-1, '');
  }, []);

  // Unmounting, or moving to another page, cancels this component's speech.
  useEffect(
    () => () => {
      const id = active.current;
      if (!id) return;
      window.speechSynthesis?.cancel();
      finish(id);
    },
    [pathname, finish],
  );

  const supported = hydrated && typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  if (!supported || sentences.length === 0) return null;

  const stop = () => {
    const id = active.current;
    window.speechSynthesis.cancel();
    finish(id);
  };

  const play = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    session.current += 1;
    const id = session.current;
    active.current = id;
    const voice = pickVoice(synth.getVoices(), lang);
    sentences.forEach((sentence, i) => {
      const u = new SpeechSynthesisUtterance(sentence);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice;
      u.onstart = () => {
        if (active.current !== id) return;
        setIndex(i);
        onSentenceRef.current?.(i, sentence);
      };
      // 'interrupted' and 'canceled' land here too: another reader took over.
      u.onerror = () => finish(id);
      if (i === sentences.length - 1) u.onend = () => finish(id);
      synth.speak(u);
    });
    setIndex(0);
    track('ai_read_aloud');
  };

  return (
    <div className={cn('min-w-0', className)} data-ai-read={playing ? 'playing' : 'idle'}>
      <Button
        variant="secondary"
        size="md"
        onClick={playing ? stop : play}
        leadingIcon={
          playing ? <Square aria-hidden="true" className="size-3.5 shrink-0 fill-current" /> : <Volume2 aria-hidden="true" className="size-4 shrink-0" />
        }
      >
        {playing ? 'Stop' : label}
      </Button>
      {caption && playing ? (
        <p className="mt-2 text-sm leading-relaxed text-text-secondary" aria-hidden="true" lang={lang} data-read-index={index}>
          <mark className="ai-read-mark">{sentences[index]}</mark>
        </p>
      ) : null}
    </div>
  );
}
