export class BackgroundTasks {
  private tasks: Promise<unknown>[] = [];
  waitUntil(task: Promise<unknown>): void {
    this.tasks.push(task);
  }
  async drain(): Promise<void> {
    await Promise.all(this.tasks.splice(0));
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
