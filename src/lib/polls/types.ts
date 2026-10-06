import { z } from 'zod';

export const ballotSchema = z
  .object({
    revision: z.number().int().positive(),
    submittedAt: z.string(),
    updatedAt: z.string(),
    optionIds: z.array(z.number().int().positive()),
  })
  .strict();
export const accessSchema = z
  .object({
    identityMode: z.enum(['honor', 'verified']),
    methods: z.array(z.enum(['honor', 'email', 'discord'])),
  })
  .strict();
export const detailSchema = z
  .object({
    sessionContext: z.string().regex(/^[a-f0-9]{64}$/),
    voter: z
      .object({ kind: z.enum(['email', 'discord']), value: z.string().min(1) })
      .strict(),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    identityMode: z.enum(['honor', 'verified']),
    minSelections: z.number().int().positive(),
    maxSelections: z.number().int().positive().nullable(),
    allowWriteIns: z.boolean(),
    resultsVisibility: z.enum(['before_vote', 'after_vote', 'never']),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    allowEdits: z.boolean(),
    editDeadline: z.string().datetime().nullable(),
    options: z.array(
      z
        .object({
          id: z.number().int().positive(),
          label: z.string(),
          description: z.string().nullable().optional(),
          origin: z.enum(['predefined', 'write_in']),
          position: z.number(),
        })
        .strict(),
    ),
    ballot: ballotSchema.nullable(),
  })
  .strict();
export const resultsSchema = z
  .object({
    eligibleCount: z.number().int().nonnegative(),
    ballotCount: z.number().int().nonnegative(),
    options: z.array(
      z
        .object({
          id: z.number().int().positive(),
          label: z.string(),
          votes: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export type Access = z.infer<typeof accessSchema>;
export type PollDetail = z.infer<typeof detailSchema>;
export type Ballot = z.infer<typeof ballotSchema>;
export type PollResults = z.infer<typeof resultsSchema>;
export interface Submission {
  requestId: string;
  sessionContext: string;
  expectedRevision: number;
  optionIds: number[];
  writeIn: string | null;
}
export interface GuestIdentifier {
  kind: 'email' | 'discord_username';
  value: string;
}
export interface PollService {
  access(slug: string): Promise<Access>;
  detail(slug: string): Promise<PollDetail>;
  results(slug: string): Promise<PollResults>;
  identify(slug: string, identifier: GuestIdentifier, token: string): Promise<void>;
  submit(slug: string, input: Submission): Promise<Ballot>;
  logout(): Promise<void>;
}
export class PollError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
