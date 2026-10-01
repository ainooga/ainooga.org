import { maintenanceResponse } from './maintenance.js';
import { handleSubscribe } from './subscribe.js';
import { handleContactSponsor } from './contact-sponsor.js';
import { handleConfirm } from './confirm.js';
import { createDb, createEmailSender, createTurnstileVerifier } from './adapters.js';
import type { Env } from './types.js';
import { handleAuth, isAuthRoute } from './auth/router.js';
import { cleanupAuth } from './auth/cleanup.js';
import type { AuthContext } from './auth/types.js';
import { apiFailure, jsonBody } from './auth/http.js';
import { subscribeSchema, sponsorSchema } from './form-schemas.js';

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
    const body = await jsonBody(request, subscribeSchema);
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
    const body = await jsonBody(request, sponsorSchema);
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
  async fetch(request: Request, env: Env, context: AuthContext): Promise<Response> {
    if (isAuthRoute(new URL(request.url).pathname))
      return handleAuth(request, env, context);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      const response =
        maintenanceResponse(request, env.CHAPTER_SCHEMA_READY) ??
        (await dispatch(request, env));
      attachCors(response, origin);
      return response;
    } catch (error) {
      const errorResponse = apiFailure(error);
      attachCors(errorResponse, origin);
      return errorResponse;
    }
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (env.AUTH_READY !== 'true') return;
    const result = await cleanupAuth(env.DB, new Date());
    if (result.capped)
      console.warn(JSON.stringify({ event: 'auth_cleanup_capped', ...result }));
  },
};
