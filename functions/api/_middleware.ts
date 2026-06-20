export const onRequest: PagesFunction = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': context.request.headers.get('Origin') ?? '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      },
    });
  }

  const response = await context.next();

  const origin = context.request.headers.get('Origin');
  if (origin && isAllowedOrigin(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  response.headers.set('X-Robots-Tag', 'noindex');

  return response;
};

function isAllowedOrigin(origin: string): boolean {
  const allowed = [
    'https://ainooga.org',
    'https://www.ainooga.org',
    /^https:\/\/[a-z0-9-]+\.ainooga-org\.pages\.dev$/,
    /^http:\/\/localhost:\d+$/,
  ];
  return allowed.some((a) => (typeof a === 'string' ? a === origin : a.test(origin)));
}
