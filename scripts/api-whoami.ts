import { z } from 'zod';

async function main(): Promise<void> {
  const token = process.env.AINOOGA_API_TOKEN;
  if (token === undefined || !/^[a-f0-9]{64}$/.test(token))
    throw new Error('Set AINOOGA_API_TOKEN in your local .env file.');
  const url = new URL(
    '/api/admin/me',
    process.env.AINOOGA_API_URL ?? 'https://ainooga.org',
  );
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Use HTTPS for the API URL, except on localhost.');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`API access check failed (HTTP ${response.status}).`);
  const actor = z
    .object({ name: z.string(), personId: z.number().int().positive() })
    .parse(await response.json());
  console.log(`Authenticated as ${actor.name} (person ${actor.personId}).`);
}

main().catch(() => {
  console.error(
    'API access check failed. Check your .env token, API URL, and Worker configuration.',
  );
  process.exitCode = 1;
});
