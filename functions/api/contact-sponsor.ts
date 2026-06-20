import { handleContactSponsor } from '../lib/contact-sponsor.logic.js';
import { createTurnstileVerifier, createDb } from './_adapters.js';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await context.request.json()) as {
      name: string;
      phone: string;
      preferredDate?: string;
      preferredTime?: string;
      turnstileToken: string;
    };

    return await handleContactSponsor(
      {
        name: body.name,
        phone: body.phone,
        preferredDate: body.preferredDate,
        preferredTime: body.preferredTime,
        turnstileToken: body.turnstileToken,
      },
      {
        db: createDb(context.env.DB),
        turnstile: createTurnstileVerifier(context.env.TURNSTILE_SECRET_KEY),
      },
    );
  } catch (err) {
    console.error('Contact error:', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
};
