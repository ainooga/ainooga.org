// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { verifyOutput } from '../../scripts/verify';

const originalDirectory = process.cwd();
let directory: string;

function write(path: string, contents: object | string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ainooga-verify-'));
  process.chdir(directory);
  write('static/data/version.json', { v: 'test' });
  for (const type of ['posts', 'members', 'sponsors']) {
    write(`static/data/${type}/index.json`, { items: [], meta: { total: 0 } });
  }
  write('static/data/events/index.json', {
    items: [{ slug: 'meetup', path: '/data/events/meetup.json' }],
    meta: { total: 1 },
  });
  write('static/data/events/meetup.json', {
    bodyHtml: '<p>Meetup</p>',
    ogImage: '/images/meetup-og.jpg',
  });
});

afterEach(() => {
  process.chdir(originalDirectory);
  rmSync(directory, { recursive: true, force: true });
});

it('fails the content build when a preview image was not generated', () => {
  expect(verifyOutput()).toMatchObject({
    pass: false,
    errors: [
      'static/data/events/meetup.json: missing preview image static/images/meetup-og.jpg',
    ],
  });
});

it('passes once the preview image exists', () => {
  write('static/images/meetup-og.jpg', 'jpg');

  expect(verifyOutput()).toMatchObject({ pass: true, errors: [] });
});
