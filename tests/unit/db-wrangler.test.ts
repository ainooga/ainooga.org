// @vitest-environment node
import { expect, it } from 'vitest';
import { parseWranglerOutput } from '../../db/wrangler';

const result = [{ success: true, results: [{ 'Total queries executed': 2 }] }];

it.each([
  '',
  '├ Checking if file needs uploading\n│\n├ 🌀 Uploading database.sql\n│ 🌀 Uploading complete.\n│\n',
])('parses successful imports with optional Wrangler progress: %s', (progress) => {
  expect(parseWranglerOutput(progress + JSON.stringify(result, null, 2))).toEqual(result);
});

it.each(['', 'private-value', '[{"private":"private-value"}', '[true]\nextra'])(
  'rejects missing or malformed JSON without echoing output: %s',
  (output) => {
    expect(() => parseWranglerOutput(output)).toThrow(
      'Wrangler returned invalid JSON; the database operation may have completed.',
    );
  },
);
