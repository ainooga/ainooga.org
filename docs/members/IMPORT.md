# Member imports

Use an organizer API token to import normalized JSON through the Worker. Cloudflare credentials are not needed. The API adds chapter data without subscribing anyone to the newsletter, verifying their identity, or granting organizer access. Every imported person receives the `member` tag, which immediately makes them eligible for polls using that tag.

The [synthetic example](./example.json) is the complete input format. Keep real input, source converters, and reports in ignored `ai/`. Never put them in `content/`, `static/`, committed fixtures, or this directory.

## Commands

```sh
# Offline validation; no credentials or environment file needed.
pnpm members validate docs/members/example.json

# In an ignored environment file, set AINOOGA_API_TOKEN and AINOOGA_API_URL.
# Local API origin: http://localhost:8787
# Production API origin: https://ainooga.org
pnpm members --env-file .env.local preview ai/members.json
pnpm members --env-file .env.local import ai/members.json
```

The API URL must be explicitly configured. Existing process environment values take precedence over the environment file. HTTPS is required except on localhost; redirects are refused. Never put tokens in command arguments. Preview requires the same organizer token as import.

`validate` checks the entire file, duplicate email/source identities, contradictory shared event definitions, and request sizes. `preview` compares every record with D1 without writing. `import` validates and previews the whole file before sending any writes; an identity conflict blocks the upload. Preserved-value warnings do not block it. Preview is advisory; each import rechecks the current database state.

Results contain member/event/registration counts, action totals, and row/field references for preserved values or conflicts. Shared event actions are counted once. Rows are one-based; schema-validation paths are zero-based JSON array paths. Actions are `create`, `fill`, `preserve`, or `unchanged`, not a count of SQL statements. API reports describe each member independently; the CLI deduplicates shared event totals. Identical retries can refresh `last_imported_at` without reporting a content change.

Each member is one atomic request. The file is **not** one transaction: earlier members remain imported if a later request fails. The CLI stops and reports confirmed progress; the last request may have committed even if its response was lost. Safely rerun the same reviewed file. Do not change source keys or emails to bypass conflicts.

Failures retain the row/progress information and include safe client diagnostics. Missing or invalid configuration identifies `AINOOGA_API_TOKEN` or the API origin requirement. HTTP 401 means the token was rejected, 429 means rate limiting, and 503 means the service is unavailable, including maintenance or incomplete configuration. Transport failures and invalid responses have separate messages. Unexpected exceptions and server response bodies stay redacted. The CLI stops without automatic retries; correct the cause, then rerun the same file.

## Input and preservation rules

The file is an array of member objects, at most 5 MiB and 10,000 entries. Every field in the example is required. Use `null` for unknown optional values and empty arrays for absent tags/registrations. Unknown properties are rejected, including internal IDs, permissions, verification, and attendance fields. Each record must fit within 16 KiB and contain at most 25 tags and 25 registrations.

- `source` is a lowercase provenance namespace. `sourceKey` is that source's stable record key. Matching uses normalized email and `(source, sourceKey)`; existing associations must agree. An existing person with a different key under the same source requires manual reconciliation. Names, phones, and LinkedIn URLs never merge people.
- Missing people and email/contact identifiers are created, and the `member` tag is added. New identifiers are unverified. Missing people in a later file are not deleted or untagged. Membership is a tag, separate from consent.
- `company` creates or reuses an organization by trimmed, case-insensitive name and adds an `employee` relationship. Existing organization relationships remain; changed company names add a relationship without guessing whether the old one ended.
- Missing profile fields are filled. Existing values and verification are preserved. Tags and phone/LinkedIn identifiers are additive. Email normalization trims and lowercases without stripping dots or plus suffixes. Phone normalization removes formatting without adding a country code. LinkedIn values may be HTTPS URLs on `linkedin.com` or `www.linkedin.com`, or relative paths resolved against `https://www.linkedin.com`; the original value is retained.
- `eventInvites.subscribed` is a required JSON boolean. New invitation subscriptions use that preference. `false` also applies an opt-out to an existing record; `true` never overrides an existing opt-out. A subscribed record must have `unsubscribedAt: null`. Existing opt-out dates are retained; missing dates can be filled. Newsletter subscriptions and their confirmation links remain unchanged by member import. No email is sent.
- Events match only by `(platform, externalId)`. New events use supplied metadata; existing populated metadata and links are preserved. Optional missing metadata can be filled. Dates are UTC with milliseconds; `endsAt` must follow `startsAt`. URLs require HTTPS without embedded credentials. Timezones must be recognized IANA names.
- Registrations use `invited`, `approved`, `pending_approval`, `declined`, `waitlist`, or `cancelled`. Existing participation records are preserved. New records have unknown attendance and no invented registration/check-in timestamps. Imported events do not publish site content or automatically link to Markdown event pages.

