import { z } from 'zod';

export const eventSlugSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const invitationTagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => value === value.toLowerCase(), 'Tags must be lowercase.'),
  )
  .max(50)
  .refine((tags) => new Set(tags).size === tags.length, 'Tags must be unique.');
export const invitationMessageSchema = z.string().trim().min(1).max(8000);
export const eventLinksSchema = z.array(
  z
    .object({
      platform: z.string().trim().min(1),
      url: z
        .string()
        .url()
        .refine((value) => {
          try {
            const url = new URL(value);
            return (
              url.protocol === 'https:' && url.username === '' && url.password === ''
            );
          } catch {
            return false;
          }
        }, 'Use an HTTPS URL without credentials.'),
    })
    .strict(),
);
export type EventLinksType = z.infer<typeof eventLinksSchema>;
export const invitationSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    date: z.string().datetime(),
    endDate: z.string().datetime().optional(),
    timezone: z
      .string()
      .optional()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value ?? 'UTC' });
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid timezone.'),
    location: z.string().trim().min(1).max(1000),
    status: z.literal('published'),
    inviteTags: invitationTagsSchema.refine(
      (tags) => tags.length > 0,
      'Configure at least one invitation tag.',
    ),
    inviteMessage: invitationMessageSchema.optional(),
    links: eventLinksSchema.optional(),
  })
  .strict()
  .refine(
    (event) => !event.endDate || new Date(event.endDate) > new Date(event.date),
    'End date must be after the start date.',
  );
export type EventInvitationType = z.infer<typeof invitationSchema> & { slug: string };
export const invitationPreviewSchema = z
  .object({
    recipients: z.number().int().nonnegative(),
    subject: z.string(),
    text: z.string(),
    html: z.string(),
  })
  .strict();
