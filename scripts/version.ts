import { execSync } from 'node:child_process';

let _cachedVersion: string | null = null;

/**
 * Compute a deterministic version string from git (short SHA).
 * Falls back to ISO timestamp if git is unavailable or not a repo.
 */
export function getBuildVersion(): string {
  if (_cachedVersion != null && _cachedVersion !== '') return _cachedVersion;

  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const sha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (sha != null && sha !== '') {
      _cachedVersion = sha;
      return sha;
    }
  } catch {
    // Not a git repo or git not available
  }

  const fallback = new Date().toISOString().replace(/[:.]/g, '-');
  _cachedVersion = fallback;
  return fallback;
}
