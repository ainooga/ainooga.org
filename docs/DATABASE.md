# Chapter database

The API Worker uses Cloudflare D1. Migration `0005_simplify_chapter.sql` reduces the schema to 18 application tables plus the `events_with_counts` view. It requires the matching Worker and a maintenance window. Merging code does not migrate production D1 or import the private member export.

Database tooling lives in the top-level `db/` directory: migration orchestration, preflight, backfill, verification, and size inspection. `migrations/` holds versioned SQL. Modules that use D1 keep their own adapters; the Worker adapter remains in `worker/src/db/`. Run the tooling from the repository root through the existing pnpm commands.

## Schema

Versioned SQL in `migrations/` is authoritative. `db/schema-current.json` captures the resulting table, index, and view definitions for verification; update it with future schema migrations.

| Area           | Tables                                                         | Rules                                                                                                                                                  |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| People         | `people`, `person_identifiers`                                 | One profile with an optional unsplit name. Email/Discord lookup values are globally unique; phone/LinkedIn can be shared.                              |
| Chapter        | `person_sources`, `person_tags`                                | Provenance and descriptive tags. `member` identifies chapter members; tags can grant poll eligibility, never organizer access or consent.              |
| Organizations  | `organizations`, `organization_people`, `sponsorships`         | Companies use an `employee` relationship; organization names match trimmed/case-insensitive text. A sponsorship belongs to one person or organization. |
| Forms          | `subscriptions`, `contact_requests`                            | One preference per person/category. Delivery email belongs to that person. Inquiries retain submitted details with an optional person link.            |
| Events         | `events`, `event_links`, `event_participation`                 | Capacity is nullable. `events_with_counts.registered` counts approved registrations. Attendance remains separate.                                      |
| Polls          | `polls`, `poll_options`, `poll_ballots`, `poll_ballot_choices` | Live tag/explicit-person eligibility, optional option descriptions, one ballot per person/poll. Ballots hold latest retry metadata.                    |
| Authentication | `voter_sessions`, `auth_challenges`                            | Hashed session tokens/proofs, expiry and consumption state. Organizer tokens live in Worker configuration.                                             |

`person_identifiers.value` preserves display input, for example `Member@Example.com`; `normalized_value` is `member@example.com` for lookup and uniqueness. The two values can also differ for formatted phone numbers and LinkedIn paths.

`event_links` has the composite primary key `(event_id, platform)`. `event_id` is also a foreign key to `events`, so each event can have one link per platform. These constraints serve different purposes; a separate row ID would not replace either rule.

`polls.eligible_tags` and `allowed_person_ids` are JSON arrays, not PostgreSQL arrays or GIN indexes. SQLite cannot enforce a foreign key per JSON element. Organizer endpoints resolve identifiers to existing people, validate tag names, and update allowances atomically. Do not edit arrays directly without validating their contents. Eligibility checks join current people/tags; missing people never authenticate.

Ballots reference people and polls directly. Composite foreign keys on choices still prevent cross-poll selections. Accepted ballots remain counted after eligibility changes. Latest request ID, payload hash and private attempt nonce preserve retry/concurrency behavior without a separate receipt table.

Foreign keys restrict updates/deletes. Historical timestamps remain nullable; new writes use UTC ISO text with milliseconds. The API enforces authorization, selection counts, live eligibility and voting/edit windows. Phone and LinkedIn identifiers cannot log into polls.

## Existing forms

The public paths remain unchanged: `POST /api/subscribe`, `POST /api/contact-sponsor`, and `GET /confirm?token=...`. The Cloudflare route must be `ainooga.org/confirm*`: route matching includes query strings, so an exact `/confirm` pattern does not route emailed token links to the Worker.

Signup trims and lowercases email without rewriting dots or plus suffixes. Creating a person, identifier, and newsletter subscription happens in a single D1 batch. Concurrent duplicates return 200 with "A subscription request already exists for this address." and do not send another confirmation. An existing person's profile is not overwritten, and an existing subscription preference is not reactivated.

