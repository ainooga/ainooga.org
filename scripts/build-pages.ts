import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSiteConfig } from './parse.js';
import {
  absoluteUrl,
  applyPageMeta,
  eventMeta,
  memberMeta,
  pageFile,
  postMeta,
  sectionMeta,
  type PageMeta,
  type SiteMeta,
} from './pages.js';

type Doc = Record<string, unknown>;
type MetaBuilder = (slug: string, doc: Doc, site: SiteMeta) => PageMeta;

const DIST = 'dist';

function readJson<T>(path: string): T {
  if (!existsSync(path))
    throw new Error(`Missing ${path}. Run build:content and build:spa first.`);
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadSite(): { site: SiteMeta; nav: { label: string; path: string }[] } {
  const config = parseSiteConfig();
  if (config.url === undefined || config.description === undefined) {
    throw new Error(
      'content/site.yml: "url" and "description" are required for page metadata.',
    );
  }
  return {
    site: { title: config.title, description: config.description, url: config.url },
    nav: config.nav ?? [],
  };
}

function docPages(
  type: string,
  build: MetaBuilder,
  site: SiteMeta,
  dist: string,
): PageMeta[] {
  const index = readJson<{ items: { slug: string; path: string }[] }>(
    join(dist, 'data', type, 'index.json'),
  );
  return index.items.map((item) =>
    build(item.slug, readJson<Doc>(join(dist, item.path)), site),
  );
}

export function verifyPage(meta: PageMeta, site: SiteMeta, dist = DIST): string[] {
  const file = join(dist, pageFile(meta.path));
  if (!existsSync(file)) return [`${file}: page was not written`];
  const html = readFileSync(file, 'utf-8');
  const errors: string[] = [];
  if (
    !html.includes(
      `<meta property="og:image" content="${absoluteUrl(site, meta.image)}" />`,
    )
  ) {
    errors.push(`${file}: missing absolute og:image`);
  }
  if (!existsSync(join(dist, meta.image))) {
    errors.push(`${file}: og:image ${meta.image} does not exist in ${dist}/`);
  }
  if (meta.title.trim() === '' || meta.description.trim() === '') {
    errors.push(`${file}: empty title or description`);
  }
  return errors;
}

/** Writes a preview page per route into `dist` and returns the pages plus any verification errors. */
export function buildPages(dist = DIST): { pages: PageMeta[]; errors: string[] } {
  const { site, nav } = loadSite();
  const template = readFileSync(join(dist, 'index.html'), 'utf-8');
  const pages = [
    ...nav.map((item) => sectionMeta(item.label, item.path, site)),
    ...docPages('events', eventMeta, site, dist),
    ...docPages('posts', postMeta, site, dist),
    ...docPages('members', memberMeta, site, dist),
  ];

  for (const meta of pages) {
    const file = join(dist, pageFile(meta.path));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, applyPageMeta(template, meta, site));
  }

  const errors = pages.flatMap((meta) => verifyPage(meta, site, dist));
  if (existsSync(join(dist, '404.html'))) {
    errors.push(`${dist}/404.html exists; it disables Cloudflare Pages' SPA fallback.`);
  }
  return { pages, errors };
}

function main() {
  console.log('\n  Building page metadata...\n');
  const { pages, errors } = buildPages();
  if (errors.length > 0) {
    for (const error of errors) console.error(`    ${error}`);
    console.error(`\n  Page build failed. ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log(`  [pages] ${pages.length} pages written with preview metadata.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error('Page build failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
