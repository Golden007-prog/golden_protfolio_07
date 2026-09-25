'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { reportMarkdown, reportText, type FitView, type SiteLinks } from '@/lib/ai/fit';

type Props = { view: FitView; links: SiteLinks };

/**
 * 'Copy report' (plain text), 'Copy as Markdown' (for ATS notes) and 'Print /
 * Save as PDF' (ai-recruiter.css hides the site chrome in print). Every export
 * keeps the AI disclosure, the site URL, /cv and the data date. Nothing is sent
 * to or stored on the server.
 */
export function FitExport({ view, links }: Props) {
  return (
    <div data-fit-export="" data-fit-noprint="" className="flex flex-wrap items-center gap-2">
      <CopyButton value={reportText(view, links)} label="Copy report" copiedLabel="Report copied" size="sm" variant="secondary" />
      <CopyButton value={reportMarkdown(view, links)} label="Copy as Markdown" copiedLabel="Markdown copied" size="sm" variant="secondary" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        leadingIcon={<Printer aria-hidden="true" className="size-4 shrink-0" />}
        onClick={() => window.print()}
        data-fit-print=""
      >
        Print / Save as PDF
      </Button>
    </div>
  );
}
