// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ogImagePath, renderDoc } from '../../scripts/render';
import type { ParsedDoc } from '../../scripts/types';

describe('ogImagePath', () => {
  it.each([
    ['./hero.jpg', '/images/hero-og.jpg'],
    ['./nested/hero.JPEG', '/images/hero-og.jpg'],
    ['../shared/photo.png', '/images/photo-og.jpg'],
    ['./scan.tiff', '/images/scan-og.jpg'],
    ['./animation.gif', undefined],
    ['/images/hero.jpg', undefined],
    ['https://example.com/hero.jpg', undefined],
    ['hero.jpg', undefined],
  ])('%s → %s', (src, expected) => {
    expect(ogImagePath(src)).toBe(expected);
  });
});

describe('renderDoc ogImage', () => {
  const originalDirectory = process.cwd();
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ainooga-og-'));
    process.chdir(directory);
    mkdirSync('content/events', { recursive: true });
    for (const file of ['banner.jpg', 'body.png'])
      writeFileSync(`content/events/${file}`, '');
  });
  afterEach(() => {
    process.chdir(originalDirectory);
    rmSync(directory, { recursive: true, force: true });
  });

  function doc(frontmatter: Record<string, unknown>, body: string): ParsedDoc {
    return {
      type: 'events',
      slug: 'x',
      frontmatter,
      body,
      filePath: 'content/events/x.md',
    };
  }

  it.each([
    [
      'prefers the banner',
      { banner: './banner.jpg' },
      '![b](./body.png)',
      '/images/banner-og.jpg',
    ],
    [
      'uses the first body image without a banner',
      {},
      '![b](./body.png)',
      '/images/body-og.jpg',
    ],
    [
      'skips a missing banner',
      { banner: './missing.jpg' },
      '![b](./body.png)',
      '/images/body-og.jpg',
    ],
    [
      'has none without usable images',
      { banner: './missing.jpg' },
      'Text only',
      undefined,
    ],
  ])('%s', (_name, frontmatter, body, expected) => {
    expect(renderDoc(doc(frontmatter, body)).ogImage).toBe(expected);
  });
});
