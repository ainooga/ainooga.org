# Chapter database

The API Worker uses Cloudflare D1. Migration `0002_chapter_schema.sql` implements the chapter schema; `0003_voter_auth.sql` adds voter sessions and verification challenges; `0004_poll_api.sql` adds saved poll eligibility tags and latest ballot submission receipts. The chapter cutover is complete. Authentication migration and enablement remain separate deployment steps; see [API authentication](./API.md). Merging code does not migrate production D1 or import the private member export.

Database tooling lives in the top-level `db/` directory: migration orchestration, preflight, backfill, verification, and size inspection. `migrations/` holds versioned SQL. Modules that use D1 keep their own adapters; the Worker adapter remains in `worker/src/db/`. Run the tooling from the repository root through the existing pnpm commands.

## Schema

Versioned SQL in `migrations/` is the authoritative schema. The new tables are:

| Area           | Tables                                                                           | Relationships and rules                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| People         | `people`, `person_identifiers`                                                   | A person has one optional, unsplit `name`. Email, Discord, phone, and LinkedIn identifiers live separately. Email/Discord lookup values are globally unique; phone/LinkedIn values can be shared. |
| Chapter        | `person_sources`, `memberships`, `person_tags`                                   | Membership is separate from identity. `memberships.source` references a source row belonging to that same person. Source namespace/key pairs are unique. Tags carry no permissions.               |
| Access         | `organizer_permissions`                                                          | Reserved permission records. Organizer authentication currently uses configured Worker API tokens with one organizer access level; this table is unchanged and unused by authentication.          |
| Organizations  | `organizations`, `organization_people`, `sponsorships`                           | Relationships are explicit. A sponsorship belongs to exactly one person or organization. Company text on a person does not create an organization.                                                |
| Existing forms | `subscriptions`, `contact_requests`                                              | One preference per person/category; delivery email must belong to that person. Inquiry details are retained as submitted snapshots and need no email or person link.                              |
| Events         | `events`, `event_links`, `event_participation`                                   | Markdown owns public event content; `ainooga_url` links D1 records to pages. Provider/ID identifies imported events. RSVP and attendance are separate.                                            |
| Polls          | `polls`, `poll_options`, `poll_allowlist`, `poll_ballots`, `poll_ballot_choices` | Each poll has its own eligibility list. One ballot per person/poll; composite foreign keys prevent cross-poll choices. Both honor and verified identity modes are represented.                    |

Foreign keys restrict deletion and updates. Timestamp writes use UTC ISO text with milliseconds. Nullable historical fields remain nullable. Integer bounds, boolean/enumerated values, sponsor ownership, poll selection bounds, and time ordering are checked in SQL. No cascading deletion or automatic person merging is provided.

Polling API tables `poll_eligible_tags` and `poll_submission_receipts` store saved tag criteria and one latest idempotency receipt per person/poll. Tag criteria are resolved once into the allowlist at publication; a receipt references that allowlist and coordinates atomic ballot writes. See [poll rules and rollout](./polls/POLLS.md).

Authentication tables `voter_sessions` and `auth_challenges` contain only hashed session tokens, HMAC email proofs, hashed OAuth/browser state, expiry, and attempt/consumption records alongside their chapter references. Organizer credentials live in a Worker secret, not D1.

The later APIs must enforce organizer authorization, voter proof and eligibility, publication and voting windows, selection counts across rows, write-in acceptance, result visibility, and configuration changes after publication. The schema alone is not an authorization system. Phone and LinkedIn identifiers cannot log into polls.

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

`pnpm cf:migrate:local` applies pending versioned migrations and verifies the current schema, foreign keys, and integrity. An empty local database is initialized automatically. `pnpm cf:migrate` explicitly targets production. Existing chapter databases are verified before migration; populated legacy databases and empty remote databases are rejected. These commands never rerun legacy backfill or compare live records to a migration manifest. They do not deploy the Worker or enable authentication.

For poll migration 0004, keep `POLLS_READY` absent/false, apply the migration, verify, then deploy and enable the new routes using the [poll rollout steps](./polls/POLLS.md#development-and-deployment). The two additive tables leave chapter/authentication definitions and existing forms unchanged. Ordinary `db:verify` now checks all definitions through 0004.

For authentication migration 0003, leave existing forms open, apply the migration, run `pnpm db:verify --remote`, and follow [API deployment](./API.md#configuration-and-deployment). Ordinary verification is safe after application writes.

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

Before reopening, keep maintenance enabled and either resume the backfill or restore the pre-migration database and its matching Worker version. D1 Time Travel restores the database in place; retain the recorded bookmark and SQL export. See [Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/).

After reopening, restoring the old snapshot would discard accepted signups, confirmations, and inquiries. Re-enable maintenance, export the current state, and reconcile those writes before attempting recovery. A Worker-only rollback is incompatible with the renamed inquiry table. Legacy table removal is deliberately deferred.

Run `pnpm check` for lint, both TypeScript targets, handler/component tests, and local D1 integration tests. `pnpm test:db` runs the D1 suite alone. Tests cover fresh and populated migrations, interrupted/repeated backfills, conflict rejection, legacy recovery, concurrent signup, confirmation lifecycle, ownership constraints, and poll isolation.

## Capacity review: 2026-10-04

Run the current-schema rehearsal on a disposable local database:

```sh
pnpm exec vitest run tests/integration/capacity.test.ts
# Optional table/index breakdown; requires /usr/bin/sqlite3 with dbstat support:
AINOOGA_CAPACITY_INDEXES=1 pnpm exec vitest run tests/integration/capacity.test.ts
```

All four migrations are applied. The fixture contains 200 synthetic members with email, phone, LinkedIn-style identifiers, profiles, provenance, memberships, two invitation opt-outs and 198 unknown invitation preferences. It adds 10 events, provider links, and 734 participation records. Membership creates no newsletter consent or organizer grant. Legacy tables remain present but empty; existing production legacy rows are additional storage.

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
