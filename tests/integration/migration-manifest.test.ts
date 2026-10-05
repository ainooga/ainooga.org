// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { database, migration } from '../helpers/d1';
import { seedLegacy } from '../helpers/legacy';
import { loadManifest, manifestPath, prepare } from '../../db/manifest';

const originalDirectory = process.cwd();
let directory: string;
let fixture: Awaited<ReturnType<typeof database>>;
beforeEach(async () => {
  fixture = await database();
  await migration(fixture.store, '0001_create_subscribers.sql');
  await seedLegacy(fixture.store);
  directory = mkdtempSync(join(tmpdir(), 'ainooga-manifest-'));
  process.chdir(directory);
});
afterEach(async () => {
  process.chdir(originalDirectory);
  await fixture.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it('creates a private manifest and reuses the exact saved checkpoint on resume', async () => {
  const manifest = await prepare(fixture.store, 'local-test');
  expect(manifest).toMatchObject({
    version: 1,
    target: 'local-test',
    fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    migratedAt: expect.any(String),
  });
  const path = manifestPath('local-test');
  const saved = readFileSync(path, 'utf8');
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(statSync(join(directory, 'backups')).mode & 0o777).toBe(0o700);
  expect(await prepare(fixture.store, 'local-test')).toEqual(manifest);
  expect(loadManifest('local-test')).toEqual(manifest);
  expect(readFileSync(path, 'utf8')).toBe(saved);
  expect(saved).not.toContain('Legacy@Example.com');
  expect(saved).not.toContain('old-token');
});

it('refuses changed source data without replacing the saved checkpoint', async () => {
  await prepare(fixture.store, 'local-test');
  const saved = readFileSync(manifestPath('local-test'), 'utf8');
  await fixture.store.execute(["UPDATE subscribers SET name='Changed' WHERE id=3"]);
  await expect(prepare(fixture.store, 'local-test')).rejects.toThrow(
    'Source changed since saved preflight',
  );
  expect(readFileSync(manifestPath('local-test'), 'utf8')).toBe(saved);
});

it('does not overwrite malformed manifests or a checkpoint for another target', async () => {
  const manifest = await prepare(fixture.store, 'local-test');
  for (const value of [
    '{',
    JSON.stringify({ ...manifest, version: 2 }),
    JSON.stringify({ ...manifest, target: 'remote-test' }),
  ]) {
    writeFileSync(manifestPath('local-test'), value);
    await expect(prepare(fixture.store, 'local-test')).rejects.toThrow();
    expect(readFileSync(manifestPath('local-test'), 'utf8')).toBe(value);
  }
});

it('does not create a checkpoint when preflight rejects unsafe source data', async () => {
  await fixture.store.execute(["UPDATE subscribers SET email='invalid' WHERE id=3"]);
  await expect(prepare(fixture.store, 'local-test')).rejects.toThrow(
    'subscribers 3: invalid email',
  );
  expect(existsSync(manifestPath('local-test'))).toBe(false);
});