Confirmation tokens are stored as SHA-256 hashes in the new subscription table. A successful confirmation clears the hash. Expired, consumed, invalid, or non-pending tokens cannot confirm a subscription. Migrated pending links continue working, and no new expiry is invented for them. New confirmations retain the existing no-expiry policy until that policy is explicitly revised. Confirmation does not mark an identifier as verified for polling.

Confirmation emails escape user-provided names. Missing email configuration, rejected delivery, and a ten-second delivery timeout return a redacted 503. Failure clears only that attempt's still-pending website confirmation token. A later signup can atomically claim a replacement for the same email identifier; concurrent requests send at most one replacement. Confirmed/unsubscribed preferences, imported/legacy pending records, newer tokens, and successful confirmations remain unchanged. A late provider completion can deliver an invalidated link; the replacement link is authoritative. If token invalidation itself fails, the request fails with 500 and requires operator investigation; it never claims success.

Forms validate the server-side Turnstile response, require action `turnstile-spin-v1`, and match the permitted request Origin's hostname (or `SITE_URL` when Origin is absent). Existing canonical, www, Pages-preview and localhost origins remain supported. Foreign origins return 403; rejected proof returns 400; unavailable verification returns 503. Production and preview widget hostnames must also be allowed by Cloudflare. Poll authentication continues using `poll-auth`. Form and confirmation responses set no-store, no-referrer and nosniff headers in the Worker, including errors.

All three handlers require `CHAPTER_SCHEMA_READY=true`. Missing or other values return 503 before parsing input, accessing D1, verifying Turnstile, or sending email. Maintenance responses include CORS, `Retry-After: 60`, and `Cache-Control: no-store`. OPTIONS and other routes retain their normal behavior.

## Local development and inspection

Run commands from the repository root. Worker development, migrations, backfill, and size inspection share `worker/.wrangler/state`. The Worker configuration points to the root `migrations/` directory. Integration tests use isolated, disposable Miniflare databases.

```sh
pnpm cf:migrate:local
pnpm db:verify
pnpm db:size
```

For local forms, set `CHAPTER_SCHEMA_READY=true` in the ignored `worker/.dev.vars` after migration verification. Existing Turnstile, email, and site URL configuration still applies. Then run `pnpm worker:dev` and `pnpm dev`.

Find the actual SQLite file with:

```sh
rg --files --hidden --no-ignore worker/.wrangler/state/v3/d1 -g '*.sqlite'
```

The file lives under `miniflare-D1DatabaseObject/`. A `-wal` file can contain recent changes while the database is open. Use `pnpm db:size` for allocated database size including indexes, rather than the main file's byte count alone. It opens the same D1 binding through Miniflare and reads its size metadata. Wrangler's local JSON output omits that metadata, and D1 rejects the page-count pragmas through its SQL API.

`pnpm db:size --remote` runs Wrangler's production database information command. This deployment uses Workers Paid: the per-database limit is 10 GB, and the account includes 5 GB of total D1 storage before storage charges. The local output reports `bytes`, decimal `mb`, `paidDatabaseLimitBytes`, and `percentOfPaidDatabaseLimit`; it replaces `percentOf500MB`. Remote output remains Wrangler's database information. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Migration behavior

`pnpm cf:migrate:local` applies pending migrations and verifies current definitions, foreign keys and integrity. Empty local databases initialize automatically; populated legacy-only databases and empty remote databases require the historical chapter cutover first. `pnpm cf:migrate` targets production. `pnpm db:verify` checks the current schema without replaying historical backfills.

Before 0005, the migration command reconciles retained subscribers and inquiries. It fills missing records, preserves current subscription status and consumed-token state, hashes still-needed pending tokens, and stops on conflicting identities/provenance/inquiry IDs. Obsolete legacy preferences are deliberately discarded. SQL guards prevent dropping unreconciled records. Reconciliation can be rerun after interruption. Historical migrations remain unchanged.

Before any reconciliation or migration writes, the command checks existing organizations for name collisions using SQLite's `lower(trim(name))`, matching the new unique index. A collision stops the command with grouped organization IDs, without printing names. Rename distinct organizations or deliberately reconcile duplicates while preserving their sponsorships and person relationships, then rerun the command.

