import { handleSubscribe } from '../lib/subscribe.logic.js';
import { createDb, createEmailSender, createTurnstileVerifier } from './_adapters.js';

interface Env {
  DB: D1Database;
  EMAIL: SendEmail;
  TURNSTILE_SECRET_KEY: string;
  SITE_URL: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await context.request.json()) as {
      email: string;
      name?: string;
      turnstileToken: string;
    };

    return await handleSubscribe(
      { email: body.email, name: body.name, turnstileToken: body.turnstileToken },
      {
        db: createDb(context.env.DB),
        email: createEmailSender(context.env.EMAIL),
        turnstile: createTurnstileVerifier(context.env.TURNSTILE_SECRET_KEY),
        siteUrl: context.env.SITE_URL,
      },
    );
  } catch (err) {
    console.error('Subscribe error:', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
};
