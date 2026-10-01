import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { fromZodError } from 'zod-validation-error';
import { z } from 'zod';
import { pollSchema, eligibilityFileSchema } from '../../worker/src/polls/schemas.js';

function yaml(text: string, file: string) {
  try {
    // The opening line is checked before gray-matter can select its JS engine.
    return matter(text, {
      language: 'yaml',
      engines: {
        javascript: () => {
          throw new Error('Only YAML is supported.');
        },
      },
    });
  } catch {
    throw new Error(
      `${file}: invalid YAML frontmatter. Quote dates and check indentation.`,
    );
  }
}
function validated<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`${file}: ${fromZodError(result.error).message}`);
  return result.data;
}
export async function readPoll(file: string) {
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---' || !lines.slice(1).includes('---'))
    throw new Error(`${file}: use YAML frontmatter between standalone --- lines.`);
  const parsed = yaml(text, file);
  if (Object.hasOwn(parsed.data, 'description'))
    throw new Error(`${file}: put the description in the Markdown body.`);
  const input = validated(
    pollSchema,
    { ...parsed.data, description: parsed.content.trim() },
    file,
  );
  if (Buffer.byteLength(JSON.stringify(input)) > 16384)
    throw new Error(`${file}: API payload exceeds 16 KiB.`);
  return input;
}
export async function readEligibility(file: string) {
  const text = await readFile(file, 'utf8');
  // Wrapping the file fixes the parser language to YAML, with no engine directive.
  if (text.split(/\r?\n/).some((line) => line.startsWith('---')))
    throw new Error(`${file}: use a plain YAML list without document delimiters.`);
  return validated(eligibilityFileSchema, yaml(`---\n${text}\n---\n`, file).data, file);
}
