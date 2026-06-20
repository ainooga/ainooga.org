export interface TurnstileService {
  render(element: HTMLElement): string | null;
  getResponse(widgetId: string): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

export const TURNSTILE_WORKER_URL =
  'https://turnstile-siteverify-ainooga-org.withered-bonus-e8ad.workers.dev';

function getTurnstile(): Record<string, unknown> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).turnstile;
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

  render(element: HTMLElement): string | null {
    const ts = getTurnstile();
    if (ts == null) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ts as any).render(element, {
      sitekey: this.siteKey,
      action: 'turnstile-spin-v1',
    }) as string;
  }

  getResponse(widgetId: string): string {
    const ts = getTurnstile();
    if (ts == null) return '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ts as any).getResponse(widgetId) as string;
  }

  reset(widgetId: string): void {
    const ts = getTurnstile();
    if (ts == null) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ts as any).reset(widgetId);
  }

  remove(widgetId: string): void {
    const ts = getTurnstile();
    if (ts == null) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ts as any).remove(widgetId);
  }
}

export class FakeTurnstile implements TurnstileService {
  private counter = 0;

  constructor(private siteKey = 'fake-key') {}

  render(_element: HTMLElement): string {
    return `fake-widget-${++this.counter}`;
  }

  getResponse(_widgetId: string): string {
    return 'fake-turnstile-token';
  }

  reset(_widgetId: string): void {
    /* noop */
  }

  remove(_widgetId: string): void {
    /* noop */
  }
}
