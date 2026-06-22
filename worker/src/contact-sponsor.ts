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
  deps: {
    db: DbClient;
    turnstile: TurnstileVerifier;
  },
): Promise<Response> {
  if (!input.name.trim() || !input.phone.trim()) {
    return Response.json({ error: 'Name and phone number required.' }, { status: 400 });
  }

  const phoneClean = input.phone.replace(/[\s()-]/g, '');
  if (phoneClean.length < 7) {
    return Response.json({ error: 'Valid phone number required.' }, { status: 400 });
  }

  const turnstileOk = await deps.turnstile.verify(input.turnstileToken);
  if (!turnstileOk) {
    return Response.json({ error: 'Verification failed. Try again.' }, { status: 400 });
  }

  await deps.db.insertContactRequest({
    name: input.name,
    phone: phoneClean,
    preferredDate: input.preferredDate,
    preferredTime: input.preferredTime,
  });

  return Response.json(
    { message: `Thanks ${input.name}! We'll call you back.` },
    { status: 201 },
  );
}
