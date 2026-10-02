export interface PollApi {
  request(path: string, method?: string, body?: unknown): Promise<unknown>;
}
export class PollClient implements PollApi {
  private readonly base: URL;
  constructor(
    private readonly token: string,
    url: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new Error('Set AINOOGA_API_TOKEN to your organizer token.');
    this.base = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname);
    if (this.base.protocol !== 'https:' && !(local && this.base.protocol === 'http:'))
      throw new Error('Use HTTPS for the API URL, except on localhost.');
    if (
      this.base.username !== '' ||
      this.base.password !== '' ||
      this.base.search !== '' ||
      this.base.hash !== '' ||
      this.base.pathname !== '/'
    )
      throw new Error(
        'AINOOGA_API_URL must be an origin, without credentials, path, query or fragment.',
      );
  }
  async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && Buffer.byteLength(payload) > 16384)
      throw new Error('API payload exceeds 16 KiB.');
    let response: Response;
    try {
      response = await fetch(new URL(`/api/admin/polls${path}`, this.base), {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: payload,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        'API request failed. Check the API URL and connection; redirects are refused.',
      );
    }
    if (!response.ok)
      throw new Error(
        `API request failed (HTTP ${response.status}). Check the token, poll state, and input.`,
      );
    return response.json() as Promise<unknown>;
  }
}
