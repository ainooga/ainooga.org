export interface TurnstileService {
  render(element: HTMLElement): string;
  getResponse(widgetId: string): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

export const TURNSTILE_WORKER_URL =
  'https://turnstile-siteverify-ainooga-org.withered-bonus-e8ad.workers.dev';

export class BrowserTurnstile implements TurnstileService {
  constructor(private siteKey: string) {}

  render(element: HTMLElement): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).turnstile?.render?.(element, {
      sitekey: this.siteKey,
      action: 'turnstile-spin-v1',
    }) as string;
  }

  getResponse(widgetId: string): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).turnstile?.getResponse?.(widgetId) as string;
  }

  reset(widgetId: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile?.reset?.(widgetId);
  }

  remove(widgetId: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile?.remove?.(widgetId);
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
