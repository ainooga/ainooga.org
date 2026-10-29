// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DEFAULT_OG_IMAGE,
  applyPageMeta,
  escapeHtml,
  eventMeta,
  formatEventWhen,
  memberMeta,
  pageFile,
  postMeta,
  renderMetaTags,
  sectionMeta,
  truncate,
  type PageMeta,
} from '../../scripts/pages';
import { verifyPage } from '../../scripts/build-pages';

const site = {
  title: 'AI Nooga',
  description: "Chattanooga's AI club",
  url: 'https://ainooga.org',
};
const template = `<head>\n<!-- page-meta:start -->\n<title>old</title>\n<!-- page-meta:end -->\n<link rel="icon" />\n</head>`;

describe('formatting helpers', () => {
  it.each([
    ['plain', 'plain'],
    [
      `<a href="x">Tom & Jerry's</a>`,
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    ],
  ])('escapes %s', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it('collapses whitespace and truncates long text with an ellipsis', () => {
    expect(truncate('  a \n  b  ')).toBe('a b');
    expect(truncate('abcdefghij', 6)).toBe('abcde…');
  });

  it.each([
    ['/events/meetup', 'events/meetup.html'],
    ['/about', 'about.html'],
  ])('maps %s to %s', (path, file) => {
    expect(pageFile(path)).toBe(file);
  });

  it.each([
    ['2026-11-21T18:00:00.000Z', undefined, undefined, 'Sat, Nov 21, 2026, 1:00 PM EST'],
    [
      '2026-11-21T18:00:00.000Z',
      '2026-11-21T22:00:00.000Z',
      'America/New_York',
      'Sat, Nov 21, 2026, 1:00 PM – 5:00 PM EST',
    ],
    [
      '2026-11-21T18:00:00.000Z',
      '2026-11-22T18:00:00.000Z',
      'America/Chicago',
      'Sat, Nov 21, 2026, 12:00 PM – Sun, Nov 22, 2026, 12:00 PM CST',
    ],
  ])('formats event time %s – %s (%s)', (start, end, timeZone, expected) => {
    expect(formatEventWhen(start, end, timeZone)).toBe(expected);
  });
});

describe('page metadata builders', () => {
  it('describes events with their schedule, excerpt and preview image', () => {
    const meta = eventMeta(
      'meetup',
      {
        title: 'Meetup',
        date: '2026-11-21T18:00:00.000Z',
        endDate: '2026-11-21T22:00:00.000Z',
        timezone: 'America/New_York',
        location: 'BDC',
        excerpt: 'Bring a problem.',
        ogImage: '/images/meetup-og.jpg',
      },
      site,
    );
    expect(meta).toEqual({
      path: '/events/meetup',
      title: 'Meetup',
      description: 'Sat, Nov 21, 2026, 1:00 PM – 5:00 PM EST · Bring a problem.',
      type: 'website',
      image: '/images/meetup-og.jpg',
      imageAlt: 'Meetup',
    });
  });

  it.each([
    ['events', eventMeta, 'meetup', "Chattanooga's AI club"],
    ['posts', postMeta, 'news', "Chattanooga's AI club"],
    ['members', memberMeta, 'ada', 'ada is a member of AI Nooga.'],
  ] as const)(
    'falls back to the slug, site description and default image for %s',
    (_type, build, slug, description) => {
      expect(build(slug, {}, site)).toMatchObject({
        title: slug,
        description,
        image: DEFAULT_OG_IMAGE,
      });
    },
  );

  it('uses event location when there is no excerpt', () => {
    expect(eventMeta('x', { title: 'X', location: 'BDC' }, site).description).toBe('BDC');
  });

  it('marks posts as articles and joins member role and bio', () => {
    expect(postMeta('news', { title: 'News', excerpt: 'Hi' }, site)).toMatchObject({
      path: '/posts/news',
      type: 'article',
      description: 'Hi',
    });
    expect(
      memberMeta('ada', { name: 'Ada', role: 'Organizer', bio: 'Builds things.' }, site),
    ).toMatchObject({ title: 'Ada', description: 'Organizer — Builds things.' });
  });

  it('builds section pages from navigation', () => {
    expect(sectionMeta('Events', '/events', site)).toMatchObject({
      path: '/events',
      title: 'Events',
      image: DEFAULT_OG_IMAGE,
    });
  });
});

describe('applyPageMeta', () => {
  const meta: PageMeta = {
    path: '/events/meetup',
    title: 'Meet "up" & <build>',
    description: 'Bring a problem.',
    type: 'website',
    image: '/images/meetup-og.jpg',
    imageAlt: 'Meetup',
  };

  it('replaces only the marked block with escaped, absolute metadata', () => {
    const html = applyPageMeta(template, meta, site);
    expect(html).not.toContain('<title>old</title>');
    expect(html).toContain('<link rel="icon" />');
    expect(html).toContain(
      '<title>Meet &quot;up&quot; &amp; &lt;build&gt; — AI Nooga</title>',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://ainooga.org/events/meetup" />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://ainooga.org/images/meetup-og.jpg" />',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('does not repeat the site name for pages titled after the site', () => {
    expect(renderMetaTags({ ...meta, title: 'AI Nooga' }, site)).toContain(
      '<title>AI Nooga</title>',
    );
  });

  it('fails when the template has no metadata block', () => {
    expect(() => applyPageMeta('<head></head>', meta, site)).toThrow('page-meta');
  });
});

describe('verifyPage', () => {
  let dist: string;
  const meta = sectionMeta('Events', '/events', site);
  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'ainooga-pages-'));
  });
  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  function write(path: string, contents: string) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), contents);
  }

  it('passes a written page whose preview image exists', () => {
    write('events.html', applyPageMeta(template, meta, site));
    write(DEFAULT_OG_IMAGE, 'png');
    expect(verifyPage(meta, site, dist)).toEqual([]);
  });

  it('reports missing pages, tags and images', () => {
    expect(verifyPage(meta, site, dist)).toEqual([
      `${join(dist, 'events.html')}: page was not written`,
    ]);
    write('events.html', template);
    expect(verifyPage(meta, site, dist)).toEqual([
      `${join(dist, 'events.html')}: missing absolute og:image`,
      `${join(dist, 'events.html')}: og:image ${DEFAULT_OG_IMAGE} does not exist in ${dist}/`,
    ]);
  });
});
