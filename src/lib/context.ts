import { getContext, setContext } from 'svelte';
import type { TurnstileService } from './turnstile.js';

const TURNSTILE_KEY = Symbol('turnstile');

export function setTurnstileService(service: TurnstileService): void {
  setContext(TURNSTILE_KEY, service);
}

export function getTurnstileService(): TurnstileService {
  return getContext<TurnstileService>(TURNSTILE_KEY);
}

/**
 * Create a Svelte context map for injecting a TurnstileService.
 * Used in component tests via `render(Component, { context: createTurnstileContext(fake) })`.
 */
export function createTurnstileContext(
  service: TurnstileService,
): Map<symbol, TurnstileService> {
  return new Map([[TURNSTILE_KEY, service]]);
}
