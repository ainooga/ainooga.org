// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { preflight, timestamp } from '../../scripts/db/legacy';
import { transform } from '../../scripts/db/transform';
import { literal, type LegacyData } from '../../scripts/db/types';

function data(): LegacyData {
  return {
    subscribers: [
      {
        id: 1,
        email: 'test@example.com',
        name: 'Unsplit Full Name',
        source: null,
        created_at: null,
        confirmed: 0,
        confirmation_token: 'token',
        confirmed_at: null,
      },
    ],
    contacts: [],
  };
}

describe('legacy migration preflight', () => {
  it.each([
    ['email', 'invalid'],
    ['confirmed', null],
    ['confirmed', 2],
    ['confirmation_token', ''],
    ['created_at', 'not-a-date'],
    ['created_at', '2026-02-30 00:00:00'],
    ['name', 'null\0byte'],
  ])('rejects unsupported %s without echoing the value', (field, value) => {
    const input = data();
    input.subscribers[0]![field as string] = value;
    expect(() => preflight(input)).toThrow();
  });
  it.each(['email', 'confirmation_token'])(
    'rejects duplicate %s with record IDs',
    (field) => {
      const input = data();
      input.subscribers.push({
        ...input.subscribers[0]!,
        id: 2,
        email: 'other@example.com',
        confirmation_token: 'other',
      });
      input.subscribers[1]![field] = field === 'email' ? ' TEST@Example.com ' : 'token';
      expect(() => preflight(input)).toThrow('subscribers 1, 2: conflicting');
    },
  );
  it('preserves nullable historical values while hashing active tokens', () => {
    const input = data();
    preflight(input);
    const rows = transform(input, '2026-09-28T00:00:00.000Z');
    expect(rows[0]!.row.name).toBe('Unsplit Full Name');
    expect(rows[3]!.row.created_at).toBeNull();
    expect(rows[3]!.row.confirmation_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[3]!.row.confirmation_expires_at).toBeNull();
  });
  it.each([
    [null, null],
    ['2026-01-01 01:02:03', '2026-01-01T01:02:03.000Z'],
    ['2026-01-01T01:02:03-05:00', '2026-01-01T06:02:03.000Z'],
  ])('normalizes %s to UTC', (value, expected) =>
    expect(timestamp(value, 'test')).toBe(expected),
  );
  it('escapes SQL literals and rejects unsupported values', () => {
    expect(literal("O'Brien; --")).toBe("'O''Brien; --'");
    expect(literal(null)).toBe('NULL');
    expect(() => literal(NaN)).toThrow();
    expect(() => literal('\0')).toThrow();
  });
});
