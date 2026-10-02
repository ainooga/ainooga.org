import { DATABASE_NOW } from '../../worker/src/polls/clock';

// Production always uses SQLite's clock. Only this test adapter substitutes a
// database row, so advancing time after prepare/bind still affects execution.
export async function pollClock(db: D1Database, initial: Date) {
  await db.prepare('CREATE TABLE test_poll_clock (now TEXT NOT NULL)').run();
  await db
    .prepare('INSERT INTO test_poll_clock VALUES (?)')
    .bind(initial.toISOString())
    .run();
  const prepared: string[] = [];
  const wrapped = new Proxy(db, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) => {
          prepared.push(sql);
          return target.prepare(
            sql.replaceAll(DATABASE_NOW, '(SELECT now FROM test_poll_clock)'),
          );
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    db: wrapped,
    prepared,
    async set(time: Date) {
      await db.prepare('UPDATE test_poll_clock SET now=?').bind(time.toISOString()).run();
    },
  };
}
