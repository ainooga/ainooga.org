export interface CleanupResult {
  sessionsDeleted: number;
  challengesDeleted: number;
  capped: boolean;
}

export async function cleanupAuth(
  db: D1Database,
  now: Date,
  elapsedClock: () => number = () => performance.now(),
): Promise<CleanupResult> {
  const cutoff = new Date(now.getTime() - 86400000).toISOString();
  const started = elapsedClock();
  const result = { sessionsDeleted: 0, challengesDeleted: 0, capped: true };
  for (let batch = 0; batch < 20 && elapsedClock() - started < 10000; batch++) {
    const removed = await db.batch([
      db
        .prepare(
          `DELETE FROM voter_sessions WHERE token_hash IN
        (SELECT token_hash FROM voter_sessions WHERE expires_at < ? ORDER BY expires_at LIMIT 1000)`,
        )
        .bind(cutoff),
      db
        .prepare(
          `DELETE FROM auth_challenges WHERE id IN
        (SELECT id FROM auth_challenges WHERE expires_at < ? ORDER BY expires_at LIMIT 1000)`,
        )
        .bind(cutoff),
    ]);
    const sessions = removed[0]!.meta.changes;
    const challenges = removed[1]!.meta.changes;
    result.sessionsDeleted += sessions;
    result.challengesDeleted += challenges;
    if (sessions < 1000 && challenges < 1000) {
      result.capped = false;
      break;
    }
  }
  return result;
}
