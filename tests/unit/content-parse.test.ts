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

const eventFields = {
  title: 'Meeting',
  date: '2026-10-17T13:00:00-04:00',
  endDate: '2026-10-17T17:00:00-04:00',
  location: 'BDC',
  organizer: 'Chapter',
  tags: [],
  status: 'published',
  timezone: 'America/New_York',
  capacity: 60,
  links: [
    { platform: 'luma', externalId: 'evt-example', url: 'https://luma.com/example' },
  ],
};

it('accepts structured event references and normalizes offset dates', () => {
  content('content/events/meeting.md', eventFields);
  const result = parseAll();
  expect(result.errors).toEqual([]);
  expect(result.docs[0]?.frontmatter).toMatchObject({
    date: new Date('2026-10-17T17:00:00.000Z'),
    timezone: 'America/New_York',
    capacity: 60,
    links: eventFields.links,
  });
});

it.each([
  { endDate: '2026-10-17T12:00:00-04:00' },
  { timezone: 'Not/A_Zone' },
  { capacity: -1 },
  { capacity: 1.5 },
  { links: [{ ...eventFields.links[0], url: 'not a URL' }] },
  { links: [{ ...eventFields.links[0], url: 'http://localhost/example' }] },
  { links: [{ ...eventFields.links[0], url: 'https://user:password@luma.com/example' }] },
  { links: [{ ...eventFields.links[0], externalId: '' }] },
  { links: [eventFields.links[0], eventFields.links[0]] },
])('rejects invalid event metadata %j', (fields) => {
  content('content/events/meeting.md', { ...eventFields, ...fields });
  expect(parseAll().errors.length).toBeGreaterThan(0);
});

it.each(['slug', 'platform identity'])(
  'rejects duplicate event %s across files',
  (kind) => {
    content('content/events/meeting.md', eventFields);
    content(`content/events/archive/${kind === 'slug' ? 'meeting' : 'other'}.md`, {
      ...eventFields,
      links: kind === 'slug' ? [] : eventFields.links,
    });
    expect(parseAll().errors.some((error) => error.message.includes('Duplicate'))).toBe(
      true,
    );
  },
);

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
