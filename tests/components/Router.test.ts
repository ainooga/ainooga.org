import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import Router from '../../src/Router.svelte';

function link(href: string, label: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = label;
  document.body.append(anchor);
  return anchor;
}

beforeEach(() => {
  // jsdom does not implement scrolling.
  vi.stubGlobal('scrollTo', () => undefined);
  window.history.replaceState(null, '', '/nope');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

it('renders the route for the current path and handles unknown paths', async () => {
  render(Router);
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
});

it('navigates internal links with pushState and returns on back', async () => {
  render(Router);
  await screen.findByRole('heading', { name: 'Page not found' });

  link('/about', 'About').click();
  expect(await screen.findByRole('heading', { name: 'AI Nooga', level: 1 })).toBeTruthy();
  expect(window.location.pathname).toBe('/about');

  window.history.back();
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  expect(window.location.pathname).toBe('/nope');
});

it('rewrites legacy hash routes to paths', async () => {
  render(Router);
  await screen.findByRole('heading', { name: 'Page not found' });

  window.location.hash = '#/about';
  expect(await screen.findByRole('heading', { name: 'AI Nooga', level: 1 })).toBeTruthy();
  expect(window.location.pathname).toBe('/about');
  expect(window.location.hash).toBe('');
});
