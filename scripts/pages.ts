import { OG_IMAGE } from './types.js';

export interface SiteMeta {
  title: string;
  description: string;
  url: string;
}

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  type: 'website' | 'article';
  image: string;
  imageAlt: string;
}

type Doc = Record<string, unknown>;

export const DEFAULT_OG_IMAGE = '/og-default.png';
const DEFAULT_TIMEZONE = 'America/New_York';
const DESCRIPTION_MAX = 300;
const META_BLOCK = /<!-- page-meta:start -->[\s\S]*?<!-- page-meta:end -->/;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}

export function absoluteUrl(site: SiteMeta, path: string): string {
  return new URL(path, site.url).href;
}

export function truncate(text: string, max = DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Output file for a route, e.g. `/events/x` → `events/x.html`. */
export function pageFile(path: string): string {
  return `${path.replace(/^\/+/, '')}.html`;
}

export function renderMetaTags(meta: PageMeta, site: SiteMeta): string {
  const url = absoluteUrl(site, meta.path);
  const image = absoluteUrl(site, meta.image);
  const fullTitle =
    meta.title === site.title ? site.title : `${meta.title} — ${site.title}`;
  const tags = [
    `<title>${escapeHtml(fullTitle)}</title>`,
    ['name', 'description', meta.description],
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    ['property', 'og:site_name', site.title],
    ['property', 'og:type', meta.type],
    ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description],
    ['property', 'og:url', url],
    ['property', 'og:image', image],
    ['property', 'og:image:width', String(OG_IMAGE.width)],
    ['property', 'og:image:height', String(OG_IMAGE.height)],
    ['property', 'og:image:alt', meta.imageAlt],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', meta.title],
    ['name', 'twitter:description', meta.description],
    ['name', 'twitter:image', image],
  ];
  return tags
    .map((tag) =>
      typeof tag === 'string'
        ? tag
        : `<meta ${tag[0]}="${tag[1]}" content="${escapeHtml(tag[2] ?? '')}" />`,
    )
    .join('\n    ');
}

export function applyPageMeta(template: string, meta: PageMeta, site: SiteMeta): string {
  if (!META_BLOCK.test(template)) {
    throw new Error('index.html is missing the <!-- page-meta:start/end --> block.');
  }
  const block = `<!-- page-meta:start -->\n    ${renderMetaTags(meta, site)}\n    <!-- page-meta:end -->`;
  return template.replace(META_BLOCK, () => block);
}

function text(doc: Doc, field: string): string | undefined {
  const value = doc[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function sameDay(a: Date, b: Date, timeZone: string): boolean {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'short' });
  return day.format(a) === day.format(b);
}

export function formatEventWhen(
  date: string,
  endDate?: string,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const start = new Date(date);
  const full: Intl.DateTimeFormatOptions = {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  if (endDate === undefined) {
    return new Intl.DateTimeFormat('en-US', { ...full, timeZoneName: 'short' }).format(
      start,
    );
  }
  const end = new Date(endDate);
  const endFormat: Intl.DateTimeFormatOptions = sameDay(start, end, timeZone)
    ? { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
    : { ...full, timeZoneName: 'short' };
  const startText = new Intl.DateTimeFormat('en-US', full).format(start);
  return `${startText} – ${new Intl.DateTimeFormat('en-US', endFormat).format(end)}`;
}

export function eventMeta(slug: string, doc: Doc, site: SiteMeta): PageMeta {
  const title = text(doc, 'title') ?? slug;
  const date = text(doc, 'date');
  const when =
    date === undefined
      ? undefined
      : formatEventWhen(date, text(doc, 'endDate'), text(doc, 'timezone'));
  const summary = text(doc, 'excerpt') ?? text(doc, 'location') ?? site.description;
  return {
    path: `/events/${slug}`,
    title,
    description: truncate(when === undefined ? summary : `${when} · ${summary}`),
    type: 'website',
    image: text(doc, 'ogImage') ?? DEFAULT_OG_IMAGE,
    imageAlt: title,
  };
}

export function postMeta(slug: string, doc: Doc, site: SiteMeta): PageMeta {
  const title = text(doc, 'title') ?? slug;
  return {
    path: `/posts/${slug}`,
    title,
    description: truncate(text(doc, 'excerpt') ?? site.description),
    type: 'article',
    image: text(doc, 'ogImage') ?? DEFAULT_OG_IMAGE,
    imageAlt: title,
  };
}

export function memberMeta(slug: string, doc: Doc, site: SiteMeta): PageMeta {
  const name = text(doc, 'name') ?? slug;
  const about = [text(doc, 'role'), text(doc, 'bio')].filter(
    (part) => part !== undefined,
  );
  return {
    path: `/members/${slug}`,
    title: name,
    description: truncate(
      about.length > 0 ? about.join(' — ') : `${name} is a member of ${site.title}.`,
    ),
    type: 'website',
    image: text(doc, 'ogImage') ?? DEFAULT_OG_IMAGE,
    imageAlt: name,
  };
}

export function sectionMeta(label: string, path: string, site: SiteMeta): PageMeta {
  return {
    path,
    title: label,
    description: site.description,
    type: 'website',
    image: DEFAULT_OG_IMAGE,
    imageAlt: site.title,
  };
}
