import { describe, expect, it } from 'vitest';
import { isSpaNavigation, legacyHashPath, parseRoute } from '../../src/lib/routing';

describe('parseRoute', () => {
  it.each([
    ['/', { page: 'home', params: {} }],
    ['/events', { page: 'events', params: {} }],
    ['/events/', { page: 'events', params: {} }],
    ['/events/meetup', { page: 'events/:slug', params: { slug: 'meetup' } }],
    ['/events/meetup/', { page: 'events/:slug', params: { slug: 'meetup' } }],
    ['/posts/news', { page: 'posts/:slug', params: { slug: 'news' } }],
    ['/members/ada', { page: 'members/:slug', params: { slug: 'ada' } }],
    ['/polls/topic-vote', { page: 'polls/:slug', params: { slug: 'topic-vote' } }],
    ['/polls/bad%20slug', { page: 'polls', params: {} }],
    ['/polls/a/b', { page: 'polls', params: {} }],
    ['/about', { page: 'about', params: {} }],
    ['/nope', { page: 'nope', params: {} }],
  ])('%s', (path, expected) => {
    expect(parseRoute(path)).toEqual(expected);
  });
});

describe('legacyHashPath', () => {
  it.each([
    ['#/events/meetup', '/events/meetup'],
    ['#/', '/'],
    ['#/polls/x?ref=email', '/polls/x?ref=email'],
    ['#main', null],
    ['#home', null],
    ['', null],
  ])('%s', (hash, expected) => {
    expect(legacyHashPath(hash)).toBe(expected);
  });
});

describe('isSpaNavigation', () => {
  const current = new URL('https://ainooga.org/events');
  it.each([
    ['https://ainooga.org/events/meetup', true],
    ['https://ainooga.org/', true],
    ['https://ainooga.org/posts?tag=news', true],
    ['https://ainooga.org/events?view=past', true],
    ['https://ainooga.org/about#mission', true],
    ['https://ainooga.org/events#main', false],
    ['https://example.com/events', false],
    ['https://ainooga.org/api/subscribe', false],
    ['https://ainooga.org/confirm?token=x', false],
    ['https://ainooga.org/data/events/index.json', false],
    ['https://ainooga.org/images/hero-og.jpg', false],
  ])('%s → %s', (target, expected) => {
    expect(isSpaNavigation(new URL(target), current)).toBe(expected);
  });
});
