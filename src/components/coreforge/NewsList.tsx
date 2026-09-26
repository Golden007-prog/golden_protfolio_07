import { containsPrice } from '@/lib/coreforge/copy-guard';
import type { CoreforgeNewsItem as CoreforgeFeedItem } from '@/lib/coreforge/news';
import { cn } from '@/utils/cn';
import { CoreforgeLink } from './CoreforgeLink';

/**
 * One news entry. Takes fetchCoreforgeNews()'s items as they are ({ id, title, link,
 * date, categories }) or a hand-written { title, path }.
 */
export type CoreforgeNewsItem = {
  title: string;
  /** YYYY-MM-DD */
  date?: string;
  id?: string;
} & (
  | { /** A goldensdmat.in path ('/news#free-plan-replaces-trial') or absolute goldensdmat.in URL. */ path: string; link?: string }
  | { /** An absolute goldensdmat.in URL, as the RSS parser returns it. */ link: string; path?: string }
);

const itemPath = (item: CoreforgeNewsItem): string => item.path ?? item.link ?? '';

/** Identity, typed: fetchCoreforgeNews() output is valid NewsList input as it stands. */
export const fromFeed = (items: readonly CoreforgeFeedItem[]): readonly CoreforgeNewsItem[] => items;

type Props = {
  items?: readonly CoreforgeNewsItem[];
  title?: string;
  placement?: string;
  /** At most this many items. */
  limit?: number;
  headingLevel?: 'h2' | 'h3';
  /** Leave the heading to the caller (the venture page has its own). */
  hideTitle?: boolean;
  className?: string;
};

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function formatDate(iso: string): string | null {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : DATE_FMT.format(t);
}

/**
 * A slot for goldensdmat.in news. Renders nothing when there are no items, and drops
 * any item whose title quotes a price (the feed's history includes a superseded one).
 */
export function NewsList({
  items = [],
  // Most feed items are official g.a.s.t./APS announcements that CoreForge curates,
  // not CoreForge's own news.
  title = 'Latest dMAT news',
  placement = 'news',
  limit = 4,
  headingLevel = 'h3',
  hideTitle = false,
  className,
}: Props) {
  const shown = items.filter((i) => i.title.trim() && itemPath(i) && !containsPrice(i.title)).slice(0, limit);
  if (shown.length === 0) return null;
  const Heading = headingLevel;
  return (
    <div data-cf-news="" className={className}>
      {hideTitle ? null : <Heading className="font-display text-lg font-semibold text-text-primary">{title}</Heading>}
      <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
        {shown.map((item) => {
          const date = item.date ? formatDate(item.date) : null;
          const path = itemPath(item);
          return (
            <li key={item.id ?? `${path}|${item.title}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4">
              {date ? (
                <time dateTime={item.date} className={cn('shrink-0 font-mono text-xs text-text-muted sm:w-28')}>
                  {date}
                </time>
              ) : null}
              <CoreforgeLink path={path} placement={placement} className="tap-safe-sm justify-start font-normal text-text-primary">
                {item.title}
              </CoreforgeLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default NewsList;
