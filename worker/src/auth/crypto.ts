export { hashToken } from '../db/identifiers.js';

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export function randomCode(): string {
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0]! >= 4294000000);
  return String(values[0]! % 1000000).padStart(6, '0');
}

export async function codeHash(
  secret: string,
  id: string,
  code: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const result = await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}:${code}`));
  return Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function sameHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++)
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
