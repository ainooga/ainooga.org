export interface PollRuntime {
  focus(element: HTMLElement): void;
  openDialog(element: HTMLDialogElement): () => void;
  now(): number;
  uuid(): string;
  everySecond(callback: () => void): () => void;
}
export class BrowserPollRuntime implements PollRuntime {
  openDialog(element: HTMLDialogElement) {
    const previous = document.activeElement;
    const parent = element.parentElement;
    element.showModal();
    return () => {
      element.close();
      queueMicrotask(() => {
        const target =
          previous instanceof HTMLElement &&
          previous !== document.body &&
          previous.isConnected
            ? previous
            : parent?.querySelector<HTMLElement>('button:not(:disabled)');
        target?.focus();
      });
    };
  }
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
