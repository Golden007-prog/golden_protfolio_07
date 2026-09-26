import { Check } from 'lucide-react';
import { COREFORGE_BUILT_WITH, COREFORGE_GENERATOR_CHECKS } from '@/lib/coreforge/facts';
import { BUILT_WITH_COPY } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';

type Props = {
  headingLevel?: 'h2' | 'h3';
  /** Hide the title when the caller already has one (the venture page). */
  hideTitle?: boolean;
  className?: string;
};

/**
 * The engineering story: Core tasks are generated, and each generator proves its task
 * before serving it. Every sentence is from goldensdmat.in or his launch post.
 */
export function BuiltWith({ headingLevel = 'h3', hideTitle = false, className }: Props) {
  const Heading = headingLevel;
  return (
    <div data-cf-builtwith="" className={className}>
      {hideTitle ? null : (
        <Heading className="font-display text-h3 font-semibold text-text-primary">{BUILT_WITH_COPY.title}</Heading>
      )}
      <p className={cn('max-w-prose text-base leading-relaxed text-text-secondary', !hideTitle && 'mt-3')}>
        {BUILT_WITH_COPY.lead}
      </p>

      <ol className="mt-6 grid gap-3">
        {COREFORGE_GENERATOR_CHECKS.map((c, i) => (
          <li key={c.subtest} className="flex gap-4 rounded-xl border border-glass-border bg-glass-fill p-4">
            <span aria-hidden="true" className="font-mono text-xs leading-6 text-(--cf-berry-text)">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="text-sm leading-relaxed">
              <span className="font-semibold text-text-primary">{c.subtest}.</span>{' '}
              <span className="text-text-muted">{c.check}</span>
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex max-w-prose gap-2 text-sm leading-relaxed text-text-muted">
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
        {BUILT_WITH_COPY.subject}
      </p>

      <p className="mt-6 font-mono text-eyebrow text-text-muted uppercase">{BUILT_WITH_COPY.stackTitle}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {COREFORGE_BUILT_WITH.map((b) => (
          <li key={b.name} className="rounded-xl border border-glass-border bg-surface-tint px-3 py-2 text-sm">
            <span className="font-semibold text-text-primary">{b.name}</span>
            <span className="text-text-muted"> · {b.role}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default BuiltWith;
