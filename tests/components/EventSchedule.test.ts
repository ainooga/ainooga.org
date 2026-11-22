import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import Home from '../../src/pages/Home.svelte';
import EventList from '../../src/pages/EventList.svelte';

const events = [2, 12, 9, 1, 6, 7, 4, 8, 3, 5].map((day) => ({
  slug: `event-${day}`,
  title: `Event ${day}`,
  date: `2026-11-${String(day).padStart(2, '0')}T13:00:00-05:00`,
  tags: [],
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  ['home', Home],
  ['events', EventList],
] as const)('orders and reveals events on %s', async (_page, Page) => {
  vi.setSystemTime(new Date('2026-11-08T23:00:00-05:00'));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = String(input).split('?')[0];
    if (path === '/data/version.json') return Response.json({ v: 'test' });
    if (path === '/data/events/index.json') return Response.json({ items: events });
    if (path === '/data/posts/index.json') return Response.json({ items: [] });
    throw new Error(`Unexpected request: ${path}`);
  });

  render(Page);
  await screen.findByRole('heading', { name: 'Upcoming events' });
  const cards = (heading: string) =>
    within(screen.getByRole('heading', { name: heading }).closest('section')!)
      .getAllByRole('heading', { level: 3 })
      .map((card) => card.textContent);

  expect(cards('Upcoming events')).toEqual(['Event 9', 'Event 12']);
  expect(cards('Past events')).toEqual(['Event 8']);
  expect(screen.getAllByRole('heading', { name: 'Event 8' })).toHaveLength(1);

  await fireEvent.click(screen.getByRole('button', { name: 'Show 5 more past events' }));
  expect(cards('Past events')).toEqual([8, 7, 6, 5, 4, 3].map((day) => `Event ${day}`));
  expect(document.activeElement?.getAttribute('href')).toBe('/events/event-7');

  await fireEvent.click(screen.getByRole('button', { name: 'Show 2 more past events' }));
  expect(cards('Past events')).toEqual(
    [8, 7, 6, 5, 4, 3, 2, 1].map((day) => `Event ${day}`),
  );
  expect(screen.queryByRole('button', { name: /more past events/ })).toBeNull();
  expect(document.activeElement?.getAttribute('href')).toBe('/events/event-2');
});
