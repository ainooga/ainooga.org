import { readMembers } from './files.js';
import { summarize } from './summary.js';
import type { MemberApi } from './client.js';
import type { ImportResult } from '../../worker/src/members/report.js';

export const usage = `Usage: pnpm members [--env-file .env.prod.local] <command> <members.json>
  validate   Validate the entire normalized file without API access.
  preview    Report proposed changes without writing.
  import     Preview every row, then import sequentially. Safe to rerun.`;

export async function runMemberCommand(args: string[], api: MemberApi) {
  const [command, path] = commandArgs(args);
  const records = await readMembers(path);
  if (command === 'validate') return { mode: command, ...summarize(records, []) };
  const previews: ImportResult[] = [];
  for (const [index, record] of records.entries()) {
    try {
      previews.push(await api.request(record, true));
    } catch {
      throw new Error(`Preview failed at row ${index + 1}. No import writes were sent.`);
    }
  }
  const summary = summarize(records, previews);
  if (command === 'preview') return { mode: command, ...summary };
  if (summary.conflicts > 0) {
    const rows = summary.issues
      .filter((i) => i.code === 'identity_conflict')
      .map((i) => i.row);
    throw new Error(
      `Identity conflicts at rows ${rows.join(', ')}. No import writes were sent.`,
    );
  }
  const results: ImportResult[] = [];
  for (const record of records) {
    try {
      results.push(await api.request(record, false));
    } catch {
      throw new Error(
        `Import stopped after ${results.length} confirmed members. Row ${results.length + 1} may have committed. Safely rerun the same file; resolve conflicts before changing identities.`,
      );
    }
  }
  return { mode: command, ...summarize(records, results) };
}

function commandArgs(args: string[]): [string, string] {
  if (args.length !== 2 || !['validate', 'preview', 'import'].includes(args[0] ?? ''))
    throw new Error(usage);
  return [args[0]!, args[1]!];
}
