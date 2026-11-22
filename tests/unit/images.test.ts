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

it('keeps responsive aspect ratios and crops a 1200x630 JPEG from the center', async () => {
  // Only the centered crop keeps both sample points inside the white stripe.
  await image(12, 3)
    .composite([
      { input: { create: { width: 6, height: 3, channels: 3, background: 'white' } } },
    ])
    .png()
    .toFile('content/events/hero.png');

  const { outputs } = await processImage('content/events/hero.png', 'static/images');

  for (const width of [200, 600, 800, 1600]) {
    for (const ext of ['webp', 'avif']) {
      const path = join('static/images', `hero-${width}w.${ext}`);
      expect(outputs).toContain(path);
      expect(await sharp(path).metadata()).toMatchObject({
        width,
        height: width / 4,
        ...(ext === 'avif' ? { format: 'heif', compression: 'av1' } : { format: 'webp' }),
      });
    }
  }

  const preview = join('static/images', 'hero-og.jpg');
  expect(outputs).toContain(preview);
  expect(await sharp(preview).metadata()).toMatchObject({
    format: 'jpeg',
    width: 1200,
    height: 630,
  });
  for (const left of [240, 960]) {
    const pixel = await sharp(preview)
      .extract({ left, top: 63, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(Math.min(...pixel)).toBeGreaterThan(240);
  }
});

it('emits only the GIF without a preview card', async () => {
  await image(2, 2).gif().toFile('content/events/loop.gif');

  const { outputs } = await processImage('content/events/loop.gif', 'static/images');

  expect(outputs).toEqual([join('static/images', 'loop.gif')]);
  expect(await sharp(outputs[0]).metadata()).toMatchObject({
    format: 'gif',
    width: 2,
    height: 2,
  });
  expect(existsSync('static/images/loop-og.jpg')).toBe(false);
});
