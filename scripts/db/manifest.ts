import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { fingerprint, preflight, readLegacy } from './legacy.js';
import type { Manifest, SqlStore } from './types.js';

const manifestSchema = z
  .object({
    version: z.literal(1),
    target: z.string(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    migratedAt: z.string().datetime(),
  })
  .strict();

export function manifestPath(target: string): string {
  return resolve('backups', `chapter-migration-${target}.json`);
}

export function loadManifest(target: string): Manifest {
  const result = manifestSchema.safeParse(
    JSON.parse(readFileSync(manifestPath(target), 'utf8')),
  );
  if (!result.success || result.data.target !== target)
    throw new Error('Invalid migration manifest for target');
  return result.data;
}

export async function prepare(db: SqlStore, target: string): Promise<Manifest> {
  const data = await readLegacy(db);
  preflight(data);
  const hash = fingerprint(data);
  try {
    const existing = loadManifest(target);
    if (existing.fingerprint !== hash)
      throw new Error(
        'Source changed since saved preflight; reconcile before replacing the manifest',
      );
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const manifest: Manifest = {
    version: 1,
    target,
    fingerprint: hash,
    migratedAt: new Date().toISOString(),
  };
  mkdirSync('backups', { recursive: true, mode: 0o700 });
  writeFileSync(manifestPath(target), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    `Preflight passed: ${data.subscribers.length} subscribers, ${data.contacts.length} inquiries.`,
  );
  return manifest;
}
