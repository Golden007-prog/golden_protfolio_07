import { CountUp } from '@/components/motion';
import { GlassCard } from '@/components/shared/GlassCard';

type Props = { value: number; suffix?: string; label: string };

/**
 * One number counted from the data files. CountUp puts the final value in the
 * server HTML and in its sr-only copy, so crawlers, no-JS visitors and screen
 * readers never see a placeholder.
 */
export function StatCard({ value, suffix = '', label }: Props) {
  return (
    <GlassCard strong interactive className="h-full p-5 md:p-7">
      <p className="font-display text-5xl font-black leading-none md:text-6xl">
        <CountUp
          value={value}
          suffix={suffix}
          className="bg-gradient-to-r from-violet-bright to-cyan-bright bg-clip-text text-transparent"
        />
      </p>
      <p
        data-stat-label=""
        className="mt-4 font-mono text-[11px] font-medium uppercase leading-snug tracking-[0.14em] text-text-secondary [overflow-wrap:anywhere]"
      >
        {label}
      </p>
    </GlassCard>
  );
}
