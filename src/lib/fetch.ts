let _version: string | null = null;

/**
 * Get the current build version, memoized for the page session.
 * Always busts cache on the version file itself with a random query param.
 * The memoized value resets on reload / hard refresh (JS module re-executes).
 */
export async function getVersion(): Promise<string> {
  if (_version != null && _version !== '') return _version;
  const res = await fetch(`/data/version.json?_t=${Date.now()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch version: HTTP ${res.status}`);
  }
  const data = await res.json();
  _version = data.v as string;
  return _version;
}

/**
 * Fetch a JSON data file with automatic cache busting via the build version.
 * When the version changes (new deploy), all URLs change → cache is naturally busted.
 * When the version is the same, URLs are identical → browser serves from cache.
 */
export async function fetchData<T>(path: string): Promise<T> {
  const v = await getVersion();
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${path}${sep}v=${v}`);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${path} (HTTP ${res.status})`);
  }
  return res.json() as Promise<T>;
}
