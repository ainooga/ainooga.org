export type Value = string | number | null;
export type Row = Record<string, Value>;

export interface SqlStore {
  query(sql: string): Promise<Row[]>;
  execute(statements: string[]): Promise<void>;
}

export interface LegacyData {
  subscribers: Row[];
  contacts: Row[];
}

export interface Manifest {
  version: 1;
  target: string;
  fingerprint: string;
  migratedAt: string;
}

export interface ExpectedRow {
  table: string;
  row: Row;
}

export function literal(value: Value): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Unsafe numeric database value');
    return String(value);
  }
  if (value.includes('\0')) throw new Error('NUL characters are not supported');
  return `'${value.replaceAll("'", "''")}'`;
}

export function insertSql({ table, row }: ExpectedRow): string {
  return `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(literal).join(', ')})`;
}
