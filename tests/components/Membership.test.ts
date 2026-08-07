import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte/svelte5';
import Membership from '../../src/pages/Membership.svelte';
import { createTurnstileContext } from '../../src/lib/context';
import { FakeTurnstile } from '../../src/lib/turnstile';

/* ------------------------------------------------------------------ */
/*  Fake content payloads driving fetchData                            */
/* ------------------------------------------------------------------ */

const versionJson = { v: 'test-version' };

const productsIndex = {
  items: [
    {
      slug: 'membership-student',
      title: 'Student',
      family: 'membership',
      path: '/data/products/membership-student.json',
    },
    {
      slug: 'membership-pro',
      title: 'Pro',
      family: 'membership',
      path: '/data/products/membership-pro.json',
    },
    {
      slug: 'ad-slide',
      title: 'Slide placement',
      family: 'advertising',
      path: '/data/products/ad-slide.json',
    },
  ],
};

const productDocs: Record<string, Record<string, unknown>> = {
  'membership-student': {
    name: 'Student',
    price: '$10 / year',
    frequency: 'annual',
    order: 0,
    tagline: 'Full club experience',
    benefits: ['Event access'],
    featured: false,
    note: 'For enrolled students.',
  },
  'membership-pro': {
    name: 'Pro',
    price: '$300 / year',
    frequency: 'annual',
    order: 2,
    tagline: 'Directory listing',
    benefits: ['Everything in Basic', 'Directory listing'],
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
    const doc = productDocs[url.replace('/data/products/', '').replace('.json', '')];
    if (doc) {
      return { ok: true, json: async () => doc } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

describe('Membership page', () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the anchor Pro tier with the featured badge', async () => {
    const fake = new FakeTurnstile();
    render(Membership, { context: createTurnstileContext(fake) });

    await waitFor(() => {
      expect(document.querySelector('.tier-card__name')?.textContent).toBe('Student');
    });
    const names = Array.from(document.querySelectorAll('.tier-card__name')).map((n) =>
      n?.textContent?.trim(),
    );
    expect(names).toEqual(['Student', 'Pro']);

    const featured = document.querySelector('.tier-card--featured');
    expect(featured?.textContent).toContain('Pro');
    expect(featured?.textContent).toContain('Most popular');
  });

  it('only fetches membership-family products, not advertising', async () => {
    const fetchMock = mockFetch();
    const fake = new FakeTurnstile();
    render(Membership, { context: createTurnstileContext(fake) });

    await waitFor(() => {
      expect(document.querySelector('.tier-card__name')).toBeTruthy();
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]).split('?')[0]);
    // Never fetches the advertising doc
    expect(urls).not.toContain('/data/products/ad-slide.json');
  });

  it('orders tiers by the order field', async () => {
    const fake = new FakeTurnstile();
    render(Membership, { context: createTurnstileContext(fake) });

    await waitFor(() => {
      const names = Array.from(document.querySelectorAll('.tier-card__name')).map((n) =>
        n?.textContent?.trim(),
      );
      expect(names).toEqual(['Student', 'Pro']);
    });
  });

  it('exposes a contact form with the shared Turnstile pattern', async () => {
    const fake = new FakeTurnstile();
    render(Membership, { context: createTurnstileContext(fake) });

    await waitFor(() => {
      expect(document.querySelector('.cta .btn-primary')).toBeTruthy();
    });
    // Contact form present (closed CTA state)
    expect(document.querySelector('.form-input')).toBeNull();
    expect(document.querySelector('.cta')?.textContent).toContain('Contact us');
  });
});
