import { createDb } from './api/_adapters.js';

interface Env {
  DB: D1Database;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Missing confirmation token', { status: 400 });
  }

  const db = createDb(context.env.DB);
  const changes = await db.confirmSubscription(token);

  if (changes === 0) {
    return new Response('Invalid or expired token', { status: 404 });
  }

  return new Response(
    "<html><body><h1>Confirmed!</h1><p>You're on the AI Nooga mailing list.</p></body></html>",
    { headers: { 'Content-Type': 'text/html' } },
  );
};
