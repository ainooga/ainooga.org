import { z } from 'zod';
export type Row = Record<string, string | number | null>;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable();
const timestamp = z.string().datetime({ precision: 3 });
export function linkedinUrl(value: string): string {
  const url = new URL(value, 'https://www.linkedin.com');
  if (
    url.protocol !== 'https:' ||
    !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname === '/'
  )
    throw new Error('Invalid LinkedIn URL.');
  return url.href;
}
function isLinkedin(value: string): boolean {
  try {
    linkedinUrl(value);
    return value.startsWith('/') || /^https:\/\//i.test(value);
  } catch {
    return false;
  }
}
function isHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export const eventSchema = z
  .object({
    platform: text(64).regex(/^[a-z][a-z0-9_]*$/),
    externalId: text(256),
    url: text(2048).refine(isHttps),
    name: text(300),
    startsAt: timestamp,
    endsAt: timestamp.nullable(),
    timezone: text(100).refine(isTimezone).nullable(),
    location: optionalText(1000),
    capacity: z.number().int().min(0).max(1000000).nullable(),
  })
  .strict()
  .refine((e) => e.endsAt === null || e.endsAt > e.startsAt, { path: ['endsAt'] });

export const memberSchema = z
  .object({
    source: text(64).regex(/^[a-z][a-z0-9_]*$/),
    sourceKey: text(256),
    email: text(254).email(),
    name: optionalText(200),
    company: optionalText(200),
    professionalRole: optionalText(200),
    phone: text(64)
      .regex(/^\+?[\d ().-]+$/)
      .refine((v) => /^\+?\d{7,20}$/.test(normalizePhone(v)))
      .nullable(),
    linkedin: text(2048).refine(isLinkedin).nullable(),
    tags: z.array(text(64).refine((v) => v === v.toLowerCase())).max(25),
    eventInvites: z
      .object({
        subscribed: z.boolean(),
        unsubscribedAt: timestamp.nullable(),
      })
      .strict()
      .refine((v) => !v.subscribed || v.unsubscribedAt === null),
    participations: z
      .array(
        z
          .object({
            event: eventSchema,
            registrationStatus: z.enum([
              'invited',
              'approved',
              'pending_approval',
              'declined',
              'waitlist',
              'cancelled',
            ]),
          })
          .strict(),
      )
      .max(25),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = value.participations.map((p) => eventKey(p.event));
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['participations'],
        message: 'Duplicate event.',
      });
    if (new Set(value.tags).size !== value.tags.length)
      ctx.addIssue({ code: 'custom', path: ['tags'], message: 'Duplicate tag.' });
  });

export type MemberInput = z.infer<typeof memberSchema>;
export type ImportEvent = z.infer<typeof eventSchema>;
export function eventKey(event: Pick<ImportEvent, 'platform' | 'externalId'>): string {
  return JSON.stringify([event.platform, event.externalId]);
}
export function normalizePhone(value: string): string {
  return value.replace(/[ ().-]/g, '');
}
export function contacts(input: MemberInput) {
  const result: { kind: string; value: string; normalized: string }[] = [];
  if (input.phone !== null)
    result.push({
      kind: 'phone',
      value: input.phone,
      normalized: normalizePhone(input.phone),
    });
  if (input.linkedin !== null)
    result.push({
      kind: 'linkedin',
      value: input.linkedin,
      normalized: linkedinUrl(input.linkedin),
    });
  return result;
}
