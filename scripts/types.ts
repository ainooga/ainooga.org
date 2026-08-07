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

export const EventFrontmatter = z
  .object({
    title: z.string().min(1).max(200),
    date: dateField(),
    endDate: dateField().optional(),
    location: z.string().min(1),
    organizer: z.string().min(1),
    tags: z.array(z.string()),
    excerpt: z.string().max(500).optional(),
    banner: z.string().optional(),
    status: z.enum(['draft', 'published']),
  })
  .strict();

export const MemberFrontmatter = z
  .object({
    name: z.string().min(1),
    role: z.string().optional(),
    joined: dateField().optional(),
    avatar: z.string().optional(),
    tags: z.array(z.string()).optional(),
    links: z.record(z.string()).optional(),
    bio: z.string().optional(),
    // Directory listing (IDEAS §3, §7) — opt-in gate for directory surfacing.
    listed: z.boolean().optional(),
    services: z.array(z.string()).optional(),
    rank: z.string().optional(),
    organizer: z.boolean().optional(),
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

export const ProductFrontmatter = z
  .object({
    name: z.string().min(1),
    // family groups products into membership tiers or advertising inventory.
    family: z.enum(['membership', 'advertising']),
    // Human price label, e.g. "$120 / year" or "per Winter 2026 earmark".
    price: z.string().optional(),
    // The billing/fulfillment framing shown to buyers.
    frequency: z.string().optional(),
    // Tier/products.sort weight — lower renders first.
    order: z.number().optional(),
    tagline: z.string().optional(),
    benefits: z.array(z.string()).optional(),
    // Standout product (anchor tier / flagship package).
    featured: z.boolean().optional(),
    note: z.string().optional(),
    status: z.enum(['draft', 'published']),
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
export type ProductFrontmatterType = z.infer<typeof ProductFrontmatter>;
export type SiteConfigType = z.infer<typeof SiteConfig>;

export type ContentType = 'posts' | 'events' | 'members' | 'sponsors' | 'products';

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
