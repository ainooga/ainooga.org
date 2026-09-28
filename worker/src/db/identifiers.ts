export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function validEmail(email: string): boolean {
  const parts = email.split('@');
  if (parts.length !== 2 || /\s/.test(email)) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
