import { reject } from './auth/http.js';
import { normalizeEmail, validEmail } from './db/identifiers.js';
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
  const address = typeof input.email === 'string' ? normalizeEmail(input.email) : '';
  if (!validEmail(address)) {
    return Response.json({ error: 'Valid email required' }, { status: 400 });
  }

  const turnstileOk = await deps.turnstile.verify(input.turnstileToken);
  if (!turnstileOk) {
    return Response.json({ error: 'Verification failed. Try again.' }, { status: 400 });
  }

  const token = crypto.randomUUID();
  const created = await deps.db.insertSubscriber(address, input.name ?? null, token);
  if (!created) {
    return Response.json(
      { message: 'A subscription request already exists for this address.' },
      { status: 200 },
    );
  }

  try {
    await deps.email.sendConfirmation(address, input.name ?? null, token, deps.siteUrl);
  } catch {
    await deps.db.invalidateConfirmation(token);
    reject(
      503,
      'delivery_unavailable',
      'Confirmation email could not be sent. Please try again.',
    );
  }

  return Response.json({ message: 'Check your email to confirm.' }, { status: 201 });
}
