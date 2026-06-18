import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

interface VerifyResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
}

function checkVersionFile(errors: string[]): void {
  const versionPath = 'static/data/version.json';
  if (!existsSync(versionPath)) {
    errors.push(`Missing version file: ${versionPath}`);
    return;
  }
  try {
    const v = JSON.parse(readFileSync(versionPath, 'utf-8'));
    if (typeof v.v !== 'string' || v.v === '') {
      errors.push(`${versionPath}: missing or invalid "v" field`);
    }
  } catch {
    errors.push(`Invalid JSON: ${versionPath}`);
  }
}

function checkIndexFile(type: string, errors: string[], warnings: string[]): void {
  const indexPath = `static/data/${type}/index.json`;
  if (!existsSync(indexPath)) {
    errors.push(`Missing index file: ${indexPath}`);
    return;
  }

  let index: { items?: unknown[]; meta?: { total?: number } };
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    errors.push(`Invalid JSON: ${indexPath}`);
    return;
  }

  if (!Array.isArray(index.items)) {
    errors.push(`${indexPath}: missing or invalid "items" array`);
    return;
  }

  if (typeof index.meta?.total !== 'number') {
    errors.push(`${indexPath}: missing or invalid "meta.total"`);
  }

  for (const item of index.items) {
    checkDocFile(item as Record<string, unknown>, indexPath, errors, warnings);
  }
}

function checkDocFile(
  item: Record<string, unknown>,
  indexPath: string,
  errors: string[],
  warnings: string[],
): void {
  const docPath = `static${String(item.path)}`;
  if (!existsSync(docPath)) {
    errors.push(`Missing doc file: ${docPath} (referenced from ${indexPath})`);
    return;
  }
  try {
    const doc: Record<string, unknown> = JSON.parse(readFileSync(docPath, 'utf-8'));
    const bodyHtml = doc.bodyHtml;
    if (typeof bodyHtml !== 'string' || bodyHtml === '') {
      warnings.push(`${docPath}: missing bodyHtml`);
    }
  } catch {
    errors.push(`Invalid JSON: ${docPath}`);
  }
}

function checkImageRef(
  warnings: string[],
  file: string,
  img: Record<string, unknown>,
): void {
  const src = img.src;
  if (typeof src !== 'string' || src === '') return;
  if (src.startsWith('http')) return;
  const imgPath = `static${src}`;
  if (!existsSync(imgPath)) {
    warnings.push(`Missing image: ${imgPath} (referenced from ${file})`);
  }
}

function checkImageRefs(warnings: string[]): void {
  const allJsonFiles = globSync('static/data/**/*.json');
  for (const file of allJsonFiles) {
    try {
      const data: Record<string, unknown> = JSON.parse(readFileSync(file, 'utf-8'));
      const images = data.images;
      if (!Array.isArray(images)) continue;
      for (const img of images) {
        checkImageRef(warnings, file, img as Record<string, unknown>);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }
}

export function verifyOutput(): VerifyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  checkVersionFile(errors);

  const types = ['posts', 'events', 'members', 'sponsors'];
  for (const type of types) {
    checkIndexFile(type, errors, warnings);
  }

  checkImageRefs(warnings);

  return {
    pass: errors.length === 0,
    errors,
    warnings,
  };
}
