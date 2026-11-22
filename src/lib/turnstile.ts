/* ---- Ambient declarations for Cloudflare Turnstile ---- */

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  cData?: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  tabindex?: number;
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  retry?: 'auto' | 'never';
  'retry-interval'?: number;
  size?: 'normal' | 'compact' | 'flexible';
  appearance?: 'always' | 'execute' | 'interaction-only';
}

interface TurnstileObject {
  render(
    container: string | HTMLElement,
    params: TurnstileRenderOptions,
  ): string | undefined;
  getResponse(widgetId?: string): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileObject;
  }
}

/* ---- Application service interface ---- */

export interface TurnstileWidgetCallbacks {
  onToken?: (token: string) => void;
  onError?: () => void;
  onTimeout?: () => void;
  onExpired?: () => void;
}

export interface TurnstileService {
  render(
    element: HTMLElement,
    callbacks?: TurnstileWidgetCallbacks,
    action?: string,
  ): string | null;
  getResponse(widgetId: string): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

export const TURNSTILE_WORKER_URL =
  'https://turnstile-siteverify-ainooga-org.withered-bonus-e8ad.workers.dev';

function getTurnstile(): TurnstileObject | undefined {
  return window.turnstile;
}

/**
 * Wait for the Turnstile script to finish loading.
 * Resolves once window.turnstile is available, polling every 100ms.
 */
export function whenTurnstileReady(): Promise<void> {
  if (getTurnstile() !== undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (getTurnstile() !== undefined) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

export class BrowserTurnstile implements TurnstileService {
  constructor(private siteKey: string) {}

  render(
    element: HTMLElement,
    callbacks?: TurnstileWidgetCallbacks,
    action?: string,
  ): string | null {
    const ts = getTurnstile();
    if (ts == null) return null;
    const options: TurnstileRenderOptions = {
      sitekey: this.siteKey,
      action: action ?? 'turnstile-spin-v1',
      callback: callbacks?.onToken,
      'error-callback': callbacks?.onError,
      'timeout-callback': callbacks?.onTimeout,
      'expired-callback': callbacks?.onExpired,
      'refresh-expired': 'auto',
    };
    return ts.render(element, options) ?? null;
  }

  getResponse(widgetId: string): string {
    const ts = getTurnstile();
    if (ts == null) return '';
    return ts.getResponse(widgetId) ?? '';
  }

  reset(widgetId: string): void {
    const ts = getTurnstile();
    if (ts == null) return;
    ts.reset(widgetId);
  }

  remove(widgetId: string): void {
    const ts = getTurnstile();
    if (ts == null) return;
    ts.remove(widgetId);
  }
}

export class FakeTurnstile implements TurnstileService {
  private counter = 0;
  callbacks = new Map<string, TurnstileWidgetCallbacks>();
  actions = new Map<string, string>();

  private tokens = new Map<string, string>();

  solve(widgetId: string, token: string): void {
    if (!this.tokens.has(widgetId)) return;
    this.tokens.set(widgetId, token);
    this.callbacks.get(widgetId)?.onToken?.(token);
  }

  expire(widgetId: string): void {
    if (!this.tokens.has(widgetId)) return;
    this.reset(widgetId);
    this.callbacks.get(widgetId)?.onExpired?.();
  }

  render(
    _element: HTMLElement,
    callbacks?: TurnstileWidgetCallbacks,
    action?: string,
  ): string {
    const id = `fake-widget-${++this.counter}`;
    if (callbacks) this.callbacks.set(id, callbacks);
    this.actions.set(id, action ?? 'turnstile-spin-v1');
    this.tokens.set(id, '');
    return id;
  }

  getResponse(widgetId: string): string {
    return this.tokens.get(widgetId) ?? '';
  }

  reset(widgetId: string): void {
    if (this.tokens.has(widgetId)) this.tokens.set(widgetId, '');
  }

  remove(widgetId: string): void {
    this.tokens.delete(widgetId);
    this.actions.delete(widgetId);
    this.callbacks.delete(widgetId);
  }
}
