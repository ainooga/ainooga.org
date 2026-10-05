// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseAll, parseSiteConfig } from '../../scripts/parse';

const originalDirectory = process.cwd();
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ainooga-content-'));
  process.chdir(directory);
});
afterEach(() => {
  process.chdir(originalDirectory);
  rmSync(directory, { recursive: true, force: true });
});

function content(
  path: string,
  fields: Record<string, unknown>,
  body = 'Chapter content',
) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\n${JSON.stringify(fields)}\n---\n${body}`);
}
const post = {
  title: 'Chapter news',
  date: '2026-10-04',
  author: 'Organizer',
  tags: ['news'],
  status: 'published',
};

it('parses all content types, preserves Markdown and derives nested file slugs', () => {
  content('content/posts/archive/news.md', post, '## News\n\n**Chapter update**');
  content('content/events/meeting.md', {
    title: 'Meeting',
    date: '2026-10-05T18:00:00Z',
    endDate: '2026-10-05T20:00:00Z',
    location: 'Library',
    organizer: 'Chapter',
    tags: [],
    status: 'draft',
  });
  content('content/members/person.md', {
    name: 'Synthetic Member',
    joined: '2026-01-01',
    links: { website: 'https://example.com' },
    status: 'active',
  });
  content('content/sponsors/company.md', {
    name: 'Example Company',
    tier: 'community',
    since: '2026-01-01',
    featured: false,
  });
  const result = parseAll();
  expect(result.errors).toEqual([]);
  expect(result.docs).toHaveLength(4);
  expect(result.docs.find((doc) => doc.type === 'posts')).toMatchObject({
    slug: 'news',
    filePath: 'content/posts/archive/news.md',
    body: '## News\n\n**Chapter update**',
    frontmatter: { ...post, date: new Date('2026-10-04') },
  });
  expect(result.docs.find((doc) => doc.type === 'events')?.frontmatter).toMatchObject({
    status: 'draft',
    endDate: new Date('2026-10-05T20:00:00Z'),
  });
  expect(result.docs.find((doc) => doc.type === 'members')?.frontmatter).toMatchObject({
    name: 'Synthetic Member',
    joined: new Date('2026-01-01'),
  });
  expect(result.docs.find((doc) => doc.type === 'sponsors')?.frontmatter).toMatchObject({
    tier: 'community',
    since: new Date('2026-01-01'),
    featured: false,
  });
});

it('collects field errors across files and excludes invalid documents', () => {
  content('content/posts/good.md', post);
  content('content/posts/bad.md', {
    ...post,
    title: '',
    date: 'invalid',
    author: undefined,
    unexpected: true,
  });
  content('content/sponsors/bad.md', {
    name: 'Example',
    tier: 'unsupported',
    since: 'invalid',
  });
  const result = parseAll();
  expect(result.docs.map((doc) => doc.slug)).toEqual(['good']);
  expect(result.errors.map((error) => [error.filePath, error.field])).toEqual(
    expect.arrayContaining([
      ['content/posts/bad.md', 'title'],
      ['content/posts/bad.md', 'date'],
      ['content/posts/bad.md', 'author'],
      ['content/posts/bad.md', ''],
      ['content/sponsors/bad.md', 'tier'],
      ['content/sponsors/bad.md', 'since'],
    ]),
  );
  expect(result.errors).toHaveLength(6);
  expect(result.errors.every((error) => error.message.length > 0)).toBe(true);
});

it('rejects malformed frontmatter instead of silently ignoring it', () => {
  mkdirSync('content/posts', { recursive: true });
  writeFileSync('content/posts/broken.md', '---\ntitle: [unfinished\n---\nBody');
  expect(() => parseAll()).toThrow();
});

it('requires a valid site configuration and preserves navigation', () => {
  expect(() => parseSiteConfig()).toThrow('content/site.yml not found');
  content('content/site.yml', { title: '', unknown: 'field' });
  expect(() => parseSiteConfig()).toThrow('content/site.yml');
  const config = {
    title: 'Synthetic chapter',
    url: 'https://example.com',
    nav: [{ label: 'Events', path: '/events' }],
  };
  content('content/site.yml', config);
  expect(parseSiteConfig()).toEqual(config);
});
