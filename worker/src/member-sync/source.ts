import { z } from 'zod';
import { memberSchema, type MemberInput } from '../members/schemas.js';
import type { SessionCookies } from './session.js';
import { SyncError } from './state.js';

export const chapterId = 'chattanooga';
const emailSchema = z.string().trim().email().max(254);
const membershipSchema = z
  .object({
    email: emailSchema,
    allChapterIds: z.array(z.string()).refine((ids) => ids.includes(chapterId)),
  })
  .strict();
const optionalText = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullable();
const profileSchema = membershipSchema
  .extend({
    name: optionalText,
    role: optionalText,
    company: optionalText,
    phone: optionalText,
    linkedin: optionalText,
    unsubscribedFromInvites: z.boolean(),
    unsubscribedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

// Source responses include unrelated enrichment. Select the known contract before
// strict validation so private or newly added upstream fields cannot reach D1.
export function project(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SyncError('source_invalid');
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

export function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SyncError('source_invalid');
  return result.data;
}

export function normalizeRoster(value: unknown, expected: number): string[] {
  const roster = checked(
    z
      .object({
        members: z.array(z.unknown()).max(999),
        nextCursor: z.null().optional(),
      })
      .strict(),
    project(value, ['members', 'nextCursor']),
  );
  const emails = roster.members.map((member) =>
    checked(
      membershipSchema,
      project(member, Object.keys(membershipSchema.shape)),
    ).email.toLowerCase(),
  );
  if (emails.length !== expected || new Set(emails).size !== emails.length)
    throw new SyncError('source_invalid');
  return emails.sort();
}

export function normalizeMember(
  value: unknown,
  tags: unknown,
  email: string,
): MemberInput {
  const detail = checked(profileSchema, project(value, Object.keys(profileSchema.shape)));
  if (detail.email.toLowerCase() !== email) throw new SyncError('source_invalid');
  const tagValues = checked(z.array(z.string().trim().min(1)), tags);
  return checked(memberSchema, {
    source: 'ai_collective',
    sourceKey: email,
    email: detail.email,
    name: detail.name,
    professionalRole: detail.role,
    company: detail.company,
    phone: detail.phone,
    linkedin: detail.linkedin,
    tags: [...new Set(tagValues.map((tag) => tag.toLowerCase()))].sort(),
    eventInvites: {
      subscribed: !detail.unsubscribedFromInvites,
      unsubscribedAt:
        detail.unsubscribedAt === null
          ? null
          : new Date(detail.unsubscribedAt).toISOString(),
    },
    participations: [],
  });
}

export const sourceOrigin = 'https://platform.aicollective.com';
type RequestType = (request: Request) => Promise<Response>;
export interface TransportOptionsType {
  cookies: SessionCookies;
  fetch: RequestType;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  save(cookies: SessionCookies): Promise<void>;
  beforeRequest?(): Promise<void>;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new SyncError('source_invalid');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new SyncError('source_too_large');
    }
    chunks.push(new Uint8Array(part.value));
  }
  try {
    return JSON.parse(await new Blob(chunks).text()) as unknown;
  } catch {
    throw new SyncError('source_invalid');
  }
}

