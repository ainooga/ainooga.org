import { z } from 'zod';

const turnstileToken = z.string().min(1).max(2048);
export const subscribeSchema = z
  .object({
    email: z.string().trim().max(254).email(),
    name: z.string().max(200).optional(),
    turnstileToken,
  })
  .strict();
export const sponsorSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: z.string().min(1).max(100),
    preferredDate: z.string().max(40).optional(),
    preferredTime: z.string().max(40).optional(),
    turnstileToken,
  })
  .strict();
