interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function apiPost<T>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (data.error as string) ?? 'Request failed' };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}
