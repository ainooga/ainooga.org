import { readFileSync, existsSync } from 'node:fs';
import { globSync } from 'node:fs';
import matter from 'gray-matter';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import {
  PostFrontmatter,
  EventFrontmatter,
  MemberFrontmatter,
  SponsorFrontmatter,
  SiteConfig,
  type ParsedDoc,
  type ContentType,
} from './types.js';

const FRONTMATTER_SCHEMAS: Record<ContentType, z.ZodType> = {
  posts: PostFrontmatter,
  events: EventFrontmatter,
  members: MemberFrontmatter,
  sponsors: SponsorFrontmatter,
};

function globContent(type: ContentType): string[] {
  const pattern = `content/${type}/**/*.md`;
  return globSync(pattern);
}

function slugFromPath(filePath: string): string {
  const basename = filePath.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

type FieldError = {
  filePath: string;
  field: string;
  message: string;
};

function validateFrontmatter(
  type: ContentType,
  data: Record<string, unknown>,
  filePath: string,
): { data: Record<string, unknown>; errors: FieldError[] } {
  const schema = FRONTMATTER_SCHEMAS[type];
  const result = schema.safeParse(data);

  if (result.success) {
    return { data: result.data as Record<string, unknown>, errors: [] };
  }

  const validationError = fromZodError(result.error, {
    prefix: filePath,
    prefixSeparator: ': ',
  });

  const errors: FieldError[] = result.error.issues.map((issue) => ({
    filePath,
    field: issue.path.join('.'),
    message: issue.message,
  }));

  return { data, errors };
}

export function parseSiteConfig(): SiteConfig {
  const path = 'content/site.yml';
  if (!existsSync(path)) {
    throw new Error('content/site.yml not found');
  }
  const raw = readFileSync(path, 'utf-8');
  const parsed = matter(raw);
  const result = SiteConfig.safeParse(parsed.data);
  if (!result.success) {
    const err = fromZodError(result.error, {
      prefix: path,
      prefixSeparator: ': ',
    });
    throw new Error(err.message);
  }
  return result.data;
}

export function parseAll(): { docs: ParsedDoc[]; errors: FieldError[] } {
  const types: ContentType[] = ['posts', 'events', 'members', 'sponsors'];
  const docs: ParsedDoc[] = [];
  const allErrors: FieldError[] = [];

  for (const type of types) {
    const files = globContent(type);
    for (const filePath of files) {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = matter(raw);
      const slug = slugFromPath(filePath);
      const { data, errors } = validateFrontmatter(type, parsed.data as Record<string, unknown>, filePath);
      allErrors.push(...errors);
      if (errors.length === 0) {
        docs.push({ type, slug, frontmatter: data, body: parsed.content, filePath });
      }
    }
  }

  return { docs, errors: allErrors };
}
