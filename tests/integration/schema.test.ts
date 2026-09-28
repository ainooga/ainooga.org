// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { chapterDatabase } from '../helpers/d1';

let context: Awaited<ReturnType<typeof chapterDatabase>>;
beforeEach(async () => {
  context = await chapterDatabase();
  await context.store.execute([
    "INSERT INTO people (id,name) VALUES (1,'One'),(2,'Two')",
  ]);
});
afterEach(async () => {
  await context.dispose();
});
const run = (sql: string) => context.store.execute([sql]);

describe('chapter SQL constraints', () => {
  it.each(['email', 'discord'])('requires global uniqueness for %s', async (kind) => {
    await run(
      `INSERT INTO person_identifiers (person_id,kind,value,normalized_value) VALUES (1,'${kind}','same','same')`,
    );
    await expect(
      run(
        `INSERT INTO person_identifiers (person_id,kind,value,normalized_value) VALUES (2,'${kind}','same','same')`,
      ),
    ).rejects.toThrow();
  });
  it.each(['phone', 'linkedin'])(
    'allows a shared %s but no per-person duplicate',
    async (kind) => {
      await run(
        `INSERT INTO person_identifiers (person_id,kind,value,normalized_value) VALUES (1,'${kind}','same','same'),(2,'${kind}','same','same')`,
      );
      await expect(
        run(
          `INSERT INTO person_identifiers (person_id,kind,value,normalized_value) VALUES (1,'${kind}','same','same')`,
        ),
      ).rejects.toThrow();
    },
  );
  it('requires the membership source and delivery identifier to belong to the person', async () => {
    await run(
      "INSERT INTO person_sources (id,person_id,source,source_key) VALUES (10,1,'manual','one')",
    );
    await expect(
      run("INSERT INTO memberships VALUES (2,'active',NULL,NULL,10)"),
    ).rejects.toThrow();
    await run("INSERT INTO memberships VALUES (1,'active',NULL,NULL,10)");
    await run(
      "INSERT INTO person_identifiers (id,person_id,kind,value,normalized_value) VALUES (10,1,'email','a@example.com','a@example.com')",
    );
    await expect(
      run(
        "INSERT INTO subscriptions (person_id,email_identifier_id,kind,status) VALUES (2,10,'newsletter','pending')",
      ),
    ).rejects.toThrow();
    await expect(run('DELETE FROM person_sources WHERE id=10')).rejects.toThrow();
  });
  it('requires exactly one sponsor and a valid known time range', async () => {
    await run("INSERT INTO organizations (id,name) VALUES (1,'Company')");
    await expect(
      run("INSERT INTO sponsorships (tier) VALUES ('community')"),
    ).rejects.toThrow();
    await expect(
      run(
        "INSERT INTO sponsorships (person_id,organization_id,tier) VALUES (1,1,'gold')",
      ),
    ).rejects.toThrow();
    await expect(
      run(
        "INSERT INTO sponsorships (person_id,tier,starts_at,ends_at) VALUES (1,'gold','2026-02-01','2026-01-01')",
      ),
    ).rejects.toThrow();
    await run("INSERT INTO sponsorships (person_id,tier) VALUES (1,'community')");
  });
  it('allows unknown capacity and keeps attendance separate from RSVP', async () => {
    await run(
      "INSERT INTO events (id,name,starts_at) VALUES (1,'Event','2026-01-01T00:00:00.000Z')",
    );
    await run(
      "INSERT INTO event_participation (event_id,person_id,registration_status,source) VALUES (1,1,'approved','manual')",
    );
    expect(
      await context.store.query('SELECT attendance_status FROM event_participation'),
    ).toEqual([{ attendance_status: 'unknown' }]);
    await expect(
      run("UPDATE event_participation SET checked_in_at='2026-01-01T00:00:00.000Z'"),
    ).rejects.toThrow();
    await expect(run('UPDATE events SET capacity=-1')).rejects.toThrow();
    await expect(run('UPDATE events SET capacity=1.5')).rejects.toThrow();
  });
  it('rejects invalid poll configuration and cross-poll ballots/choices', async () => {
    await run(`INSERT INTO polls (id,slug,title,identity_mode,min_selections,results_visibility,starts_at,ends_at,created_by)
      VALUES (1,'one','One','honor',1,'never','2026-01-01','2026-02-01',1),(2,'two','Two','verified',1,'after_vote','2026-01-01','2026-02-01',1)`);
    for (const update of [
      'min_selections=0',
      'max_selections=0',
      'allow_edits=2',
      "edit_deadline='2026-01-15'",
      "ends_at='2025-01-01'",
    ]) {
      await expect(run(`UPDATE polls SET ${update} WHERE id=1`)).rejects.toThrow();
    }
    await run(
      "INSERT INTO poll_options (id,poll_id,label,normalized_label,origin) VALUES (1,1,'A','a','predefined'),(2,2,'B','b','predefined')",
    );
    await expect(
      run(
        "INSERT INTO poll_options (poll_id,label,normalized_label,origin) VALUES (1,'Write','write','write_in')",
      ),
    ).rejects.toThrow();
    await expect(
      run('INSERT INTO poll_ballots (poll_id,person_id) VALUES (1,1)'),
    ).rejects.toThrow();
    await run('INSERT INTO poll_allowlist (poll_id,person_id) VALUES (1,1),(2,1)');
    await run('INSERT INTO poll_ballots (id,poll_id,person_id) VALUES (1,1,1),(2,2,1)');
    await expect(
      run('INSERT INTO poll_ballots (poll_id,person_id) VALUES (1,1)'),
    ).rejects.toThrow();
    await run('INSERT INTO poll_ballot_choices VALUES (1,1,1)');
    await expect(run('INSERT INTO poll_ballot_choices VALUES (1,1,1)')).rejects.toThrow();
    await expect(run('INSERT INTO poll_ballot_choices VALUES (1,1,2)')).rejects.toThrow();
    await expect(run('INSERT INTO poll_ballot_choices VALUES (1,2,2)')).rejects.toThrow();
    await run("UPDATE poll_allowlist SET revoked_at='2026-01-02' WHERE poll_id=1");
    await expect(run('DELETE FROM poll_allowlist WHERE poll_id=1')).rejects.toThrow();
  });
});
