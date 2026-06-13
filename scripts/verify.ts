import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

interface VerifyResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
}

export function verifyOutput(): VerifyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check that data JSON files exist
  const types = ['posts', 'events', 'members', 'sponsors'];
  for (const type of types) {
    const indexPath = `static/data/${type}/index.json`;
    if (!existsSync(indexPath)) {
      errors.push(`Missing index file: ${indexPath}`);
      continue;
    }

    try {
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
      if (!index.items || !Array.isArray(index.items)) {
        errors.push(`${indexPath}: missing or invalid "items" array`);
        continue;
      }
      if (typeof index.meta?.total !== 'number') {
        errors.push(`${indexPath}: missing or invalid "meta.total"`);
      }

      // Check individual doc files
      for (const item of index.items) {
        const docPath = `static${item.path}`;
        if (!existsSync(docPath)) {
          errors.push(`Missing doc file: ${docPath} (referenced from ${indexPath})`);
          continue;
        }
        try {
          const doc = JSON.parse(readFileSync(docPath, 'utf-8'));
          if (!doc.bodyHtml && type !== 'sponsors') {
            warnings.push(`${docPath}: missing bodyHtml`);
          }
        } catch {
          errors.push(`Invalid JSON: ${docPath}`);
        }
      }
    } catch {
      errors.push(`Invalid JSON: ${indexPath}`);
    }
  }

  // Check for broken image refs in data JSON
  const allJsonFiles = globSync('static/data/**/*.json');
  for (const file of allJsonFiles) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      if (data.images && Array.isArray(data.images)) {
        for (const img of data.images) {
          if (img.src && !img.src.startsWith('http')) {
            const imgPath = `static${img.src}`;
            if (!existsSync(imgPath)) {
              warnings.push(`Missing image: ${imgPath} (referenced from ${file})`);
            }
          }
        }
      }
    } catch {
      // Skip files that can't be parsed (shouldn't happen if emit worked)
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
  };
}
