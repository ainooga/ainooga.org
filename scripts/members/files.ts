import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import {
  memberSchema,
  eventKey,
  type MemberInput,
} from '../../worker/src/members/schemas.js';

const fileSchema = z.array(memberSchema).min(1).max(10000);
export async function readMembers(path: string): Promise<MemberInput[]> {
  if ((await stat(path)).size > 5 * 1024 * 1024)
    throw new Error('Normalized input exceeds 5 MiB.');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Cannot read a valid JSON member file.');
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Invalid member fields (zero-based paths): ${paths.slice(0, 25).join(', ')}`,
    );
  }
  validateFile(parsed.data);
  return parsed.data;
}

export function validateFile(records: MemberInput[]): void {
  const emails = new Set<string>();
  const sources = new Set<string>();
  const events = new Map<string, string>();
  records.forEach((record, index) => {
    const fail = (reason: string): never => {
      throw new Error(`Row ${index + 1}: ${reason}`);
    };
    if (Buffer.byteLength(JSON.stringify(record)) > 16384)
      fail('request exceeds 16 KiB.');
    const email = record.email.toLowerCase();
    const source = JSON.stringify([record.source, record.sourceKey]);
    if (emails.has(email) || sources.has(source))
      fail('duplicate email or source identity.');
    emails.add(email);
    sources.add(source);
    for (const { event } of record.participations) {
      const key = eventKey(event);
      const serialized = JSON.stringify(event);
      if (events.has(key) && events.get(key) !== serialized)
        fail('conflicting event definitions.');
      events.set(key, serialized);
    }
  });
}
