import { expect, it } from 'vitest';
import { isPastEvent } from '../../src/lib/events';

const start = '2026-11-21T13:00:00-05:00';
const end = '2026-11-21T17:00:00-05:00';

it.each([
  [end, '2026-11-21T15:00:00-05:00', false],
  [end, '2026-11-21T17:00:00-05:00', false],
  [end, '2026-11-21T17:00:01-05:00', true],
  [undefined, '2026-11-21T13:00:01-05:00', true],
])('classifies an event ending at %s at clock time %s', (endDate, clock, past) => {
  expect(isPastEvent(start, endDate, Date.parse(clock))).toBe(past);
});
