const formRoutes = new Set(['/api/subscribe', '/api/contact-sponsor', '/confirm']);

export function maintenanceResponse(
  request: Request,
  ready: string | undefined,
): Response | null {
  const path = new URL(request.url).pathname;
  if (ready === 'true' || !formRoutes.has(path)) return null;
  const message =
    'Forms are temporarily unavailable for maintenance. Please try again shortly.';
  const headers = {
    'Retry-After': '60',
    'Cache-Control': 'no-store',
    'X-Chapter-Maintenance': 'true',
  };
  return path === '/confirm'
    ? new Response(message, { status: 503, headers })
    : Response.json({ error: message }, { status: 503, headers });
}
