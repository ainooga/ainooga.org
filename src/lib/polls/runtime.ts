export interface PollRuntime {
  focus(element: HTMLElement): void;
  now(): number;
  uuid(): string;
  everySecond(callback: () => void): () => void;
}
export class BrowserPollRuntime implements PollRuntime {
  focus(element: HTMLElement) {
    element.focus();
  }
  now() {
    return Date.now();
  }
  uuid() {
    return crypto.randomUUID();
  }
  everySecond(callback: () => void) {
    const timer = setInterval(callback, 1000);
    return () => clearInterval(timer);
  }
}
