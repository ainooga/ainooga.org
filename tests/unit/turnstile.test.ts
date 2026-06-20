import { describe, it, expect } from 'vitest';
import {
  BrowserTurnstile,
  FakeTurnstile,
  type TurnstileService,
} from '../../src/lib/turnstile';

describe('TurnstileService interface', () => {
  describe('FakeTurnstile', () => {
    it('returns a widget ID on render', () => {
      const ts: TurnstileService = new FakeTurnstile('test-key');
      const id = ts.render(document.createElement('div'));
      expect(id).toBe('fake-widget-1');
    });

    it('returns incrementing widget IDs', () => {
      const ts = new FakeTurnstile();
      const id1 = ts.render(document.createElement('div'));
      const id2 = ts.render(document.createElement('div'));
      expect(id1).toBe('fake-widget-1');
      expect(id2).toBe('fake-widget-2');
    });

    it('returns a fake token from getResponse', () => {
      const ts = new FakeTurnstile();
      const id = ts.render(document.createElement('div'));
      expect(ts.getResponse(id)).toBe('fake-turnstile-token');
    });

    it('reset does not throw', () => {
      const ts = new FakeTurnstile();
      const id = ts.render(document.createElement('div'));
      expect(() => ts.reset(id)).not.toThrow();
    });

    it('remove does not throw', () => {
      const ts = new FakeTurnstile();
      const id = ts.render(document.createElement('div'));
      expect(() => ts.remove(id)).not.toThrow();
    });
  });

  describe('BrowserTurnstile', () => {
    it('render returns null when window.turnstile is missing', () => {
      const ts = new BrowserTurnstile('site-key');
      const result = ts.render(document.createElement('div'));
      expect(result).toBeNull();
    });

    it('getResponse returns empty string when window.turnstile is missing', () => {
      const ts = new BrowserTurnstile('site-key');
      expect(ts.getResponse('widget-id')).toBe('');
    });

    it('reset does not throw when window.turnstile is missing', () => {
      const ts = new BrowserTurnstile('site-key');
      expect(() => ts.reset('widget-id')).not.toThrow();
    });

    it('remove does not throw when window.turnstile is missing', () => {
      const ts = new BrowserTurnstile('site-key');
      expect(() => ts.remove('widget-id')).not.toThrow();
    });
  });
});
