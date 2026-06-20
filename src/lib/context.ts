import { getContext, setContext } from 'svelte';
import type { TurnstileService } from './turnstile.js';

const TURNSTILE_KEY = Symbol('turnstile');

export function setTurnstileService(service: TurnstileService): void {
  setContext(TURNSTILE_KEY, service);
}

export function getTurnstileService(): TurnstileService {
  return getContext<TurnstileService>(TURNSTILE_KEY);
}
