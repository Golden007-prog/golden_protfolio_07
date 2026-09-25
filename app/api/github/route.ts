import profile from '@/data/profile.json';
import snapshotJson from '@/data/live-snapshot.json';
import { fetchContributions, fetchLatestPush, type GitHubLive, type LiveSnapshot } from '@/lib/live-data';
import { usernameFromUrl } from '@/utils/contributionStats';

// One upstream round trip per 10 minutes for every visitor (GitHub allows 60/h unauthenticated).
export const dynamic = 'force-static';
export const revalidate = 600;

const snapshot = snapshotJson as unknown as LiveSnapshot;

/**
 * GET /api/github -> { contributions: { total, days }, latestPush, stale?, fetchedAt }.
 * Whatever GitHub (or jogruber) cannot provide right now comes from the build-time
 * snapshot, flagged stale. GITHUB_TOKEN is optional and only raises the rate limit.
 */
export async function GET() {
  const user = usernameFromUrl(profile.links.github);
  const [contributions, latestPush] = await Promise.all([
    fetchContributions(user),
    fetchLatestPush(user, process.env.GITHUB_TOKEN || undefined),
  ]);
  const snap = snapshot.github;

  if (!contributions && latestPush === undefined && !snap) {
    return Response.json({ error: 'GitHub is unreachable right now.' }, { status: 503 });
  }

  const usedSnapshot = Boolean(snap) && (!contributions || latestPush === undefined);
  const body: GitHubLive = {
    contributions: contributions ?? snap?.contributions ?? { total: 0, days: [] },
    latestPush: latestPush === undefined ? (snap?.latestPush ?? null) : latestPush,
    fetchedAt: new Date().toISOString(),
    ...(usedSnapshot ? { stale: true, snapshotAt: snapshot.generatedAt ?? undefined } : {}),
  };
  return Response.json(body);
}