Migration 0005 replaces subscription `status` with `subscribed`, stored as SQLite `0`/`1`. For event invitations, every old state except `unsubscribed` becomes true. For newsletters, only old `pending` and `confirmed` records become true. Newsletter confirmation is separate: `confirmation_pending=1` means confirmation is still required. Newsletter recipients must satisfy both `subscribed=1` and `confirmation_pending=0`. Existing confirmation tokens and timestamps are preserved; dates are not invented for historical records. Member imports never create newsletter subscriptions.

If a local database already applied an earlier version of the undeployed 0005 migration, applying migrations again will not replay it. Recreate that development database and re-import using the updated boolean format before running the updated Worker. Do not reset production.

### Schema simplification rollout

Before entering maintenance, run this read-only query against the target database. No rows means no current organization-name collisions. The migration command checks again before writing; the unique index remains the final constraint.

```sql
SELECT group_concat(id, ', ') AS organization_ids
FROM (
  SELECT id, lower(trim(name)) AS name_key
  FROM organizations
  ORDER BY id
)
GROUP BY name_key
HAVING count(*) > 1
ORDER BY min(id);
```

For production, use `pnpm exec wrangler d1 execute ainooga-d1 --config worker/wrangler.toml --remote --command "SELECT group_concat(id, ', ') AS organization_ids FROM (SELECT id, lower(trim(name)) AS name_key FROM organizations ORDER BY id) GROUP BY name_key HAVING count(*) > 1 ORDER BY min(id)"`. Resolve any reported collisions before continuing.

1. Before merging/deploying this Worker, set existing Worker secrets `CHAPTER_SCHEMA_READY=false` and `AUTH_READY=false`. Confirm form/confirmation maintenance responses and API 503 responses; allow in-flight requests to finish. `AUTH_READY=false` also stops scheduled auth cleanup. Pause other database writers.
2. Deploy the matching Worker with maintenance still enabled. Do not run old application code against the simplified schema.
3. Run `pnpm cf:migrate`, then `pnpm db:verify --remote` and `pnpm db:size --remote`. Keep maintenance enabled if any step fails. Resolve collisions explicitly rather than rerunning the old exact-row backfill.
4. Reconcile people/subscriptions/inquiries and confirm ballots/choices/revisions survived. Migration copies active old allowances without current tag matches as explicit person IDs. Tagged people use live tags. Old snapshot-versus-manual provenance cannot be recovered; old revocations no longer override matching tags.
5. Enable `CHAPTER_SCHEMA_READY=true` and `AUTH_READY=true`; keep the existing `POLLS_READY=true`. Deploy the compatible SPA and refresh open poll pages. Check organizer auth, forms, eligible/ineligible poll access, voting/retry and results. Do not reset production.

Set a flag with `pnpm exec wrangler secret put NAME --config worker/wrangler.toml`, entering `false` or `true` at the prompt. A Worker-only rollback after 0005 is incompatible; recovery needs a matching database schema and Worker. See [D1 foreign-key behavior](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) for the table-replacement constraints used by the migration.

### Historical chapter cutover tooling

The following commands are for the historical chapter cutover only. Backfill and cutover verification reject the later authentication schema:

The separate commands default to local D1:

```sh
pnpm db:preflight
pnpm db:backfill
pnpm db:verify:cutover
```

Add `--remote` to explicitly target production. Remote backfill also checks the maintenance responses before writing.

Preflight rejects unexpected legacy table shapes, unsupported confirmation states (including null), malformed timestamps, normalized-email collisions, duplicate tokens, and unsupported values. Errors identify record IDs and fields without printing personal values. Resolve conflicts explicitly; never merge by name or shared contact details.

Production also has a legacy `subscribers.preferences` column containing JSON arrays of strings. Preflight accepts that known schema variant and includes its values in the source fingerprint. Those values remain in the retained legacy table; they are not interpreted as new subscription categories, consent, or permissions.

The migration leaves `subscribers` intact and renames old inquiries to `legacy_contact_requests`. The new Worker neither reads nor writes these legacy tables. They retain historical data, including old plaintext tokens, until a later reviewed cleanup migration. Keep database exports private.

Subscribers become people, email identifiers, `legacy_subscribers` source records, and newsletter subscriptions. Legacy subscriber IDs are reused for these records in the initially empty target tables. Inquiry IDs are preserved and their person links remain null. No membership, organizer grant, or poll eligibility is created.