## API and rollout

`POST /api/admin/members/import/preview` and `POST /api/admin/members/import` accept one member object from the example array. Send JSON with `Authorization: Bearer <token>`. Browser Origins must match `SITE_URL`; command-line requests may omit Origin. All configured organizer tokens have access. Existing chapter/auth readiness and API rate limits apply; poll readiness is independent.

Successful responses contain `{ actions: [{ field, action }], conflicts: [] }`. Preview returns `identity_conflict` in `conflicts` with no actions when associations disagree. Import returns HTTP 409 for that conflict, with no writes for that member. Validation/body-size/authentication errors use the existing 400/413/401/403 conventions. Errors never echo submitted values. SQL failures roll back the entire member, including newly created events. Responses are not cached, and application error logs contain only a request ID.

This version requires migration 0005 and its matching Worker. Follow the [schema rollout](../DATABASE.md#schema-simplification-rollout) before importing. It adds no secret or readiness flag. For an explicitly authorized production upload:

1. Keep the original export and reviewed normalized file in ignored storage. Resolve validation errors and review a production preview.
2. Record the baseline with `pnpm db:size --remote`.
3. Run `import` with the production environment file. Save its report under `ai/`; investigate any preserved differences or conflicts.
4. Rerun `preview`, reconcile every input member/event/registration with the outcomes, and record the new size. An identical file should propose no content additions or fills.
5. Complete the deferred newsletter, Turnstile voting, and restricted-poll checks after import. The `member` tag grants access to polls configured with that tag; explicit allowances are optional.

If interrupted, rerun the same file. If the file was wrong, stop and inspect the affected records before a targeted correction; do not delete shared people or restore the whole database over newer activity. Database recovery procedures remain in [DATABASE.md](../DATABASE.md).

## Scheduled Chattanooga sync

`worker/wrangler.member-sync.toml` defines the separate Worker. Migration 0006 adds one state row for scheduling, the encrypted AIC session, and the current roster position. Each cron tick processes up to ten members. Writes and progress commit together per member; interrupted runs resume, while failures schedule a fresh attempt. The next run is a random 4 to 6 hours after completion or failure, subject to cron delivery delays.

AIC name and role replace local values, including blanks. Contacts, company links, and tags follow the importer's additive rules. Local opt-outs, verification, newsletters, and members absent from the roster remain intact. There is no run-history or profile-staging table.

Export the bot's AIC cookies to ignored `ai/cookies.json`. Set a random 64-hex-character `AIC_SESSION_KEY` in ignored `worker/.dev.vars`, migrate local D1, then run `pnpm member-sync:session --local --env-file worker/.dev.vars ai/cookies.json`. The command validates the bot identity and imports only encrypted AIC session cookies. No browser or Google password is needed by the Worker. Renewed cookies are saved automatically; import a fresh export if authentication expires or is revoked.

Test with `pnpm member-sync:dev` and `curl --fail http://localhost:8787/__scheduled` for each chunk. Build with `pnpm member-sync:build`. For production, migrate D1, install `AIC_SESSION_KEY` as a secret on the sync Worker, and import cookies with `--remote --env-file <private-production.env>` using the same key. Set `crons=["* * * * *"]` and deploy with `pnpm exec wrangler deploy --config worker/wrangler.member-sync.toml`. The checked-in cron stays disabled. Inspect `next_run_at`, `last_finished_at`, `last_error`, and `cursor` in `member_sync_state`; times are Unix milliseconds.
