import { describe, it, expect, afterEach } from 'vitest';
import { BrowserTurnstile } from '../../src/lib/turnstile';

type Turnstile = NonNullable<Window['turnstile']>;
type RenderParams = Parameters<Turnstile['render']>[1];

class StandInTurnstile implements Turnstile {
  rendered: { container: string | HTMLElement; params: RenderParams }[] = [];
  responses: (string | undefined)[] = [];
  resets: string[] = [];
  removes: string[] = [];

  constructor(
    private widgetId: string | undefined,
    private token: string | undefined,
  ) {}

  render(container: string | HTMLElement, params: RenderParams) {
    this.rendered.push({ container, params });
    return this.widgetId;
  }
  getResponse(widgetId?: string) {
    this.responses.push(widgetId);
    return this.token;
  }
  reset(widgetId: string) {
    this.resets.push(widgetId);
  }
  remove(widgetId: string) {
    this.removes.push(widgetId);
  }
}

function install(stand = new StandInTurnstile('w1', 'tok')): StandInTurnstile {
  window.turnstile = stand;
  return stand;
}

afterEach(() => {
  delete window.turnstile;
});

const absent: [string, (ts: BrowserTurnstile) => unknown, unknown][] = [
  ['render', (ts) => ts.render(document.createElement('div')), null],
  ['getResponse', (ts) => ts.getResponse('w1'), ''],
  ['reset', (ts) => ts.reset('w1'), undefined],
  ['remove', (ts) => ts.remove('w1'), undefined],
];

describe('BrowserTurnstile', () => {
  it.each(absent)('%s is null-safe without window.turnstile', (_, call, want) => {
    expect(call(new BrowserTurnstile('key'))).toBe(want);
  });

  it('render passes the element, site key, action, and callbacks', () => {
    const stand = install();
    const el = document.createElement('div');
    const callbacks = {
      onToken: (token: string) => token,
      onError: () => 'error',
      onTimeout: () => 'timeout',
      onExpired: () => 'expired',
    };

    const id = new BrowserTurnstile('key').render(el, callbacks, 'act');

    expect(id).toBe('w1');
    expect(stand.rendered).toHaveLength(1);
    expect(stand.rendered[0]?.container).toBe(el);
    expect(stand.rendered[0]?.params).toEqual({
      sitekey: 'key',
      action: 'act',
      callback: callbacks.onToken,
      'error-callback': callbacks.onError,
      'timeout-callback': callbacks.onTimeout,
      'expired-callback': callbacks.onExpired,
      'refresh-expired': 'auto',
    });
  });

  it('render defaults the action and omits absent callbacks', () => {
    const stand = install();

    new BrowserTurnstile('key').render(document.createElement('div'));

    expect(stand.rendered[0]?.params).toEqual({
      sitekey: 'key',
      action: 'turnstile-spin-v1',
      callback: undefined,
      'error-callback': undefined,
      'timeout-callback': undefined,
      'expired-callback': undefined,
      'refresh-expired': 'auto',
    });
  });

  it('render returns null when turnstile returns no widget id', () => {
    install(new StandInTurnstile(undefined, 'tok'));
    expect(new BrowserTurnstile('key').render(document.createElement('div'))).toBeNull();
  });

  it.each([
    ['tok', 'tok'],
    [undefined, ''],
  ])('getResponse passes the widget id and maps %s to %j', (token, expected) => {
    const stand = install(new StandInTurnstile('w1', token));
    expect(new BrowserTurnstile('key').getResponse('w7')).toBe(expected);
    expect(stand.responses).toEqual(['w7']);
  });

  it('reset and remove pass the widget id through', () => {
    const stand = install();
    const ts = new BrowserTurnstile('key');

    ts.reset('w2');
    ts.remove('w3');

    expect(stand.resets).toEqual(['w2']);
    expect(stand.removes).toEqual(['w3']);
  });
});
