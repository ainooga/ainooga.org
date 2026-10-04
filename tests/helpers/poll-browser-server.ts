// Local-only Playwright harness: real handlers/D1, functional provider fakes.
// This module is never imported by the application or Worker bundles.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { pollFixture, pollInput } from './polls';
import { handleAuth } from '../../worker/src/auth/router';

const origin = 'http://127.0.0.1:4179';
const f = await pollFixture();
const now = new Date();
await f.setTime(now.toISOString());
await f.db
  .prepare("UPDATE person_identifiers SET display_label='chapter.user' WHERE id=4")
  .run();
for (const slug of [
  'browser-vote',
  'browser-username',
  'browser-retry',
  'browser-multi',
  'browser-confirm',
  'browser-email',
  'browser-context-retry',
  'browser-write-in-reload',
  'browser-repeat-switch',
  'browser-existing-vote',
]) {
  await f.ready(
    pollInput({
      slug,
      startsAt: new Date(now.getTime() - 3600000).toISOString(),
      endsAt: new Date(now.getTime() + 86400000).toISOString(),
      maxSelections: slug === 'browser-multi' ? null : 1,
      resultsVisibility: slug === 'browser-multi' ? 'never' : 'after_vote',
    }),
  );
  await f.admin(`/${slug}/allowlist`, 'POST', {
    action: 'add',
    identifiers: [{ kind: 'email', value: 'other@example.com' }],
  });
}
f.env.SITE_URL = origin;
const vite = await createViteServer({
  server: { middlewareMode: true, hmr: false, proxy: {} },
});
async function api(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined)
      headers.set(name, Array.isArray(value) ? value.join(',') : value);
  }
  const response = await handleAuth(
    new Request(`${origin}${req.url!}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' ? undefined : new Uint8Array(Buffer.concat(chunks)),
    }),
    f.env,
    f.deps,
    f.deps,
  );
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(await response.text());
}
const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    api(req, res).catch(() => {
      res.statusCode = 500;
      res.end('Test server error');
    });
  } else vite.middlewares(req, res);
});
server.listen(4179, '127.0.0.1');
async function stop() {
  server.close();
  await vite.close();
  await f.dispose();
  process.exit(0);
}
process.on('SIGTERM', () => {
  stop().catch(() => process.exit(1));
});
process.on('SIGINT', () => {
  stop().catch(() => process.exit(1));
});
