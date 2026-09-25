import { connection } from 'next/server';
import { aiState } from '@/lib/ai/config.server';
import { fakeStats } from '@/lib/ai/fake.server';
import type { AiHealth } from '@/lib/ai/protocol';

export const maxDuration = 30;

/**
 * GET /api/ai/health -> AiHealth. The single source clients use for model names
 * and tier. It reads configuration only: no model call, no key, no visitor data.
 * Under the fake model it adds the fake's call and pull counters for tests.
 */
export async function GET() {
  // Request time only: the answer depends on env and on live per-instance cooldowns.
  await connection();
  const state = aiState();
  const body: AiHealth = state.fake ? { ...state, fakeStats: fakeStats() } : state;
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
