import { createDb } from './adapters.js';
import type { Env } from './types.js';

export async function handleConfirm(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Missing confirmation token', { status: 400 });
  }

  const db = createDb(env.DB);
  const changes = await db.confirmSubscription(token);

  if (changes === 0) {
    return new Response('Invalid or expired token', { status: 404 });
  }

  return new Response(
    "<html><body><h1>Confirmed!</h1><p>You're on the AI Nooga mailing list.</p></body></html>",
    { headers: { 'Content-Type': 'text/html' } },
  );
}
