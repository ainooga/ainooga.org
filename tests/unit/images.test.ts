// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { processImage } from '../../scripts/images';

const originalDirectory = process.cwd();
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ainooga-images-'));
  process.chdir(directory);
  mkdirSync('content/events', { recursive: true });
});

afterEach(() => {
  process.chdir(originalDirectory);
  rmSync(directory, { recursive: true, force: true });
});

function image(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#1B2A3C' } });
}

it('emits a 1200x630 JPEG preview card regardless of source shape', async () => {
  await image(4, 9).png().toFile('content/events/hero.png');

  const { outputs } = await processImage('content/events/hero.png', 'static/images');

  expect(outputs).toContain(join('static/images', 'hero-og.jpg'));
  expect(await sharp('static/images/hero-og.jpg').metadata()).toMatchObject({
    format: 'jpeg',
    width: 1200,
    height: 630,
  });
});

it('does not emit a preview card for GIFs', async () => {
  await image(2, 2).gif().toFile('content/events/loop.gif');

  await processImage('content/events/loop.gif', 'static/images');

  expect(existsSync('static/images/loop-og.jpg')).toBe(false);
});
