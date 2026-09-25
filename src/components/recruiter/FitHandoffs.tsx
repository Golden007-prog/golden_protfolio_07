'use client';

import { useId } from 'react';
import { LayoutGrid, MailPlus, MessageCircleQuestion } from 'lucide-react';
import profile from '@/data/profile.json';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { track } from '@/lib/analytics';
import { gapPrefill, reachOutPrefill, teamBlurbs, type FitView, type SiteLinks } from '@/lib/ai/fit';

type Props = {
  view: FitView;
  links: SiteLinks;
  /** Closes the sheet, then fills the contact form (which never sends). */
  onPrefill: (detail: { subject: string; message: string }) => void;
  /** Closes the sheet, filters the projects grid by ?tech and focuses the matched skill. */
  onShowMatches: (() => void) | null;
};

/**
 * Hand-offs built deterministically from verified rows (or exact keyword
 * matches), so every one works with the AI down.
 */
export function FitHandoffs({ view, links, onPrefill, onShowMatches }: Props) {
  const id = useId();
  const blurbs = teamBlurbs(view, profile, links);
  const gaps = gapPrefill(view);

  return (
    <section aria-labelledby={`${id}-title`} data-fit-handoffs="" data-fit-noprint="" className="fit-block">
      <h3 id={`${id}-title`} className="text-sm font-semibold text-text-primary">
        Next steps
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          shine={false}
          leadingIcon={<MailPlus aria-hidden="true" className="size-4 shrink-0" />}
          onClick={() => {
            track('ai_handoff', { feature: 'jd-fit', intent: 'reach-out' });
            onPrefill(reachOutPrefill(view));
          }}
          data-fit-reach-out=""
        >
          Reach out about this role
        </Button>
        {gaps ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={<MessageCircleQuestion aria-hidden="true" className="size-4 shrink-0" />}
            onClick={() => {
              track('ai_handoff', { feature: 'jd-fit', intent: 'gaps' });
              onPrefill(gaps);
            }}
            data-fit-ask-gaps=""
          >
            Ask Oikantik about these gaps
          </Button>
        ) : null}
        {onShowMatches ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={<LayoutGrid aria-hidden="true" className="size-4 shrink-0" />}
            onClick={() => {
              track('ai_handoff', { feature: 'jd-fit', intent: 'show-matches' });
              onShowMatches();
            }}
            data-fit-show-matches=""
          >
            Show matches on the page
          </Button>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border border-hairline bg-surface-tint p-3" data-fit-blurb="">
        <p className="text-xs font-medium text-text-secondary">Copy blurb for your team</p>
        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{blurbs.short}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyButton value={blurbs.short} label="Copy short blurb" copiedLabel="Short blurb copied" size="sm" variant="secondary" onCopied={() => track('ai_handoff', { feature: 'jd-fit', intent: 'blurb-short' })} />
          <CopyButton value={blurbs.full} label="Copy full blurb" copiedLabel="Full blurb copied" size="sm" variant="ghost" onCopied={() => track('ai_handoff', { feature: 'jd-fit', intent: 'blurb-full' })} />
        </div>
      </div>
    </section>
  );
}
