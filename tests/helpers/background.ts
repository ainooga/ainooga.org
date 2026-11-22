export class BackgroundTasks {
  private tasks: Promise<PromiseSettledResult<unknown>[]>[] = [];
  private closed = false;
  async close(): Promise<void> {
    try {
      await this.drain();
    } finally {
      this.closed = true;
    }
  }
  waitUntil(task: Promise<unknown>): void {
    // Observe rejection even on late registrations; report the lifecycle violation once.
    const observed = Promise.allSettled([task]);
    if (this.closed) throw new Error('waitUntil after fixture disposal');
    this.tasks.push(observed);
  }
  async drain(): Promise<void> {
    const errors: unknown[] = [];
    // A waitUntil task can enqueue another. A rejected sibling must not strand either.
    while (this.tasks.length) {
      for (const result of (await Promise.all(this.tasks.splice(0))).flat())
        if (result.status === 'rejected') errors.push(result.reason);
    }
    if (errors.length) throw new AggregateError(errors, 'Background task failed');
  }
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// Delegate to real D1, pausing exactly one transaction before or after its commit.
export function pauseBatch(db: D1Database, when: 'before' | 'after') {
  const reached = deferred();
  const release = deferred();
  let paused = false;
  const wrapped = new Proxy(db, {
    get(target, property) {
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          if (paused) return target.batch(statements);
          paused = true;
          if (when === 'before') {
            reached.resolve();
            await release.promise;
          }
          const result = await target.batch(statements);
          if (when === 'after') {
            reached.resolve();
            await release.promise;
          }
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: wrapped, reached: reached.promise, release: () => release.resolve() };
}
