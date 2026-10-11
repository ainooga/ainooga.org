import { z } from 'zod';

// .strict() rejects unknown keys. No .default() — absence is error.
// YAML auto-coerces ISO date strings to Date objects.
// Use z.coerce.date() which accepts string | number | Date.
const dateField = () => z.coerce.date();

export const PostFrontmatter = z
  .object({
    title: z.string().min(1).max(200),
    date: dateField(),
    author: z.string().min(1),
    tags: z.array(z.string()),
    excerpt: z.string().max(500).optional(),
    banner: z.string().optional(),
    status: z.enum(['draft', 'published']),
  })
  .strict();

const EventLink = z
  .object({
    platform: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(64),
    externalId: z.string().trim().min(1).max(256),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && url.username === '' && url.password === '';
        } catch {
          return false;
        }
      }, 'Use an HTTPS URL without credentials.'),
  })
  .strict();

export const EventFrontmatter = z
  .object({
    title: z.string().trim().min(1).max(200),
    date: dateField(),
    endDate: dateField().optional(),
    location: z.string().trim().min(1).max(1000),
    timezone: z
      .string()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid timezone.')
      .optional(),
    capacity: z.number().int().min(0).max(1000000).optional(),
    links: z
      .array(EventLink)
      .refine(
        (links) => new Set(links.map((link) => link.platform)).size === links.length,
        'Duplicate platform in event links.',
      )
      .optional(),
    organizer: z.string().min(1),
    tags: z.array(z.string()),
    excerpt: z.string().max(500).optional(),
    banner: z.string().optional(),
    status: z.enum(['draft', 'published']),
  })
  .strict()
  .refine((event) => event.endDate === undefined || event.endDate > event.date, {
    path: ['endDate'],
    message: 'End date must be after start date.',
  });

export const MemberFrontmatter = z
  .object({
    name: z.string().min(1),
    role: z.string().optional(),
    joined: dateField().optional(),
    avatar: z.string().optional(),
    tags: z.array(z.string()).optional(),
    links: z.record(z.string()).optional(),
    bio: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();

export const SponsorFrontmatter = z
  .object({
    name: z.string().min(1),
    tier: z.enum(['platinum', 'gold', 'silver', 'bronze', 'community']),
    since: dateField(),
    url: z.string().optional(),
    logo: z.string().optional(),
    description: z.string().optional(),
    featured: z.boolean().optional(),
  })
  .strict();

export const SiteConfig = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    url: z.string().optional(),
    nav: z
      .array(
        z.object({
          label: z.string(),
          path: z.string(),
        }),
      )
      .optional(),
  })
  .strict();

export type PostFrontmatterType = z.infer<typeof PostFrontmatter>;
export type EventFrontmatterType = z.infer<typeof EventFrontmatter>;
export type MemberFrontmatterType = z.infer<typeof MemberFrontmatter>;
export type SponsorFrontmatterType = z.infer<typeof SponsorFrontmatter>;
export type SiteConfigType = z.infer<typeof SiteConfig>;

export type ContentType = 'posts' | 'events' | 'members' | 'sponsors';

export interface ParsedDoc {
  type: ContentType;
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
  filePath: string;
}

export interface ProcessedDoc {
  type: ContentType;
  slug: string;
  data: Record<string, unknown>;
  bodyHtml: string;
  images: { src: string; alt: string }[];
  filePath: string;
}
