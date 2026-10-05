# Member imports

Use an organizer API token to import normalized JSON through the Worker. Cloudflare credentials are not needed. The API adds chapter data without subscribing anyone to the newsletter, verifying their identity, granting organizer permissions, or adding them to a poll.

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

## Input and preservation rules

The file is an array of member objects, at most 5 MiB and 10,000 entries. Every field in the example is required. Use `null` for unknown optional values and empty arrays for absent tags/registrations. Unknown properties are rejected, including internal IDs, permissions, verification, and attendance fields. Each record must fit within 16 KiB and contain at most 25 tags and 25 registrations.

- `source` is a lowercase provenance namespace. `sourceKey` is that source's stable record key. Matching uses normalized email and `(source, sourceKey)`; existing associations must agree. An existing person with a different key under the same source requires manual reconciliation. Names, phones, and LinkedIn URLs never merge people.
- Missing people, email/contact identifiers, and active memberships are created. New identifiers are unverified; membership dates remain unknown. Existing memberships retain their status, dates, and provenance. Missing people in a later file are not deleted or deactivated.
- Missing profile fields are filled. Existing values and verification are preserved. Tags and phone/LinkedIn identifiers are additive. Email normalization trims and lowercases without stripping dots or plus suffixes. Phone normalization removes formatting without adding a country code. LinkedIn values may be HTTPS URLs on `linkedin.com` or `www.linkedin.com`, or relative paths resolved against `https://www.linkedin.com`; the original value is retained.
- `eventInvites.status` accepts only `unknown` or `unsubscribed`. An explicit opt-out can suppress an existing invitation subscription and clears pending confirmation tokens. An unknown preference never restores consent. Existing opt-out dates are retained; missing dates can be filled. Newsletter subscriptions and their confirmation links remain unchanged. No email is sent.
- Events match only by `(platform, externalId)`. New events use supplied metadata; existing populated metadata and links are preserved. Optional missing metadata can be filled. Dates are UTC with milliseconds; `endsAt` must follow `startsAt`. URLs require HTTPS without embedded credentials. Timezones must be recognized IANA names.
- Registrations use `invited`, `approved`, `pending_approval`, `declined`, `waitlist`, or `cancelled`. Existing participation records are preserved. New records have unknown attendance and no invented registration/check-in timestamps. Imported events do not publish site content or automatically link to Markdown event pages.

## API and rollout

`POST /api/admin/members/import/preview` and `POST /api/admin/members/import` accept one member object from the example array. Send JSON with `Authorization: Bearer <token>`. Browser Origins must match `SITE_URL`; command-line requests may omit Origin. All configured organizer tokens have access. Existing chapter/auth readiness and API rate limits apply; poll readiness is independent.

Successful responses contain `{ actions: [{ field, action }], conflicts: [] }`. Preview returns `identity_conflict` in `conflicts` with no actions when associations disagree. Import returns HTTP 409 for that conflict, with no writes for that member. Validation/body-size/authentication errors use the existing 400/413/401/403 conventions. Errors never echo submitted values. SQL failures roll back the entire member, including newly created events. Responses are not cached, and application error logs contain only a request ID.

This feature needs no migration, secret, or new readiness flag. Deploy the Worker through the existing build workflow after merge. For an explicitly authorized production upload:

1. Keep the original export and reviewed normalized file in ignored storage. Resolve validation errors and review a production preview.
2. Record the baseline with `pnpm db:size --remote`.
3. Run `import` with the production environment file. Save its report under `ai/`; investigate any preserved differences or conflicts.
4. Rerun `preview`, reconcile every input member/event/registration with the outcomes, and record the new size. An identical file should propose no content additions or fills.
5. Complete the deferred newsletter, Turnstile voting, and restricted-poll checks after import. Membership alone does not make a person eligible; use the existing poll allowlist workflow.

If interrupted, rerun the same file. If the file was wrong, stop and inspect the affected records before a targeted correction; do not delete shared people or restore the whole database over newer activity. Database recovery procedures remain in [DATABASE.md](../DATABASE.md).
