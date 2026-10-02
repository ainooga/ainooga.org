import { z } from 'zod';

export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
function validDeadline(p: {
  editDeadline: string | null;
  allowEdits: boolean;
  startsAt: string;
  endsAt: string;
}): boolean {
  return (
    p.editDeadline === null ||
    (p.allowEdits && p.editDeadline > p.startsAt && p.editDeadline <= p.endsAt)
  );
}
const label = z.string().trim().min(1).max(200);
export const identifier = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('email'), value: z.string().trim().max(254).email() })
    .strict(),
  z
    .object({ kind: z.literal('discord'), value: z.string().regex(/^\d{17,20}$/) })
    .strict(),
]);
const date = z
  .string()
  .datetime()
  .transform((value) => new Date(value).toISOString());
const tag = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((v) => v === v.toLowerCase(), 'Tags must be lowercase.');
export const pollSchema = z
  .object({
    slug: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(8000),
    identityMode: z.enum(['honor', 'verified']),
    minSelections: z.number().int().min(1).max(100),
    maxSelections: z.number().int().min(1).max(100).nullable(),
    allowWriteIns: z.boolean(),
    resultsVisibility: z.enum(['before_vote', 'after_vote', 'never']),
    startsAt: date,
    endsAt: date,
    allowEdits: z.boolean(),
    editDeadline: date.nullable(),
    options: z.array(label).max(100),
    eligibleTags: z.array(tag).max(50),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (field: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [field], message });
    if (p.endsAt <= p.startsAt) issue('endsAt', 'Must be after startsAt.');
    if (p.maxSelections !== null && p.maxSelections < p.minSelections)
      issue('maxSelections', 'Must be at least minSelections.');
    if (!validDeadline(p))
      issue(
        'editDeadline',
        'Requires edits and a deadline after start and at or before end.',
      );
    if (new Set(p.options.map(normalizeLabel)).size !== p.options.length)
      issue('options', 'Labels must be unique ignoring case and whitespace.');
    if (new Set(p.eligibleTags).size !== p.eligibleTags.length)
      issue('eligibleTags', 'Tags must be unique.');
    if (p.minSelections > p.options.length + Number(p.allowWriteIns))
      issue(
        'minSelections',
        'Not enough available options (including at most one new write-in).',
      );
  });
export type PollInput = z.infer<typeof pollSchema>;
export const eligibilitySchema = z
  .object({
    action: z.enum(['add', 'revoke']),
    identifiers: z.array(identifier).min(1).max(50),
  })
  .strict();
export const eligibilityFileSchema = z.array(identifier).min(1).max(10000);
export const ballotSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().min(0).max(2147483646),
    optionIds: z.array(z.number().int().positive().safe()),
    writeIn: label.nullable(),
  })
  .strict();
export type BallotInput = z.infer<typeof ballotSchema>;
