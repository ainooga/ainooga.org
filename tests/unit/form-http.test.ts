// @vitest-environment node
import { expect, it } from 'vitest';
import { formHostname } from '../../worker/src/form-http';

it.each([
  ['https://ainooga.org', 'ainooga.org'],
  ['https://www.ainooga.org', 'www.ainooga.org'],
  ['https://abc-123.ainooga-org.pages.dev', 'abc-123.ainooga-org.pages.dev'],
  ['http://localhost:5173', 'localhost'],
  [null, 'ainooga.org'],
])('uses the permitted request hostname %s', (origin, hostname) => {
  const headers = origin === null ? {} : { Origin: origin };
  expect(
    formHostname(
      new Request('https://ainooga.org/api/subscribe', { headers }),
      'https://ainooga.org',
    ),
  ).toBe(hostname);
});
it.each([
  'https://evil.test',
  'null',
  'https://ainooga.org.evil.test',
  'https://evilainooga-org.pages.dev',
])('rejects foreign origin %s', (origin) => {
  expect(() =>
    formHostname(
      new Request('https://ainooga.org/api/subscribe', { headers: { Origin: origin } }),
      'https://ainooga.org',
    ),
  ).toThrow('This request must come from the site.');
});
