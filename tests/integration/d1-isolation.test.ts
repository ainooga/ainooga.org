// @vitest-environment node
import { expect, it } from 'vitest';
import { authFixture } from '../helpers/auth';
import { bindingPool, initialize } from '../helpers/d1';

it('isolates simultaneous cases and drains nested tasks after a failing consumer', async () => {
  const pool = bindingPool(2);
  const events: string[] = [];
  try {
    const tasks = ['first', 'second'].map(async (value) => {
      const context = await authFixture(true, pool.open, false);
      try {
        expect(await context.store.query('SELECT COUNT(*) n FROM polls')).toEqual([
          { n: 0 },
        ]);
        await context.store.execute([
          'CREATE TABLE marker (value TEXT UNIQUE)',
          `INSERT INTO marker VALUES ('${value}')`,
        ]);
        if (value === 'first') {
          context.deps.waitUntil(Promise.reject(new Error('background failure')));
          context.deps.waitUntil(
            Promise.resolve().then(() => {
              context.deps.waitUntil(
                context.store.query('SELECT value FROM marker').then(([row]) => {
                  events.push(String(row!.value));
                }),
              );
            }),
          );
        }
        expect(await context.store.query('SELECT value FROM marker')).toEqual([
          { value },
        ]);
      } finally {
        await context.dispose();
        expect(() => context.deps.waitUntil(Promise.resolve())).toThrow(
          'waitUntil after fixture disposal',
        );
        await expect(context.store.query('SELECT 1')).rejects.toThrow('revoked');
      }
    });
    const [first, second] = await Promise.allSettled(tasks);
    expect(first).toMatchObject({
      status: 'rejected',
      reason: new AggregateError(
        [new Error('background failure')],
        'Background task failed',
      ),
    });
    expect(second.status).toBe('fulfilled');
    expect(events).toEqual(['first']);
    await expect(pool.open()).rejects.toThrow('No fresh D1 binding left');
  } finally {
    await pool.dispose();
  }
});

it('releases a binding after failed setup; next allocation has no marker', async () => {
  const pool = bindingPool(2);
  try {
    await expect(
      initialize(await pool.open(), async ({ store }) => {
        await store.execute(['CREATE TABLE marker (id INTEGER PRIMARY KEY)']);
        throw new Error('broken setup');
      }),
    ).rejects.toThrow('broken setup');
    const fresh = await pool.open();
    try {
      expect(
        await fresh.store.query("SELECT name FROM sqlite_schema WHERE name='marker'"),
      ).toEqual([]);
    } finally {
      await fresh.dispose();
    }
  } finally {
    await pool.dispose();
  }
});
