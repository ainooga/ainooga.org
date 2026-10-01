import type { AuthDependencies } from './types.js';

async function withTimeout(task: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Email delivery timed out')), 10000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function deliverCode(
  deps: AuthDependencies,
  address: string,
  code: string,
  id: string,
): Promise<void> {
  try {
    await withTimeout(deps.sendCode(address, code));
  } catch {
    try {
      await deps.db
        .prepare(
          `UPDATE auth_challenges SET consumed_by = 'delivery_failed'
        WHERE id = ? AND consumed_by IS NULL`,
        )
        .bind(id)
        .run();
    } catch {
      console.error(JSON.stringify({ event: 'verification_invalidation_failed' }));
    }
    console.error(JSON.stringify({ event: 'verification_delivery_failed' }));
  }
}
