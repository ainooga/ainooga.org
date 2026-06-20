import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiPost } from '../../src/lib/api';

describe('apiPost', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok response on success', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'Success' }),
    } as Response);

    const result = await apiPost('test', { foo: 'bar' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ message: 'Success' });
    expect(result.error).toBeUndefined();
  });

  it('returns error from response body on non-ok status', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Bad request' }),
    } as Response);

    const result = await apiPost('test', { foo: 'bar' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Bad request');
    expect(result.data).toBeUndefined();
  });

  it('returns generic error when response body has no error field', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);

    const result = await apiPost('test', { foo: 'bar' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Request failed');
  });

  it('returns network error when fetch throws', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockRejectedValueOnce(new Error('Network is down'));

    const result = await apiPost('test', { foo: 'bar' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network is down');
  });

  it('calls /api/test with correct method and headers', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    await apiPost('test', { key: 'value' });

    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });
  });
});
