import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte/svelte5';
import Advertise from '../../src/pages/Advertise.svelte';
import { createTurnstileContext } from '../../src/lib/context';
import { FakeTurnstile } from '../../src/lib/turnstile';

const versionJson = { v: 'test-version' };

const productsIndex = {
  items: [
    {
      slug: 'ad-slide',
      title: 'Slide placement',
      family: 'advertising',
      path: '/data/products/ad-slide.json',
    },
    {
      slug: 'ad-special-events',
      title: 'Special events package',
      family: 'advertising',
      path: '/data/products/ad-special-events.json',
    },
    {
      slug: 'membership-pro',
      title: 'Pro',
      family: 'membership',
      path: '/data/products/membership-pro.json',
    },
  ],
};

const adDocs: Record<string, Record<string, unknown>> = {
  'ad-slide': {
    name: 'Slide placement',
    price: 'Quote by period',
    order: 0,
    tagline: 'Your message in front of every workshop',
    benefits: ['Logo or message in the deck rotation'],
    featured: false,
    note: 'Fulfilled by period earmark.',
  },
  'ad-special-events': {
    name: 'Special events package',
    price: 'Quote by period',
    order: 3,
    tagline: 'Participation in our highest-attention events',
    benefits: ['Booth or demo slot at special events'],
    featured: true,
  },
};

function mockFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input).split('?')[0];
    if (url === '/data/version.json') {
      return { ok: true, json: async () => versionJson } as Response;
    }
    if (url === '/data/products/index.json') {
      return { ok: true, json: async () => productsIndex } as Response;
    }
    const doc = adDocs[url.replace('/data/products/', '').replace('.json', '')];
    if (doc) {
      return { ok: true, json: async () => doc } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

describe('Advertise page', () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the period-earmark model copy', async () => {
    const fake = new FakeTurnstile();
    render(Advertise, { context: createTurnstileContext(fake) });

    await waitFor(() => {
      expect(document.querySelector('.model')).toBeTruthy();
    });
    expect(document.body.textContent).toContain('Sold by period earmark');
    expect(document.body.textContent).toContain('No banking, no rollover');
    expect(document.body.textContent).toContain('Winter 2026');
  });

  it('renders only advertising-family products, flagging the flagship', async () => {
    const fetchMock = mockFetch();
    const fake = new FakeTurnstile();
    render(Advertise, { context: createTurnstileContext(fake) });

    await waitFor(() => {
      expect(document.querySelector('.ad-card__name')).toBeTruthy();
    });
    const names = Array.from(document.querySelectorAll('.ad-card__name')).map((n) =>
      n?.textContent?.trim(),
    );
    expect(names).toEqual(['Slide placement', 'Special events package']);

    // Does not fetch membership product
    const urls = fetchMock.mock.calls.map((c) => String(c[0]).split('?')[0]);
    expect(urls).not.toContain('/data/products/membership-pro.json');

    const featured = document.querySelector('.ad-card--featured');
    expect(featured?.textContent).toContain('Special events package');
    expect(featured?.textContent).toContain('Flagship');
  });

  it('orders advertising products by the order field', async () => {
    const fake = new FakeTurnstile();
    render(Advertise, { context: createTurnstileContext(fake) });

    await waitFor(() => {
      const names = Array.from(document.querySelectorAll('.ad-card__name')).map((n) =>
        n?.textContent?.trim(),
      );
      expect(names).toEqual(['Slide placement', 'Special events package']);
    });
  });

  it('includes a special events section', async () => {
    const fake = new FakeTurnstile();
    render(Advertise, { context: createTurnstileContext(fake) });

    await waitFor(() => {
      expect(document.querySelector('.advertise-special')).toBeTruthy();
    });
    const text = document.body.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Special events');
    expect(text).toContain('demo days');
  });
});
