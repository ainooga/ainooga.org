import { eventKey, type MemberInput } from '../../worker/src/members/schemas.js';
import type { ImportResult } from '../../worker/src/members/report.js';

export function summarize(records: MemberInput[], results: ImportResult[]) {
  const changes = { create: 0, fill: 0, preserve: 0, unchanged: 0 };
  const seen = new Set<string>();
  const issues: { row: number; field: string; code: string }[] = [];
  results.forEach((result, index) => {
    for (const code of result.conflicts)
      issues.push({ row: index + 1, field: 'identity', code });
    for (const { field, action } of result.actions) {
      if (action === 'preserve')
        issues.push({ row: index + 1, field, code: 'preserved_existing' });
      const match = /^participations\.(\d+)\.event(.*)$/.exec(field);
      if (match) {
        const event = records[index]!.participations[Number(match[1])]?.event;
        if (!event) throw new Error('Invalid event index in API report.');
        const key = eventKey(event);
        if (seen.has(key) || seen.has(key + match[2]!)) continue;
        seen.add(key + match[2]!);
      }
      changes[action]++;
    }
  });
  return {
    members: records.length,
    events: new Set(
      records.flatMap((r) => r.participations.map((p) => eventKey(p.event))),
    ).size,
    registrations: records.reduce((sum, r) => sum + r.participations.length, 0),
    changes,
    issues,
    conflicts: results.reduce((sum, r) => sum + r.conflicts.length, 0),
  };
}
