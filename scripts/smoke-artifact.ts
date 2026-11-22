import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

// Read only the deployment artifact. Checking a source image could pass even if
// Vite failed to copy it, or a deep link accidentally retained the homepage tags.
const dist = 'dist';
const site = 'https://ainooga.org';
const route = '/events/2026-07-18-build-practical-agents-with-hermes';
const html = await readFile(join(dist, `${route}.html`), 'utf8');
assert(html.includes('<div id="app"></div>'), `${route}: missing app shell`);
assert(
  html.includes(`<link rel="canonical" href="${site}${route}"`),
  `${route}: incorrect canonical`,
);
const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
assert(image !== undefined, `${route}: missing og:image`);
const url = new URL(image);
assert.equal(url.origin, site);
assert.equal(url.pathname, '/images/2026-07-18-workshop-hero-og.jpg');
const jpeg = sharp(join(dist, url.pathname));
const { format, width, height } = await jpeg.metadata();
assert.deepEqual([format, width, height], ['jpeg', 1200, 630]);
await jpeg.raw().toBuffer(); // Decode pixels too: a valid header can hide a truncated JPEG.
console.log(`Artifact smoke passed: ${route} → ${url.pathname} (${width}×${height})`);
