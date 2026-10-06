import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import MemberDetail from '../../src/pages/MemberDetail.svelte';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['person@example.com', 'mailto:person@example.com'])(
  'renders %s as an email link and preserves website links',
  async (email) => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/data/version.json')) return Response.json({ v: 'test' });
      if (path.startsWith('/data/members/example.json'))
        return Response.json({
          name: 'Example Member',
          links: { email, website: 'https://example.com' },
        });
      throw new Error(`Unexpected request: ${path}`);
    });
    render(MemberDetail, { props: { slug: 'example' } });
    const link = await screen.findByRole('link', { name: 'email' });
    expect(link.getAttribute('href')).toBe('mailto:person@example.com');
    expect(link.hasAttribute('target')).toBe(false);
    const website = screen.getByRole('link', { name: 'website' });
    expect(website.getAttribute('href')).toBe('https://example.com');
    expect(website.getAttribute('target')).toBe('_blank');
  },
);
