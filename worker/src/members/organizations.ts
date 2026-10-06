import type { MemberInput } from './schemas.js';
import { permitted, type ImportSql } from './sql.js';

export function organizationWrites(sql: ImportSql, input: MemberInput) {
  if (input.company === null) return [];
  return [
    sql.write(
      `INSERT INTO organizations(name) SELECT trim(?) WHERE ${permitted}
      ON CONFLICT DO NOTHING`,
      [input.company],
    ),
    sql.write(
      `INSERT INTO organization_people(organization_id,person_id,relationship)
      SELECT id,${sql.person},'employee' FROM organizations
      WHERE lower(trim(name))=lower(trim(?)) AND ${permitted}
      ON CONFLICT DO NOTHING`,
      [sql.email, input.company],
    ),
  ];
}
