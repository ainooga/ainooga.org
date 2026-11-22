import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import EventSchedule from '../../src/components/EventSchedule.svelte';
import Home from '../../src/pages/Home.svelte';
import EventList from '../../src/pages/EventList.svelte';

function event(day: number) {
  return {
    slug: `event-${day}`,
    title: `Event ${day}`,
    date: `2026-11-${String(day).padStart(2, '0')}T13:00:00-05:00`,
    tags: [],
  };
}

function cards(heading: string) {
  return within(screen.getByRole('heading', { name: heading }).closest('section')!)
    .getAllByRole('heading', { level: 3 })
    .map((card) => card.textContent);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('sorts both groups and focuses the first newly revealed past event in each batch', async () => {
  vi.setSystemTime(new Date('2026-11-07T23:00:00-05:00'));
  render(EventSchedule, {
    props: { events: [2, 9, 1, 6, 7, 4, 8, 3, 5].map(event), layout: 'list' },
  });

  expect(cards('Upcoming events')).toEqual(['Event 8', 'Event 9']);
  expect(cards('Past events')).toEqual(['Event 7']);

  await fireEvent.click(screen.getByRole('button', { name: 'Show 5 more past events' }));
  expect(cards('Past events')).toEqual([7, 6, 5, 4, 3, 2].map((day) => `Event ${day}`));
  expect(document.activeElement?.getAttribute('href')).toBe('/events/event-6');

  await fireEvent.click(screen.getByRole('button', { name: 'Show 1 more past event' }));
  expect(cards('Past events')).toEqual(
    [7, 6, 5, 4, 3, 2, 1].map((day) => `Event ${day}`),
  );
  expect(screen.queryByRole('button', { name: /more past event/ })).toBeNull();
  expect(document.activeElement?.getAttribute('href')).toBe('/events/event-1');
});

it.each([
  ['home', Home],
  ['events', EventList],
] as const)('renders the fetched schedule on %s', async (_page, Page) => {
  vi.setSystemTime(new Date('2026-11-01T23:00:00-05:00'));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = String(input).split('?')[0];
    if (path === '/data/version.json') return Response.json({ v: 'test' });
    if (path === '/data/events/index.json')
      return Response.json({ items: [event(1), event(2)] });
    if (path === '/data/posts/index.json') return Response.json({ items: [] });
    throw new Error(`Unexpected request: ${path}`);
  });

  render(Page);
  for (const [group, day] of [
    ['Upcoming events', 2],
    ['Past events', 1],
  ] as const) {
    const heading = await screen.findByRole('heading', { name: group });
    const link = within(heading.closest('section')!).getByRole('link');
    expect(link.getAttribute('href')).toBe(`/events/event-${day}`);
  }
});
