import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { marked } from 'marked';
import type { ParsedDoc, ProcessedDoc } from './types.js';

interface ImageRef {
  src: string;
  alt: string;
}

function resolveImagePath(src: string): string {
  // If it starts with ./ or ../, resolve relative to content dir
  if (src.startsWith('./') || src.startsWith('../')) {
    // For now, place images under static/images/ with the same basename
    const parts = src.split('/');
    const filename = parts[parts.length - 1] ?? '';
    const name = filename.replace(/\.[^.]+$/, '');
    return `/images/${name}-800w.webp`;
  }
  if (src.startsWith('/')) return src;
  return `/images/${src}`;
}

const PREVIEW_SOURCE = /\.(jpe?g|png|tiff)$/i;
const FRONTMATTER_IMAGES = ['banner', 'avatar', 'logo'] as const;

/** Maps a content-relative raster image ref to its processed Open Graph JPEG. */
export function ogImagePath(src: string): string | undefined {
  if (!(src.startsWith('./') || src.startsWith('../')) || !PREVIEW_SOURCE.test(src)) {
    return undefined;
  }
  const name = (src.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
  return `/images/${name}-og.jpg`;
}

/** First existing raster image among raw content refs, as an OG image path. */
function pickOgImage(filePath: string, sources: unknown[]): string | undefined {
  return sources
    .filter((src): src is string => typeof src === 'string')
    .filter((src) => existsSync(join(dirname(filePath), src)))
    .map(ogImagePath)
    .find((path) => path !== undefined);
}

export function renderDoc(doc: ParsedDoc): ProcessedDoc {
  const frontmatter = doc.frontmatter;
  const images: ImageRef[] = [];
  const previewSources: unknown[] = [
    frontmatter.banner,
    frontmatter.avatar,
    frontmatter.logo,
  ];

  // Process banner/avatar image refs in frontmatter
  for (const field of FRONTMATTER_IMAGES) {
    const value = frontmatter[field];
    if (typeof value === 'string') frontmatter[field] = resolveImagePath(value);
  }

  // Configure marked to rewrite image srcs
  const renderer = new marked.Renderer();
  renderer.image = ({
    href,
    title,
    text,
  }: {
    href: string;
    title: string | null;
    text: string;
  }): string => {
    const resolved = resolveImagePath(href);
    const alt = text ? ` alt="${text.replace(/"/g, '&quot;')}"` : '';
    const titleAttr = title != null && title !== '' ? ` title="${title}"` : '';
    images.push({ src: resolved, alt: text });
    previewSources.push(href);
    return `<img src="${resolved}"${alt}${titleAttr} loading="lazy">`;
  };

  marked.use({ renderer });

  const bodyHtml = marked.parse(doc.body, { async: false }) as string;
  const ogImage = pickOgImage(doc.filePath, previewSources);

  return {
    type: doc.type,
    slug: doc.slug,
    data: frontmatter,
    bodyHtml,
    images,
    ogImage,
    filePath: doc.filePath,
  };
}

export function renderAll(docs: ParsedDoc[]): ProcessedDoc[] {
  return docs.map(renderDoc);
}
