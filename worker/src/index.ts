import { handleSubscribe } from './subscribe.js';
import { handleContactSponsor } from './contact-sponsor.js';
import { handleConfirm } from './confirm.js';
import { createDb, createEmailSender, createTurnstileVerifier } from './adapters.js';
import type { Env } from './types.js';

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = [
    'https://ainooga.org',
    'https://www.ainooga.org',
    /^https:\/\/[a-z0-9-]+\.ainooga-org\.pages\.dev$/,
    /^http:\/\/localhost:\d+$/,
  ];

  const match =
    origin &&
    allowed.some((a) => (typeof a === 'string' ? a === origin : a.test(origin)));

  return {
    'Access-Control-Allow-Origin': match ? origin : 'https://ainooga.org',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Robots-Tag': 'noindex',
    Vary: 'Origin',
  };
}

function attachCors(response: Response, origin: string | null): void {
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    response.headers.set(key, value);
  }
}

async function dispatch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/subscribe' && request.method === 'POST') {
    const body = (await request.json()) as {
      email: string;
      name?: string;
      turnstileToken: string;
    };
    return await handleSubscribe(
      { email: body.email, name: body.name, turnstileToken: body.turnstileToken },
      {
        db: createDb(env.DB),
        email: createEmailSender(env.EMAIL),
        turnstile: createTurnstileVerifier(env.TURNSTILE_SECRET_KEY),
        siteUrl: env.SITE_URL,
      },
    );
  }

  if (url.pathname === '/api/contact-sponsor' && request.method === 'POST') {
    const body = (await request.json()) as {
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
        db: createDb(env.DB),
        turnstile: createTurnstileVerifier(env.TURNSTILE_SECRET_KEY),
      },
    );
  }

  if (url.pathname === '/confirm' && request.method === 'GET') {
    return await handleConfirm(request, env);
  }

  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      const response = await dispatch(request, env);
      attachCors(response, origin);
      return response;
    } catch (err) {
      console.error('Worker error:', err);
      const errorResponse = Response.json(
        { error: 'Something went wrong.' },
        { status: 500 },
      );
      attachCors(errorResponse, origin);
      return errorResponse;
    }
  },
};
