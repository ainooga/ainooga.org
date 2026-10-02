// Seed historical choices without making hundreds of HTTP requests. Each seeded
// write-in has a distinct creator, matching legitimate chapter contributions.
export async function seedOptions(db: D1Database, count: number) {
  const people = Array.from({ length: count }, (_, i) => i + 100);
  await db.batch([
    db
      .prepare('INSERT INTO people (id) SELECT value FROM json_each(?)')
      .bind(JSON.stringify(people)),
    db
      .prepare(
        `INSERT INTO poll_options (poll_id,label,normalized_label,position,origin,created_by_person_id)
      SELECT p.id,'Seed '||j.value,'seed '||j.value,j.value,'write_in',j.value
      FROM polls p,json_each(?) j WHERE p.slug='topics'`,
      )
      .bind(JSON.stringify(people)),
  ]);
}
export async function optionIds(db: D1Database): Promise<number[]> {
  return (
    await db
      .prepare(
        "SELECT o.id FROM poll_options o JOIN polls p ON p.id=o.poll_id WHERE p.slug='topics' ORDER BY o.id",
      )
      .all<{ id: number }>()
  ).results.map((row) => row.id);
}
