/*
 * The production review gate for precomputed AI content. Generators write
 * entries into src/data/ai-generated/<store>.json; an entry that makes claims
 * about Oikantik (claimBearing) stays hidden in production until he approves it
 * with `npm run ai:review`. next.config sets NEXT_PUBLIC_AI_SHOW_UNREVIEWED to ''
 * on production and '1' elsewhere, so preview and local builds show drafts, with
 * their provenance, for review in context.
 *
 * Pure: no imports.
 */

export type StoreEntry<V> = {
  /** Hash of the source the value was generated from; a mismatch means stale. */
  hash: string;
  model: string;
  generatedAt: string;
  reviewed: boolean;
  reviewedAt?: string;
  claimBearing: boolean;
  value: V;
};

export type Store<V> = { version: 1; entries: Record<string, StoreEntry<V>> };

export const PROVENANCE = {
  site: "AI-written from this site's content",
  reviewed: 'AI-written · reviewed by Oikantik',
  draft: 'Draft · not yet reviewed',
} as const;

export type Provenance = (typeof PROVENANCE)[keyof typeof PROVENANCE];

/** Whether an entry may render: always when reviewed or claim-free, otherwise only where drafts are shown. */
export function visible(entry: Pick<StoreEntry<unknown>, 'reviewed' | 'claimBearing'> | null | undefined, showUnreviewed: boolean): boolean {
  if (!entry) return false;
  return entry.reviewed === true || entry.claimBearing === false || showUnreviewed;
}

/** The provenance line shown beside an entry. */
export function provenance(entry: Pick<StoreEntry<unknown>, 'reviewed' | 'claimBearing'>): Provenance {
  if (entry.reviewed === true) return PROVENANCE.reviewed;
  if (entry.claimBearing === false) return PROVENANCE.site;
  return PROVENANCE.draft;
}

/** The entries of a store that may render, keyed as stored. */
export function visibleEntries<V>(store: Store<V> | null | undefined, showUnreviewed: boolean): Record<string, StoreEntry<V>> {
  const out: Record<string, StoreEntry<V>> = {};
  for (const [key, entry] of Object.entries(store?.entries ?? {})) {
    if (visible(entry, showUnreviewed)) out[key] = entry;
  }
  return out;
}
