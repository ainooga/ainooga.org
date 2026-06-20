import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProcessedDoc, ContentType } from './types.js';
import { getBuildVersion } from './version.js';

interface IndexItem {
  slug: string;
  title: string;
  date: string;
  excerpt?: string;
  tags: string[];
  path: string;
  location?: string;
  endDate?: string;
}

interface ContentIndex {
  updatedAt: string;
  items: IndexItem[];
  meta: {
    total: number;
    tags: string[];
  };
}

function buildIndex(docs: ProcessedDoc[]): ContentIndex {
  const items: IndexItem[] = [];
  const tagSet = new Set<string>();

  for (const doc of docs) {
    const data = doc.data as Record<string, unknown>;
    const tags = (data.tags as string[]) ?? [];
    tags.forEach((t) => tagSet.add(t));

    const item: IndexItem = {
      slug: doc.slug,
      title: (data.title as string) ?? (data.name as string) ?? doc.slug,
      date: (data.date as string) ?? '',
      excerpt: data.excerpt as string | undefined,
      tags,
      path: `/data/${doc.type}/${doc.slug}.json`,
      location: data.location as string | undefined,
      endDate: data.endDate as string | undefined,
    };
    items.push(item);
  }

  return {
    updatedAt: new Date().toISOString(),
    items,
    meta: {
      total: items.length,
      tags: [...tagSet].sort((a, b) => a.localeCompare(b)),
    },
  };
}

export function emitAll(docs: ProcessedDoc[]): void {
  const byType = new Map<ContentType, ProcessedDoc[]>();

  for (const doc of docs) {
    const existing = byType.get(doc.type) ?? [];
    existing.push(doc);
    byType.set(doc.type, existing);
  }

  const dataDir = 'static/data';
  mkdirSync(dataDir, { recursive: true });

  // Write version file
  const version = getBuildVersion();
  const versionPath = join(dataDir, 'version.json');
  writeFileSync(
    versionPath,
    JSON.stringify({ v: version, updatedAt: new Date().toISOString() }, null, 2),
  );

  // Write per-doc JSON and collect for index
  for (const [type, typeDocs] of byType) {
    const typeDir = join(dataDir, type);
    mkdirSync(typeDir, { recursive: true });

    for (const doc of typeDocs) {
      const detail = {
        slug: doc.slug,
        ...doc.data,
        bodyHtml: doc.bodyHtml,
        images: doc.images,
      };
      const outPath = join(typeDir, `${doc.slug}.json`);
      writeFileSync(outPath, JSON.stringify(detail, null, 2));
    }

    // Write index
    const index = buildIndex(typeDocs);
    writeFileSync(join(typeDir, 'index.json'), JSON.stringify(index, null, 2));
  }
}
