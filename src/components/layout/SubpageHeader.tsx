import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MotionToggle } from '@/components/shared/MotionToggle';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { DownloadCvButton } from '@/components/ui/DownloadCvButton';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';

/**
 * Header for pages outside the home page (case studies, 404). Plain next/link
 * hrefs throughout, so it works without the home page's scroll machinery; the
 * head bootstrap has already marked the intro as seen for this session.
 */
export function SubpageHeader({ className }: { className?: string }) {
  return (
    <header
      id="site-nav"
      className={cn('glass-strong glass-keep sticky top-0 z-nav rounded-none! border-x-0 border-t-0 border-b-hairline', className)}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-1 px-3 sm:gap-2 sm:px-8 lg:px-12">
        <Link
          href="/"
          aria-label={`${SITE.name}, home`}
          className="tap-safe rounded-full px-3 font-display text-sm font-bold tracking-wide text-text-primary ring-focus"
        >
          OB<span className="text-violet-bright">.</span>
        </Link>

        <Button
          asChild
          variant="ghost"
          size="sm"
          leadingIcon={<ArrowLeft aria-hidden="true" className="size-4 shrink-0" />}
          className="px-3"
          data-subpage-projects=""
        >
          <Link href="/#projects" aria-label="All projects">
            <span className="hidden sm:inline">All projects</span>
          </Link>
        </Button>

        <span className="ml-auto inline-flex items-center gap-1 sm:gap-2">
          <span className="inline-flex sm:hidden">
            <DownloadCvButton size="sm" label="CV" />
          </span>
          <span className="hidden sm:inline-flex">
            <DownloadCvButton size="sm" label="Resume" />
          </span>
          <ThemeToggle />
          <MotionToggle />
        </span>
      </div>
    </header>
  );
}
