import { getKaggleData } from '@/lib/kaggle/client.server';

// One Kaggle read per six hours for every visitor (config.ts REVALIDATE_SECONDS).
export const dynamic = 'force-static';
export const revalidate = 21600;

/**
 * GET /api/kaggle -> KaggleData: the public profile, tiers, badges and writeups, and
 * the competitions with any rank as 'of N teams, as of <date>'. Live when
 * KAGGLE_API_TOKEN is set on the server, otherwise the committed snapshot
 * (data.source says which). getKaggleData never throws, never logs and never
 * returns a credential: tokens only ever travel in requests to Kaggle itself.
 */
export async function GET() {
  return Response.json(await getKaggleData());
}
