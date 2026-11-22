import { afterAll, beforeAll, type RunnerTestSuite } from 'vitest';
import { bindingPool } from './d1';

function cases(suite: Readonly<RunnerTestSuite>): number {
  return suite.tasks.reduce((n, task) => {
    if (task.type === 'suite') return n + cases(task);
    const retries = typeof task.retry === 'object' ? task.retry.count : task.retry;
    return n + (1 + (retries ?? 0)) * (1 + (task.repeats ?? 0));
  }, 0);
}

// One never-reused binding per collected case, including cases in it.each tables.
export function fileDatabase() {
  let pool: ReturnType<typeof bindingPool>;
  // Vitest requires a destructuring pattern for its fixture argument.
  // eslint-disable-next-line no-empty-pattern
  beforeAll(({}, suite) => {
    pool = bindingPool(cases(suite));
  });
  afterAll(async () => pool?.dispose());
  return () => pool.open();
}
