import type { DbClient, TurnstileVerifier } from './types.js';

export interface ContactSponsorInput {
  name: string;
  phone: string;
  preferredDate?: string;
  preferredTime?: string;
  turnstileToken: string;
}

export async function handleContactSponsor(
  input: ContactSponsorInput,
  deps: { db: DbClient; turnstile: TurnstileVerifier },
): Promise<Response> {
  if (!input.name?.trim() || !input.phone?.trim()) {
    return Response.json({ error: 'Name and phone required.' }, { status: 400 });
  }

  const turnstileOk = await deps.turnstile.verify(input.turnstileToken);
  if (!turnstileOk) {
    return Response.json({ error: 'Verification failed. Try again.' }, { status: 400 });
  }

  await deps.db.insertContactRequest({
    name: input.name,
    phone: input.phone,
    preferredDate: input.preferredDate,
    preferredTime: input.preferredTime,
  });

  return Response.json({ message: "Thanks! We'll call you back." }, { status: 201 });
}
