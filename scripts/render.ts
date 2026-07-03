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

export function renderDoc(doc: ParsedDoc): ProcessedDoc {
  const frontmatter = doc.frontmatter;
  const images: ImageRef[] = [];

  // Process banner/avatar image refs in frontmatter
  if (typeof frontmatter.banner === 'string') {
    frontmatter.banner = resolveImagePath(frontmatter.banner);
  }
  if (typeof frontmatter.avatar === 'string') {
    frontmatter.avatar = resolveImagePath(frontmatter.avatar);
  }
  if (typeof frontmatter.logo === 'string') {
    frontmatter.logo = resolveImagePath(frontmatter.logo);
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
    return `<img src="${resolved}"${alt}${titleAttr} loading="lazy">`;
  };

  marked.use({ renderer });

  const bodyHtml = marked.parse(doc.body, { async: false }) as string;

  return {
    type: doc.type,
    slug: doc.slug,
    data: frontmatter,
    bodyHtml,
    images,
    filePath: doc.filePath,
  };
}

export function renderAll(docs: ParsedDoc[]): ProcessedDoc[] {
  return docs.map(renderDoc);
}