export class AicTransport {
  constructor(private readonly options: TransportOptionsType) {}
  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.attempt(path, init);
      if (result instanceof Response) return readJson(result);
      if (attempt === 2) throw new SyncError('source_unavailable');
      await this.options.sleep(Math.min(result ?? 1000 * 2 ** attempt, 30000));
    }
    throw new SyncError('source_unavailable');
  }
  private async attempt(
    path: string,
    init: RequestInit,
  ): Promise<Response | number | null> {
    if (!path.startsWith('/api/')) throw new SyncError('source_path_invalid');
    let response: Response;
    await this.options.beforeRequest?.();
    try {
      response = await this.options.fetch(
        new Request(sourceOrigin + path, {
          ...init,
          redirect: 'manual',
          signal: AbortSignal.timeout(20000),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Cookie: this.options.cookies.header(),
          },
        }),
      );
    } catch {
      return null;
    }
    if (this.options.cookies.update(response.headers, this.options.now()))
      await this.options.save(this.options.cookies);
    if (response.ok) return response;
    await response.body?.cancel();
    return failedResponse(response, this.options.now());
  }
  async batch(
    method: 'GET' | 'POST',
    procedures: string[],
    inputs: unknown[],
  ): Promise<unknown[]> {
    const envelope = Object.fromEntries(
      inputs.map((value, i) => [
        String(i),
        value === undefined
          ? { json: null, meta: { values: ['undefined'] } }
          : { json: value },
      ]),
    );
    const path = `/api/trpc/${procedures.join(',')}?batch=1`;
    const body =
      method === 'GET'
        ? await this.request(
            `${path}&input=${encodeURIComponent(JSON.stringify(envelope))}`,
          )
        : await this.request(path, { method: 'POST', body: JSON.stringify(envelope) });
    if (!Array.isArray(body) || body.length !== procedures.length)
      throw new SyncError('source_invalid');
    return body.map(decode);
  }
}

function failedResponse(response: Response, now: number): number | null {
  if (response.status === 401 || response.status === 403)
    throw new SyncError('authentication_required');
  if (response.status !== 429 && response.status < 500)
    throw new SyncError('source_http_error');
  const delay = retryDelay(response.headers.get('Retry-After'), now);
  if (delay !== null && delay > 30000) throw new SyncError('source_retry_later');
  return delay;
}

function decode(item: { error?: unknown; result?: { data?: unknown } }): unknown {
  if (!item || item.error || !item.result || !('data' in item.result))
    throw new SyncError('source_invalid');
  const data = item.result.data;
  return data && typeof data === 'object' && 'json' in data ? data.json : data;
}
function retryDelay(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : null;
}

export class AicSource {
  constructor(private readonly transport: AicTransport) {}
  async roster(): Promise<string[]> {
    const [user, chapters] = await this.transport.batch(
      'GET',
      ['users.getCurrent', 'chapters.getAll'],
      [undefined, undefined],
    );
    const access = checked(
      z.object({ chapterIds: z.array(z.string()) }).strict(),
      project(user, ['chapterIds']),
    );
    if (!access.chapterIds.includes(chapterId))
      throw new SyncError('chapter_access_denied');
    const matching = checked(z.array(z.unknown()), chapters)
      .map((c) => project(c, ['id', 'numMembers']))
      .filter((c) => c.id === chapterId);
    if (matching.length !== 1) throw new SyncError('source_invalid');
    const chapter = checked(
      z
        .object({ id: z.literal(chapterId), numMembers: z.number().int().min(0) })
        .strict(),
      matching[0],
    );
    const [roster] = await this.transport.batch(
      'POST',
      ['members.search.query'],
      [
        {
          chapterId,
          limit: 1000,
          sortBy: 'tier',
          sortOrder: 'asc',
          visibleColumns: [
            'name',
            'tier',
            'role',
            'company',
            'linkedin',
            'email',
            'phone',
          ],
        },
      ],
    );
    return normalizeRoster(roster, chapter.numMembers);
  }
  async member(email: string) {
    const [detail, tags] = await this.transport.batch(
      'GET',
      ['members.get', 'memberTags.getForMember'],
      [{ email }, { memberEmail: email }],
    );
    return normalizeMember(detail, tags, email);
  }
}

export async function checkSession(
  transport: AicTransport,
  email: string,
  now: number,
): Promise<void> {
  const raw = await transport.request('/api/auth/session');
  const schema = z
    .object({
      user: z.object({ email: z.string().email() }).passthrough(),
      expires: z.string().datetime({ offset: true }),
    })
    .passthrough();
  const session = schema.safeParse(raw);
  if (
    !session.success ||
    session.data.user.email.toLowerCase() !== email.toLowerCase() ||
    Date.parse(session.data.expires) <= now
  )
    throw new SyncError('authentication_required');
}
