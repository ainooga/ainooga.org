// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildPages } from '../../scripts/build-pages';

const originalDirectory = process.cwd();
let directory: string;

function write(path: string, contents: string | object) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
}

function ogImage(page: string): string | undefined {
  return /property="og:image" content="([^"]+)"/.exec(readFileSync(page, 'utf-8'))?.[1];
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ainooga-build-pages-'));
  process.chdir(directory);
  write('content/site.yml', 'title: Club\ndescription: A club\nurl: https://club.test\n');
  write(
    'dist/index.html',
    '<!-- page-meta:start --><!-- page-meta:end --><div id="app"></div>',
  );
  write('dist/og-default.png', '');
  write('dist/images/a-og.jpg', '');
  write('dist/data/events/index.json', {
    items: ['a', 'b'].map((slug) => ({ slug, path: `/data/events/${slug}.json` })),
  });
  write('dist/data/events/a.json', { title: 'A', ogImage: '/images/a-og.jpg' });
  write('dist/data/events/b.json', { title: 'B' });
  write('dist/data/posts/index.json', { items: [] });
  write('dist/data/members/index.json', { items: [] });
});

afterEach(() => {
  process.chdir(originalDirectory);
  rmSync(directory, { recursive: true, force: true });
});

it('writes each route as the app shell with its own preview tags', () => {
  expect(buildPages('dist').errors).toEqual([]);

  const page = readFileSync('dist/events/a.html', 'utf-8');
  expect(page).toContain('<div id="app"></div>');
  expect(page).toContain('<link rel="canonical" href="https://club.test/events/a" />');
  expect(ogImage('dist/events/a.html')).toBe('https://club.test/images/a-og.jpg');
  expect(ogImage('dist/events/b.html')).toBe('https://club.test/og-default.png');
});

it('reports a preview image that was not deployed', () => {
  rmSync('dist/images/a-og.jpg');

  expect(buildPages('dist').errors).toEqual([
    'dist/events/a.html: og:image /images/a-og.jpg does not exist in dist/',
  ]);
});

it("fails when a 404.html would disable Cloudflare Pages' SPA fallback", () => {
  write('dist/404.html', '');

  expect(buildPages('dist').errors).toEqual([
    "dist/404.html exists; it disables Cloudflare Pages' SPA fallback.",
  ]);
});

it('requires a site url so preview links are absolute', () => {
  write('content/site.yml', 'title: Club\ndescription: A club\n');

  expect(() => buildPages('dist')).toThrow('"url" and "description" are required');
});
