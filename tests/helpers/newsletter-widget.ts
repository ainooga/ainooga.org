// Controlled stand-in for the loaded vendor script, not the app service.
type Script = NonNullable<Window['turnstile']>;
type Options = Parameters<Script['render']>[1];

export class NewsletterWidget implements Script {
  widgets = new Map<
    string,
    { element: string | HTMLElement; options: Options; token: string }
  >();
  private counter = 0;

  render(element: string | HTMLElement, options: Options) {
    const id = String(++this.counter);
    this.widgets.set(id, { element, options, token: '' });
    return id;
  }
  getResponse(id: string) {
    return this.widgets.get(id)?.token;
  }
  solve(id: string, token: string) {
    const widget = this.widgets.get(id);
    if (!widget) return;
    widget.token = token;
    widget.options.callback?.(token);
  }
  expire(id: string) {
    this.reset(id);
    this.widgets.get(id)?.options['expired-callback']?.();
  }
  reset(id: string) {
    const widget = this.widgets.get(id);
    if (widget) widget.token = '';
  }
  remove(id: string) {
    this.widgets.delete(id);
  }
}
