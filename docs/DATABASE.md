# Chapter database

The API Worker uses Cloudflare D1. Migration `0002_chapter_schema.sql` implements the chapter schema; it does not add poll endpoints or import the private member export. The production database is not migrated by merging this PR. Deploy it using the maintenance procedure below.

Database tooling lives in the top-level `db/` directory: migration orchestration, preflight, backfill, verification, and size inspection. `migrations/` holds versioned SQL. Modules that use D1 keep their own adapters; the Worker adapter remains in `worker/src/db/`. Run the tooling from the repository root through the existing pnpm commands.

## Schema

Versioned SQL in `migrations/` is the authoritative schema. The new tables are:

| Area           | Tables                                                                           | Relationships and rules                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| People         | `people`, `person_identifiers`                                                   | A person has one optional, unsplit `name`. Email, Discord, phone, and LinkedIn identifiers live separately. Email/Discord lookup values are globally unique; phone/LinkedIn values can be shared. |
| Chapter        | `person_sources`, `memberships`, `person_tags`                                   | Membership is separate from identity. `memberships.source` references a source row belonging to that same person. Source namespace/key pairs are unique. Tags carry no permissions.               |
| Access         | `organizer_permissions`                                                          | Explicit, revocable `polls:manage`, `members:import`, and `ballots:read` grants. Importing a person never grants access. Authentication comes in a later PR.                                      |
| Organizations  | `organizations`, `organization_people`, `sponsorships`                           | Relationships are explicit. A sponsorship belongs to exactly one person or organization. Company text on a person does not create an organization.                                                |
| Existing forms | `subscriptions`, `contact_requests`                                              | One preference per person/category; delivery email must belong to that person. Inquiry details are retained as submitted snapshots and need no email or person link.                              |
| Events         | `events`, `event_links`, `event_participation`                                   | Markdown owns public event content; `ainooga_url` links D1 records to pages. Provider/ID identifies imported events. RSVP and attendance are separate.                                            |
| Polls          | `polls`, `poll_options`, `poll_allowlist`, `poll_ballots`, `poll_ballot_choices` | Each poll has its own eligibility list. One ballot per person/poll; composite foreign keys prevent cross-poll choices. Both honor and verified identity modes are represented.                    |

Foreign keys restrict deletion and updates. Timestamp writes use UTC ISO text with milliseconds. Nullable historical fields remain nullable. Integer bounds, boolean/enumerated values, sponsor ownership, poll selection bounds, and time ordering are checked in SQL. No cascading deletion or automatic person merging is provided.

The later APIs must enforce proof of identity, active grants/eligibility, publication and voting windows, selection counts across rows, write-in acceptance, result visibility, and configuration changes after publication. The schema alone is not an authorization system. Phone and LinkedIn identifiers cannot log into polls.

## Existing forms

The public paths and successful responses remain unchanged: `POST /api/subscribe`, `POST /api/contact-sponsor`, and `GET /confirm?token=...`. The Cloudflare route must be `ainooga.org/confirm*`: route matching includes query strings, so an exact `/confirm` pattern does not route emailed token links to the Worker.

Signup trims and lowercases email without rewriting dots or plus suffixes. Creating a person, identifier, and newsletter subscription happens in a single D1 batch. Concurrent duplicates return the existing-subscription response and do not send another confirmation. An existing person's profile is not overwritten, and an existing subscription preference is not reactivated.

Confirmation tokens are stored as SHA-256 hashes in the new subscription table. A successful confirmation clears the hash. Expired, consumed, invalid, or non-pending tokens cannot confirm a subscription. Migrated pending links continue working, and no new expiry is invented for them. New confirmations retain the existing no-expiry policy until that policy is explicitly revised. Confirmation does not mark an identifier as verified for polling.

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

`pnpm db:size --remote` runs Wrangler's production database information command. The Free per-database cap is 500 MB; the command's local percentage uses 500,000,000 bytes. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Migration behavior

`pnpm cf:migrate:local` runs preflight, applies versioned migrations, backfills, and verifies. A fresh local database is initialized automatically. `pnpm cf:migrate` explicitly targets production and requires the live handlers to report chapter maintenance mode. It does not deploy the Worker, take a backup, or enable readiness; perform those steps below first.

The separate commands default to local D1:

```sh
pnpm db:preflight
pnpm db:backfill
pnpm db:verify
```

Add `--remote` to explicitly target production. Remote backfill also checks the maintenance responses before writing.

Preflight rejects unexpected legacy table shapes, unsupported confirmation states (including null), malformed timestamps, normalized-email collisions, duplicate tokens, and unsupported values. Errors identify record IDs and fields without printing personal values. Resolve conflicts explicitly; never merge by name or shared contact details.

Production also has a legacy `subscribers.preferences` column containing JSON arrays of strings. Preflight accepts that known schema variant and includes its values in the source fingerprint. Those values remain in the retained legacy table; they are not interpreted as new subscription categories, consent, or permissions.

The migration leaves `subscribers` intact and renames old inquiries to `legacy_contact_requests`. The new Worker neither reads nor writes these legacy tables. They retain historical data, including old plaintext tokens, until a later reviewed cleanup migration. Keep database exports private.

Subscribers become people, email identifiers, `legacy_subscribers` source records, and newsletter subscriptions. Legacy subscriber IDs are reused for these records in the initially empty target tables. Inquiry IDs are preserved and their person links remain null. No membership, organizer grant, or poll eligibility is created.

Backfill records a source fingerprint and a fixed migration timestamp in `backups/chapter-migration-{local,remote}-ainooga-d1.json`. It inserts missing rows and accepts existing rows only if every field matches. An interrupted run can resume using that manifest; changed source data or mismatched target data stops the run. Private SQL work files are removed after each operation. The backup directory and manifest are created with restricted permissions.

Remote queries and small backfill batches use Wrangler's `--command` query mode. Remote `--file` invokes bulk import and returns an import summary rather than query rows. Local operations continue to use temporary SQL files.

Keep the same manifest until cutover is complete. If source records change between an early preflight and the maintenance window, review the change, archive the stale manifest, and rerun preflight after writes have stopped. Do not replace a manifest simply to bypass a conflict after backfill has started.

Verification checks expected table/index definitions, source fingerprints, transformed row values/counts, empty unrelated tables, foreign keys, and D1's supported `PRAGMA quick_check`. It is a **cutover check**: after forms reopen, new rows and consumed confirmation tokens make exact migration verification fail by design. Never rerun backfill over live application changes.

## Production cutover

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

Repeat the synthetic storage rehearsal with:

```sh
pnpm test --run tests/integration/capacity.test.ts
```

Measured locally with Miniflare 4.20260617.0:

| Dataset                                                                            | Allocated bytes | Decimal MB |
| ---------------------------------------------------------------------------------- | --------------: | ---------: |
| Empty legacy schema                                                                |          36,864 |   0.036864 |
| Empty chapter schema, retaining legacy tables                                      |         307,200 |   0.307200 |
| 200 synthetic subscribers migrated, retaining legacy copies                        |         475,136 |   0.475136 |
| Add 200 memberships, 10 events, 734 participation records, and one 200-ballot poll |         577,536 |   0.577536 |

These are measured fixtures, not a prediction of production growth. The persistent Wrangler database also includes migration bookkeeping; its empty migrated size was 315,392 bytes. Real text lengths, additional indexes, legacy retention, and future poll workloads affect storage.
