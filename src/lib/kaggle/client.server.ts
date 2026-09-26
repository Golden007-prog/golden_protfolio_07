import 'server-only';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { CACHE_TAG, LIVE_PUBLIC_WITHOUT_TOKEN, RETRY_AFTER_FAILURE_SECONDS, REVALIDATE_SECONDS, USERNAME } from './config.ts';
import { hasCredentials, loadKaggleData } from './load.ts';
import { coerceSnapshot, fromSnapshot, resplit } from './normalize.ts';
import snapshotJson from './snapshot.json';
import type { KaggleData } from './types.ts';

/*
 * The Kaggle section's data, server side only. With KAGGLE_API_TOKEN (or the
 * legacy KAGGLE_USERNAME + KAGGLE_KEY) set in Vercel, it reads Kaggle live.
 *
 * The whole successful read is cached as one unit for REVALIDATE_SECONDS under
 * the 'kaggle' tag, so data.fetchedAt and every rank's as-of date are the time
 * Kaggle was actually read, even when Next serves the entry stale while it
 * refreshes. A failed read throws inside the cached function, so it is never
 * stored: the first read serves the snapshot, and a failed background refresh
 * keeps serving the last good entry. After a failure this instance waits
 * RETRY_AFTER_FAILURE_SECONDS before trying Kaggle again.
 *
 * Without credentials, or when anything fails, it serves snapshot.json. It never
 * throws and never logs, and the credentials never leave this server except in
 * requests to Kaggle; they are not part of the cache key or the cached value.
 */

const SNAPSHOT = coerceSnapshot(snapshotJson);

class KaggleUnavailable extends Error {
  constructor() {
    super('Kaggle live read failed; serving the snapshot');
    this.name = 'KaggleUnavailable';
  }
}

const readLive = unstable_cache(
  async (): Promise<KaggleData> => {
    const { data, failures } = await loadKaggleData({ env: process.env, snapshot: SNAPSHOT });
    if (failures.length > 0 || data.source !== 'live') throw new KaggleUnavailable();
    return data;
  },
  ['kaggle-live', USERNAME],
  { revalidate: REVALIDATE_SECONDS, tags: [CACHE_TAG] },
);

let retryAt = 0;

async function read(now?: Date): Promise<KaggleData> {
  const at = now ?? new Date();
  if (!hasCredentials(process.env) && !LIVE_PUBLIC_WITHOUT_TOKEN) return fromSnapshot(SNAPSHOT, at);
  if (Date.now() < retryAt) return fromSnapshot(SNAPSHOT, at);
  try {
    return resplit(await readLive(), at);
  } catch {
    retryAt = Date.now() + RETRY_AFTER_FAILURE_SECONDS * 1000;
    return fromSnapshot(SNAPSHOT, at);
  }
}

const readOnce = cache(() => read());

/** Deduplicated within one server render when called without arguments. */
export function getKaggleData({ now }: { now?: Date } = {}): Promise<KaggleData> {
  return now ? read(now) : readOnce();
}
