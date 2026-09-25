import profile from '@/data/profile.json';
import snapshotJson from '@/data/live-snapshot.json';
import { fetchLeetCode, type LeetCodeLive, type LiveSnapshot } from '@/lib/live-data';
import { usernameFromUrl } from '@/utils/contributionStats';

// leetcode.com has no CORS and challenges many datacenter IPs, so the browser never
// calls it: this route does, at most once per 10 minutes.
export const dynamic = 'force-static';
export const revalidate = 600;

const snapshot = snapshotJson as unknown as LiveSnapshot;

/**
 * GET /api/leetcode -> { username, totalSolved, easy, medium, hard, ranking, streak,
 * totalActiveDays, calendar, stale?, fetchedAt }. leetcode.com GraphQL first, then the
 * alfa-leetcode-api mirror, then the build-time snapshot (stale: true).
 */
export async function GET() {
  const user = usernameFromUrl(profile.links.leetcode);
  const live = await fetchLeetCode(user);
  if (live) {
    const body: LeetCodeLive = { ...live, fetchedAt: new Date().toISOString() };
    return Response.json(body);
  }
  if (snapshot.leetcode) {
    const body: LeetCodeLive = {
      ...snapshot.leetcode,
      stale: true,
      fetchedAt: new Date().toISOString(),
      snapshotAt: snapshot.generatedAt ?? undefined,
    };
    return Response.json(body);
  }
  return Response.json({ error: 'LeetCode is unreachable right now.' }, { status: 503 });
}