Backfill records a source fingerprint and a fixed migration timestamp in `backups/chapter-migration-{local,remote}-ainooga-d1.json`. It inserts missing rows and accepts existing rows only if every field matches. An interrupted run can resume using that manifest; changed source data or mismatched target data stops the run. Private SQL work files are removed after each operation. The backup directory and manifest are created with restricted permissions.

Remote queries and small backfill batches use Wrangler's `--command` query mode. Remote `--file` invokes bulk import and returns an import summary rather than query rows. Local operations continue to use temporary SQL files.

Keep the same manifest until cutover is complete. If source records change between an early preflight and the maintenance window, review the change, archive the stale manifest, and rerun preflight after writes have stopped. Do not replace a manifest simply to bypass a conflict after backfill has started.

Legacy cutover verification checks expected table/index definitions, source fingerprints, transformed row values/counts, empty unrelated tables, foreign keys, and D1's supported `PRAGMA quick_check`. It is a **cutover check**: after forms reopen, new rows and consumed confirmation tokens make exact migration verification fail by design. Never rerun backfill over live application changes.

## Production cutover

Historical PR 2 procedure, completed before migration 0003. For recovery to a populated legacy database, use the PR 2 tooling and migrations from commit `d7b665f` in an isolated checkout with the matching Worker. The historical commands below refer to that version. Current routine migration intentionally refuses a legacy database; never apply all current migrations before completing legacy backfill.

1. Check the actual Cloudflare Worker Git integration and production branch. The old deployment notes are not evidence of dashboard state. Prevent an automatic Worker deployment from bypassing this sequence. Pages remains available throughout.
2. Set `CHAPTER_SCHEMA_READY` to `false` as a Worker secret, then deploy the new Worker. Keeping this operator setting as a secret prevents a later ordinary deployment from replacing its value. The old Worker ignores the setting; maintenance starts when the new Worker is deployed.
3. Confirm all three handlers return 503 with `X-Chapter-Maintenance: true`. Let in-flight requests finish and confirm writes have stopped. Disable any other database writers for the window.
4. Run production preflight. Export a timestamped SQL backup, record a Time Travel bookmark and database size, and save the previous Worker version ID. Confirm the backup exists and keep it private.
5. Run `pnpm cf:migrate`, then `pnpm db:verify --remote` and `pnpm db:size --remote`. Leave maintenance enabled on any failure. Reconcile counts and field values before reopening.
6. Set `CHAPTER_SCHEMA_READY` to `true`. Smoke-test signup and email delivery, an existing pending confirmation link, invalid/replayed confirmation, and a sponsor inquiry. Monitor Worker errors and database size.

Commands for the explicit operator steps:

```sh
# Enter false at the prompt before deploying; true only after verification.
pnpm exec wrangler secret put CHAPTER_SCHEMA_READY --config worker/wrangler.toml
pnpm worker:deploy
pnpm db:preflight --remote
pnpm cf:backup
pnpm exec wrangler d1 time-travel info ainooga-d1 --config worker/wrangler.toml
pnpm db:size --remote
pnpm cf:migrate
pnpm db:verify --remote
```

No production operation is part of the automated test suite. No real member upload occurs in this PR.

## Recovery and validation

Before reopening, keep maintenance enabled and either resume the current migration/reconciliation command or restore the pre-migration database and its matching Worker version. Do not run the historical exact-row backfill on schema 0005. D1 Time Travel restores the database in place; retain the recorded bookmark and SQL export. See [Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/).

After reopening, restoring the old snapshot would discard accepted signups, confirmations, and inquiries. Re-enable maintenance, export the current state, and reconcile those writes before attempting recovery. A Worker-only rollback is incompatible with the renamed inquiry table. Migration 0005 removes the legacy tables after reconciliation.

Run `pnpm check` for lint, both TypeScript targets, handler/component tests, and local D1 integration tests. `pnpm test:db` runs the D1 suite alone. Tests cover fresh and populated migrations, interrupted/repeated backfills, conflict rejection, legacy recovery, concurrent signup, confirmation lifecycle, ownership constraints, and poll isolation.

