import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function reject(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}

function contentType(request: Request): string {
  return request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
}

export async function jsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (contentType(request) !== 'application/json')
    reject(415, 'content_type', 'Use application/json.');
  const reader = request.body?.getReader();
  if (!reader) reject(400, 'invalid_body', 'A JSON body is required.');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      reject(413, 'body_too_large', 'Request body exceeds 16 KiB.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    const result = schema.safeParse(JSON.parse(text + decoder.decode()));
    if (result.success) return result.data;
  } catch {
    /* Invalid JSON uses the same safe response as invalid fields. */
  }
  return reject(400, 'invalid_body', 'Invalid request fields or JSON.');
}

export function apiFailure(error: unknown): Response {
  const requestId = crypto.randomUUID();
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code, requestId },
      {
        status: error.status,
        headers: error.status === 429 ? { 'Retry-After': '60' } : {},
      },
    );
  }
  console.error(JSON.stringify({ event: 'api_error', requestId }));
  return Response.json(
    { error: 'Something went wrong.', code: 'internal', requestId },
    { status: 500 },
  );
}

export function requireOrigin(request: Request, siteUrl: string): void {
  if (request.headers.get('Origin') !== new URL(siteUrl).origin)
    reject(403, 'origin', 'This request must come from the site.');
}
