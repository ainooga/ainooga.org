import type { MemberInput } from '../../worker/src/members/schemas.js';
import {
  importResultSchema,
  type ImportResult,
} from '../../worker/src/members/report.js';

export interface MemberApi {
  request(input: MemberInput, preview: boolean): Promise<ImportResult>;
}
export class MemberClient implements MemberApi {
  private readonly base: URL;
  constructor(
    private readonly token: string,
    url: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new Error('Set AINOOGA_API_TOKEN to your organizer token.');
    try {
      this.base = new URL(url);
    } catch {
      throw new Error('Set AINOOGA_API_URL to an explicit API origin.');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname);
    if (this.base.protocol !== 'https:' && !(local && this.base.protocol === 'http:'))
      throw new Error('Use HTTPS for the API URL, except on localhost.');
    if (
      [this.base.username, this.base.password, this.base.search, this.base.hash].some(
        (value) => value !== '',
      ) ||
      this.base.pathname !== '/'
    )
      throw new Error(
        'AINOOGA_API_URL must be an origin without credentials, path, query or fragment.',
      );
  }
  async request(input: MemberInput, preview: boolean): Promise<ImportResult> {
    const payload = JSON.stringify(input);
    if (Buffer.byteLength(payload) > 16384)
      throw new Error('API payload exceeds 16 KiB.');
    let response: Response;
    try {
      response = await fetch(
        new URL(`/api/admin/members/import${preview ? '/preview' : ''}`, this.base),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: payload,
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new Error('API request failed or timed out; redirects are refused.');
    }
    if (!response.ok) throw new Error(`API request failed (HTTP ${response.status}).`);
    try {
      return importResultSchema.parse(await response.json());
    } catch {
      throw new Error('Invalid import API response.');
    }
  }
}