## Capacity review: 2026-10-04

The measurements below are historical, from schema 0004. The fixture now targets 0005; rerun it on actual Miniflare/D1 for a current measurement:

```sh
pnpm exec vitest run tests/integration/capacity.test.ts
# Optional table/index breakdown; requires /usr/bin/sqlite3 with dbstat support:
AINOOGA_CAPACITY_INDEXES=1 pnpm exec vitest run tests/integration/capacity.test.ts
```

The original measurement applied all four migrations available at that time. The fixture contains 200 synthetic members with email, phone, LinkedIn-style identifiers, profiles, provenance, memberships, two invitation opt-outs and 198 unknown invitation preferences. It adds 10 events, provider links, and 734 participation records. Membership creates no newsletter consent or organizer grant. Legacy tables remain present but empty; existing production legacy rows are additional storage.

The five-year model retains 24 polls per year. Each poll has 200 eligible members, 200 ballots with two choices each, 10 predefined options, 20 write-ins, and 200 current submission receipts with UUID-length request IDs. This yields 24,000 ballots, 48,000 choices, 3,600 options, and 24,000 receipts. A real ballot edit and identical retry exercise the current query implementation on that dataset. The fixtures seed rows directly for storage measurement; they do not implement or validate the future importer.

Measured with Miniflare 4.20260617.0, using D1 `meta.size_after` (tables and indexes included):

| Stage                                     | Allocated bytes | Decimal MB |
| ----------------------------------------- | --------------: | ---------: |
| Empty current schema                      |         364,544 |   0.364544 |
| Synthetic chapter                         |         647,168 |   0.647168 |
| One poll                                  |         724,992 |   0.724992 |
| 24 polls                                  |       2,842,624 |   2.842624 |
| 120 polls                                 |      11,694,080 |  11.694080 |
| Ballot edit and accepted retry            |      11,694,080 |  11.694080 |
| Add 200 sessions and 1,000 challenges     |      12,120,064 |  12.120064 |
| Expired authentication cleanup            |      11,694,080 |  11.694080 |
| Reinsert the same authentication workload |      12,120,064 |  12.120064 |

After closing Miniflare, SQLite `dbstat` reports 8,376,320 bytes of table pages, 3,719,168 bytes of index pages (including automatic indexes), and 24,576 bytes of internal pages. These sum to the final allocated size. Cleanup/reinsertion does not accumulate storage. Production SQLite allocation need not shrink immediately after deletes; this test does not promise file-size reclamation on every host.

The maximum measured stage is about 0.1212% of the Paid 10 GB database limit. The two aggregate-result queries read 2,288 and 400 rows for one 200-voter poll in this fixture. Voter detail, results, identifiable organizer ballots, an edit and an accepted retry pass; the options query uses `idx_options_order`. These are local fixture measurements, not production latency or distributed load guarantees. Text lengths, retained legacy data, event growth, traffic and abuse can change storage and cost.

Check `pnpm db:size --remote` before and after imports and periodically during operation. Review capacity at 8 GB for this database or 4 GB combined account D1 storage, before the 10 GB limit or 5 GB included storage respectively. Account usage must include other databases; this database's size alone cannot establish available included storage. These are manual review thresholds, not new enforced quotas. On 2026-10-04 production reported approximately 381 kB, with no pending migrations and successful schema, foreign-key and integrity verification.

## Current recovery diagnostics

Read-only checks use the Worker configuration:

```sh
pnpm db:verify --remote
pnpm db:size --remote
pnpm exec wrangler d1 migrations list ainooga-d1 --remote --config worker/wrangler.toml
pnpm exec wrangler d1 time-travel info ainooga-d1 --config worker/wrangler.toml
```

Time Travel information was successfully retrieved during this review. Workers Paid retains 30 days of recovery history; see [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). No export or restore was performed, so restore execution remains untested. If recovery becomes necessary, pause form and auth/poll writes with the existing readiness secrets, allow in-flight requests to finish, record the current bookmark and Worker version, and reconcile any writes that an older snapshot would discard. Restore only with a matching schema/Worker version, run verification, then reopen writes. The historical PR 2 backfill procedure above is not a routine recovery command for the current schema.
