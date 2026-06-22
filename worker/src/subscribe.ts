import type { DbClient, EmailSender, TurnstileVerifier } from './types.js';

export interface SubscribeInput {
  email: string;
  name?: string;
  turnstileToken: string;
}

export async function handleSubscribe(
  input: SubscribeInput,
  deps: {
    db: DbClient;
    email: EmailSender;
    turnstile: TurnstileVerifier;
    siteUrl: string;
  },
): Promise<Response> {
  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return Response.json({ error: 'Valid email required' }, { status: 400 });
  }

  const turnstileOk = await deps.turnstile.verify(input.turnstileToken);
  if (!turnstileOk) {
    return Response.json({ error: 'Verification failed. Try again.' }, { status: 400 });
  }

  const existing = await deps.db.findSubscriberByEmail(input.email);
  if (existing) {
    return Response.json({ message: 'Already subscribed!' }, { status: 200 });
  }

  const token = crypto.randomUUID();
  await deps.db.insertSubscriber(input.email, input.name ?? null, token);
  await deps.email.sendConfirmation(input.email, input.name ?? null, token, deps.siteUrl);

  return Response.json({ message: 'Check your email to confirm.' }, { status: 201 });
}
