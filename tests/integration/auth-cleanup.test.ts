// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authFixture, responseCookie, verifiedLogin } from '../helpers/auth';
import { cleanupAuth } from '../../worker/src/auth/cleanup';

let f: Awaited<ReturnType<typeof authFixture>>;
beforeEach(async () => {
  f = await authFixture();
});
afterEach(async () => {
  await f.dispose();
});
const hour = 3600000;

async function seed(
  count: number,
  prefix: string,
  expiry = new Date(f.deps.time.getTime() - 25 * hour),
) {
  const created = new Date(expiry.getTime() - hour).toISOString();
  const cte = `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<${count})`;
  await f.store.execute([
    `${cte} INSERT INTO auth_challenges (id,kind,poll_id,browser_hash,created_at,expires_at)
      SELECT '${prefix}'||x,'discord',2,'browser','${created}','${expiry.toISOString()}' FROM n`,
    `${cte} INSERT INTO voter_sessions
      (token_hash,person_id,identifier_id,identifier_value,assurance,created_at,expires_at)
      SELECT '${prefix}'||x,2,2,'voter@example.com','verified','${created}','${expiry.toISOString()}' FROM n`,
  ]);
}

async function counts() {
  return f.store.query(`SELECT (SELECT COUNT(*) FROM voter_sessions) AS sessions,
    (SELECT COUNT(*) FROM auth_challenges) AS challenges`);
}

describe('bounded authentication cleanup', () => {
  it('drains multiple batches and preserves active and recently expired records', async () => {
    await seed(1500, 'old');
    await seed(1, 'active', new Date(f.deps.time.getTime() + hour));
    await seed(1, 'recent', new Date(f.deps.time.getTime() - hour));
    await seed(1, 'boundary', new Date(f.deps.time.getTime() - 24 * hour));
    expect(await cleanupAuth(f.db, f.deps.time)).toEqual({
      sessionsDeleted: 1500,
      challengesDeleted: 1500,
      capped: false,
    });
    expect(await counts()).toEqual([{ sessions: 3, challenges: 3 }]);
  });

  it('stops at twenty batches and continues on the next run', async () => {
    await seed(20001, 'old');
    expect(await cleanupAuth(f.db, f.deps.time, () => 0)).toEqual({
      sessionsDeleted: 20000,
      challengesDeleted: 20000,
      capped: true,
    });
    expect(await counts()).toEqual([{ sessions: 1, challenges: 1 }]);
    expect(await cleanupAuth(f.db, f.deps.time)).toEqual({
      sessionsDeleted: 1,
      challengesDeleted: 1,
      capped: false,
    });
  });

  it('stops starting batches after ten seconds, removing oldest rows first', async () => {
    await seed(500, 'newer');
    await seed(1000, 'oldest', new Date(f.deps.time.getTime() - 26 * hour));
    let clockCalls = 0;
    const clock = () => (clockCalls++ < 2 ? 0 : 10000);
    expect(await cleanupAuth(f.db, f.deps.time, clock)).toEqual({
      sessionsDeleted: 1000,
      challengesDeleted: 1000,
      capped: true,
    });
    expect(
      await f.store.query(
        "SELECT COUNT(*) AS n FROM auth_challenges WHERE id LIKE 'oldest%'",
      ),
    ).toEqual([{ n: 0 }]);
    expect((await cleanupAuth(f.db, f.deps.time)).challengesDeleted).toBe(500);
  });

  it('keeps expired backlog empty across sustained issuance and hourly cleanup', async () => {
    const start = f.deps.time.getTime();
    const totals: number[] = [];
    for (let cycle = 0; cycle < 28; cycle++) {
      f.deps.time = new Date(start + cycle * hour);
      await seed(1200, `cycle${cycle}-`, new Date(f.deps.time.getTime() + 600000));
      const result = await cleanupAuth(f.db, f.deps.time);
      expect(result.capped).toBe(false);
      const cutoff = new Date(f.deps.time.getTime() - 24 * hour).toISOString();
      expect(
        await f.store.query(
          `SELECT COUNT(*) AS n FROM auth_challenges WHERE expires_at < '${cutoff}'`,
        ),
      ).toEqual([{ n: 0 }]);
      totals.push(Number((await counts())[0]!.challenges));
    }
    expect(totals.slice(-3)).toEqual([30000, 30000, 30000]);
  }, 20000);

  it('rejects expired sessions before retention cleanup removes their rows', async () => {
    const cookie = responseCookie(await verifiedLogin(f));
    f.deps.time = new Date(f.deps.time.getTime() + 24 * hour);
    await cleanupAuth(f.db, f.deps.time);
    expect(await counts()).toEqual([{ sessions: 1, challenges: 1 }]);
    expect(
      await (await f.call('/api/polls/verified/session', undefined, cookie)).json(),
    ).toEqual({ authenticated: false });
  });
});
