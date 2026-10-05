# API authentication

The Worker authorizes requests and uses its D1 binding for database operations. Organizer commands require an application API token, not a Cloudflare login. The initial release has one organizer access level: every configured organizer token can use organizer endpoints. The existing `organizer_permissions` table is reserved and does not participate in this access model.

## Organizer setup

A deployment maintainer generates one token per organizer with `openssl rand -hex 32`. Set `ORGANIZER_API_TOKENS` as a Worker secret using the dashboard or:

```sh
pnpm exec wrangler secret put ORGANIZER_API_TOKENS --config worker/wrangler.toml
```

Enter a JSON array with the organizer's name, existing `people.id`, and generated token:

```json
[{ "name": "Organizer", "personId": 1, "token": "REPLACE_WITH_64_HEX_CHARACTERS" }]
```

Use actual person IDs. If an organizer has no person record, the deployment maintainer can create a minimal `people` record once during setup; this does not create membership or subscriptions. Tokens remain valid until their entries are removed or replaced and the updated secret is deployed. No credential-management service or per-token scopes are involved.

Each organizer copies `.env.example` to `.env`, adds their assigned `AINOOGA_API_TOKEN`, and runs:

```sh
pnpm api:whoami
```

The command loads `.env`, sends `Authorization: Bearer <token>`, and prints the organizer name and person ID. It follows no redirects and uses HTTPS except on localhost. The `.env` file is already ignored; never use a `VITE_` prefix for this token. The command uses Node's `--env-file` support (Node 20.6+).

## Endpoints

Poll slugs use 1–160 ASCII letters, digits, underscores, or hyphens. Authentication requires a published poll and its active allowlist. The voting window is enforced by the ballot endpoints, not by login. This allows login after voting closes to view permitted results later.

All POST bodies below are strict JSON objects. Unknown fields are rejected. Organizer requests use the bearer header; voter requests use cookies. Browser mutations must send the exact `SITE_URL` origin. Production authentication is same-origin at `https://ainooga.org`; preview sites cannot use production authentication. Local tools may omit `Origin` when using an organizer bearer token.

| Method and path                                 | Input                                                    | Result                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/admin/me`                             | Organizer token                                          | `{ name, personId }`                                                                     |
| `POST /api/admin/people/{personId}/identifiers` | Organizer token; `{ kind: "email" or "discord", value }` | `{ id, personId }`; idempotent for the same owner, `409` for another owner               |
| `POST /api/polls/{slug}/auth/honor`             | `{ identifier: { kind, value }, turnstileToken }`        | Poll-bound honor session cookie                                                          |
| `POST /api/polls/{slug}/auth/email/request`     | `{ email, turnstileToken }`                              | `202`, `{ challengeId, message }`, browser challenge cookie                              |
| `POST /api/polls/{slug}/auth/email/verify`      | `{ challengeId, code }` and challenge cookie             | Verified session cookie                                                                  |
| `POST /api/polls/{slug}/auth/discord/start`     | `{ turnstileToken }`                                     | `{ url }` and challenge cookie; navigate the browser to the URL                          |
| `GET /api/auth/discord/callback`                | Provider `state` and `code`, challenge cookie            | Verified session cookie and redirect to `/#/polls/{slug}`                                |
| `GET /api/polls/{slug}/session`                 | Session cookies                                          | `{ authenticated: false }` or `{ authenticated: true, personId, assurance, expiresAt }`  |
| `POST /api/auth/logout`                         | Session/challenge cookies                                | Revokes presented and browser-challenge sessions, cancels pending logins; clears cookies |

The unverified `/auth/honor` endpoint also accepts `{ identifier: { kind: "discord_username", value }, turnstileToken }`. Usernames must be nonempty and at most 32 characters after trimming. They match the Discord identifier's `display_label`, ignoring case and surrounding whitespace. A single matching person must be actively eligible; ambiguous and missing names return the same `403 ineligible` response. The lookup and eligibility check occur in the session INSERT. The session records the numeric Discord identity, preserving one ballot across linked email and Discord entry. This request-only kind is not a new database identifier kind and is not accepted by organizer linking or allowlist endpoints. Import account usernames alongside Discord IDs later; do not put display/server nicknames in this field for voter lookup.

Successful honor and code-verification responses contain `{ authenticated: true, assurance }`. Email identifiers are trimmed and lowercased without rewriting dots or plus suffixes. Discord identifiers are numeric strings of 17–20 digits, never display names. Linking never merges people or marks an identifier verified, and authentication never creates membership, consent, eligibility, or organizer access.

Poll management, ballots, results, Markdown authoring, and the organizer CLI are documented in [poll guide](./polls/POLLS.md). The Svelte voter UI now supports unverified guest-list entry. Verified email/Discord endpoints remain available through the API; their UI is deferred.

## Verification and sessions

Email codes are six digits, last ten minutes, and allow five attempts. Resends require at least one minute, with at most five challenges per identifier per hour across all polls and browsers. The generic `202` response also covers unknown/ineligible addresses, throttled resends, and delivery failures; it acknowledges a request, not successful delivery. Delivery runs through the Worker execution context (`waitUntil`) after challenge creation, so provider latency does not delay the acknowledgement. Delivery failures or a ten-second timeout invalidate only an unconsumed challenge and emit a diagnostic without the address or code. A later provider failure cannot overwrite completed-login or logout markers. No automatic retries are performed; a code delivered after the timeout may no longer work. Eligibility lookup and challenge creation still take different database paths, so responses are not guaranteed to have identical timing.

Codes are stored as challenge-specific HMACs using `AUTH_SECRET`. Successful consumption, identifier verification, and session creation are one atomic D1 batch. Concurrent code submissions can succeed only once. Code verification updates only the proven email's `verified_at`. Newsletter confirmation is separate and does not authenticate voters.

Discord uses the authorization-code flow with the `identify` scope. State is browser-bound, single-use, and expires after ten minutes. The returned stable ID must already be linked to an eligible person; provider emails and names never establish links. Provider tokens are discarded after lookup. After the exchange, one atomic D1 batch rechecks the challenge, browser binding, expiration, identifier ownership, and current eligibility before associating the challenge with a session and marking the identifier verified. A failed/cancelled exchange requires a new start request.

Verified sessions have a fixed 24-hour lifetime, reusable across eligible polls. Honor sessions also last 24 hours but belong to one poll. A browser has one current honor session and one verified session; a new honor login replaces the previous honor session without replacing verified proof. A matching honor session takes precedence on its honor poll. Verified polls reject honor sessions. Expiry, current identifier ownership/value, publication, and allowlist revocation are checked on each session lookup. Protected poll handlers reuse these checks before accessing ballots or results and recheck them inside ballot transactions.

Session tokens are random and stored hashed in D1. Production cookies use `__Host-` names, `Secure`, `HttpOnly`, and `SameSite=Lax`. Explicit HTTP localhost configuration uses separate `dev-` cookie names without `Secure`. Historical `verified_at` alone never authenticates a new session. Logout atomically revokes presented sessions and sessions associated with the browser challenge cookie, then cancels that browser's challenges, including exchanges in progress. If logout wins the transaction race, finalization cannot issue a session; if finalization wins, logout removes that session even when its cookie has not arrived yet. A late response can therefore set a cookie that no longer authenticates. Other browsers used by the same person remain signed in.

Authentication responses use `Cache-Control: no-store` and no cross-origin access headers. Invalid fields/JSON return `400`, bad tokens `401`, denied access `403`, missing resources `404`, identity collisions `409`, oversized bodies `413`, wrong content type `415`, and rate limits `429`. Errors contain `{ error, code, requestId }`. Unconfigured/disabled features return `503`; unexpected errors are redacted. Request bodies are bounded to 16 KiB while reading, even without `Content-Length`.

Anonymous login initiation requires Turnstile with action `poll-auth` and the configured site hostname. The `AUTH_RATE_LIMITER` binding allows 1,000 authentication requests per IP per minute per Cloudflare location. The additional `AUTH_INITIATION_RATE_LIMITER` binding (namespace `1002`) allows 250 initiations per IP per minute, shared across polls and honor/email/Discord initiation routes. This leaves room for roughly 200 members starting login on a shared event network. It is checked before provider calls or writes; denial returns `429` with `Retry-After: 60`, and a missing binding returns `503`. The additional limit does not apply to verification, callbacks, session reads, logout, or organizer endpoints. Edge counters are approximate and location-local, not a global storage quota. D1 separately enforces email attempt and resend limits atomically.

Hourly cleanup drains records that expired more than 24 hours ago, oldest first, in batches of up to 1,000 rows per table. Each run stops when drained, after 20 batches (at most 20,000 rows per table), or before starting another batch once ten seconds have elapsed. A capped run logs `auth_cleanup_capped` with deletion counts; the next hourly run continues. The cap indicates a budget was reached, not a measured backlog size. Expiration is still enforced when authenticating, independently of cleanup. Keeping challenges for 24 hours after expiration preserves their session associations for the full possible session lifetime. Removal reuses SQLite pages; allocated database size need not immediately shrink. Sustained distributed abuse can still exceed cleanup capacity; the limits do not guarantee a database size ceiling.

## Configuration and deployment

1. Apply migration 0003 with `pnpm cf:migrate`, then run `pnpm db:verify --remote` and `pnpm db:size --remote`. Routine migration never reruns the legacy backfill. Existing forms can remain open for this migration.
2. Deploy the Worker and both rate-limit bindings from `worker/wrangler.toml` together, with `AUTH_READY` absent or false. New routes return `503`; existing form readiness remains controlled by `CHAPTER_SCHEMA_READY`.
3. Configure `ORGANIZER_API_TOKENS` and an independently generated `AUTH_SECRET` using Worker secrets. Configure `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. Register the exact Discord callback `https://ainooga.org/api/auth/discord/callback`. These values stay out of the SPA.
4. Retain the existing Cloudflare `EMAIL` binding and verified sender domain for `noreply@ainooga.org`. The account is already on Workers Paid. Verify the production Turnstile hostname; the poll widget uses action `poll-auth`.
5. Set the `AUTH_READY` Worker secret to `true`, retain `CHAPTER_SCHEMA_READY=true`, and run `pnpm api:whoami`. Removing/replacing organizer entries takes effect with the updated secret deployment. Set `AUTH_READY=false` to disable new authentication without disabling forms.

The review fixes use the existing migration 0003 schema. They require no additional migration, secret rotation, or organizer setup; an existing deployment needs the updated Worker and its additional rate-limit binding.

Only deployment maintainers need Cloudflare access for these setup steps. Ordinary organizer commands use the application token exclusively. An automatic Worker deployment before migration is safe while `AUTH_READY` remains absent/false. Worker invocation logging is disabled to keep OAuth codes and confirmation tokens out of URL logs; application diagnostics omit secrets and personal data. Cloudflare Email Sending has its own dashboard logs/preview settings, separate from Worker logs.

For local development, copy `worker/.dev.vars.example` to the ignored `worker/.dev.vars`, run `pnpm cf:migrate:local`, and supply local configuration before setting both readiness flags true. Use `SITE_URL=http://localhost:5173` through the existing Vite proxy; register that site's callback separately for manual Discord testing. `AINOOGA_API_URL=http://localhost:8787` is suitable for the local organizer command. Automated tests use isolated D1 databases and fake email, Discord, Turnstile, clock, and rate-limiter services; they send no real email.

Run `pnpm check` and `pnpm test:coverage`. A Worker `wrangler deploy --dry-run` validates bundling/bindings without deploying. Live email delivery and Discord browser consent remain checks for a future verified-entry UI. The current unverified guest-list UI needs a real Turnstile smoke check; it does not require those providers. This PR does not import real members, create production polls, or implement the later comprehensive security review.

## Poll API

For authoring examples, CLI commands, guest-list behavior, and deployment, see the [poll guide](./polls/POLLS.md). The endpoint contracts below are for API clients.

### Organizer endpoints

All paths below start with `/api/admin/polls`. Send `Authorization: Bearer <organizer token>`. No Cloudflare credentials are needed for these requests. Browser requests with an Origin must match `SITE_URL`; command-line requests may omit it.

| Method | Path suffix         | Input / response                                                                                                           |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | (none)              | List slugs, titles, statuses, and start/end times.                                                                         |
| POST   | (none)              | Full poll definition; creates a draft, returns 201 with saved detail.                                                      |
| GET    | `/{slug}`           | Saved definition, status, option records with IDs, and eligibility preview.                                                |
| PUT    | `/{slug}`           | Full definition; replaces draft configuration/options/tags. Published polls permit only title/description changes.         |
| POST   | `/{slug}/publish`   | `{}`. Snapshot tag eligibility and publish; repeat calls do not refresh the snapshot.                                      |
| POST   | `/{slug}/archive`   | `{}`. Terminal archive, repeatable.                                                                                        |
| GET    | `/{slug}/allowlist` | People IDs/names, added and revoked timestamps.                                                                            |
| POST   | `/{slug}/allowlist` | `{ action: "add" or "revoke", identifiers: [{ kind: "email" or "discord", value }] }`, at most 50 entries.                 |
| GET    | `/{slug}/results`   | Aggregate counts over active eligibility only.                                                                             |
| GET    | `/{slug}/ballots`   | Current identifiable ballots, identifiers, choices, revision, timestamps, and revocation status. Includes revoked ballots. |

The definition fields match [topic-vote.md](./polls/topic-vote.md), plus a `description` string containing the Markdown body. All fields are required, including explicit `null` values and `eligibleTags: []` when no tags are configured. The API and CLI share strict validation. Drafts allow up to 100 predefined options, 50 tags, a 200-character title, and an 8,000-character description; the entire JSON payload must fit 16 KiB. Dates must be UTC timestamps ending in `Z` and are stored in canonical millisecond precision.

The eligibility preview reports `eligibleCount`, `missingTags`, and `snapshot`. Drafts combine current tag matches and explicit active entries, excluding explicitly revoked people. Published/archived polls report the stored snapshot, so subsequent tag changes do not change their eligibility. Missing tags are informational after publication. Publication rejects missing configured tags, no active eligible people, an expired schedule, or too few initial choices to meet the minimum (counting at most one new write-in).

Publication freezes identity mode, selection limits, predefined options, write-in rules, result visibility, start/end/edit dates, and tags. Title and Markdown description can still change. Explicit eligibility remains editable until archive. Adding restores a revoked person. Unknown add identifiers create minimal unverified people; revoking an unknown identifier fails. The whole API batch is atomic. The CLI validates a whole file before sending repeatable batches of 50 and reports confirmed progress if interrupted. Different identifiers are only deduplicated when already linked to the same person; this workflow never guesses or merges identities.

### Voter endpoints

There is no public poll listing. Anonymous callers can retrieve login requirements only. Drafts and archives return 404. Existing authentication endpoints and session cookies are unchanged.

| Method | Path                        | Response / input                                                                                                                                                                                                                                           |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/polls/{slug}/access`  | Only `{ identityMode, methods }`. Honor mode offers `honor`; verified mode offers `email`, plus `discord` when configured.                                                                                                                                 |
| GET    | `/api/polls/{slug}`         | Eligible session required. Poll text/configuration, options with IDs/labels/origin/position, own ballot, `sessionContext`, and `voter: { kind, value }` for the current session. No eligibility tags, roster, write-in authors, or other people's ballots. |
| GET    | `/api/polls/{slug}/ballot`  | Own current ballot or `null`.                                                                                                                                                                                                                              |
| PUT    | `/api/polls/{slug}/ballot`  | Strict submission body below; returns the accepted current ballot.                                                                                                                                                                                         |
| GET    | `/api/polls/{slug}/results` | Eligible session required; aggregate counts subject to result visibility.                                                                                                                                                                                  |

```json
{
  "requestId": "06ec5d6c-e86e-4961-aa1c-0f9179d1a53c",
  "sessionContext": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "expectedRevision": 0,
  "optionIds": [12, 13],
  "writeIn": null
}
```

`sessionContext` is required and must be the 64-character lowercase hexadecimal marker returned with authenticated poll details. Replace the illustrative value above with that marker. It binds a draft to its session, person, and poll; it is not a credential. Missing or malformed markers return `400 invalid_body`. A mismatch returns `409 session_changed` before any receipt, ballot, or write-in changes. Existing session and eligibility checks still run inside the ballot transaction. The current-session `voter` contains only its email or Discord username (numeric ID when no username is stored), never other linked identifiers or the roster.

On `session_changed`, preserve the draft and fetch current poll details. The voter UI asks whether to submit as the displayed identity. Yes creates a new request ID with that identity's marker and current ballot revision. No offers email entry in the same dialog using the existing guest-list and Turnstile checks. A further identity change requires another confirmation. Cancelling keeps the draft; nothing is submitted automatically. These checks occur only on submission, without background session polling.

Use a fresh UUID for each logical submission. First submission requires revision 0; an edit requires the revision returned by the last ballot read. `optionIds` accepts IDs from this poll within the 16 KiB JSON body limit. There is no separate 100-ID ceiling: with `maxSelections: null`, a voter can select every available option. IDs are deduplicated before database processing. `writeIn` is required and is either `null` or one trimmed, nonempty label of at most 200 characters. Repeated IDs and equivalent write-ins count once toward selection limits. Write-in matching trims/collapses whitespace and lowercases; a duplicate selects the existing option. New write-ins are created only with an accepted ballot and become immediately visible to eligible voters. Each person can create one new write-in per poll, and a poll can contain at most 500 total options, including predefined options. Both creation limits are enforced atomically. Reusing any existing label, selecting existing options, and replaying an accepted request do not consume the allowance. Editing a ballot or revoking/restoring eligibility does not reset it. Attempts to exceed a creation limit return `409` with code `write_in_limit` and leave the ballot, receipt, and options unchanged. Older options already exceeding these limits remain available; the limits block further creation rather than deleting records. They remain available if their author's choices change. Display labels retain their submitted internal spacing. Render labels as text.

The response is `{ revision, submittedAt, updatedAt, optionIds }`; both predefined and write-in selections are option IDs. Keep the exact request ID, marker, and choices when retrying an uncertain response. A latest request retried with the same canonical ballot payload returns the same accepted ballot without writing again, including after voting or editing closes. A changed payload under the same UUID, stale revision, invalid selection set, or competing edit returns 409. Refetch the ballot and options before making a new submission. Do not silently turn a conflicting retry into a new vote. Only the latest receipt is retained; retrying a superseded submission conflicts. Invalid fields return 400; validation happens before database writes.

Voting is open at `startsAt` and closed at `endsAt`: `[startsAt, endsAt)`. D1 evaluates its own UTC clock when executing the ballot claim, rather than using the time the Worker received the request. A request queued across a deadline or session expiry cannot claim a ballot. Existing ballots can change only with `allowEdits: true` and before `editDeadline ?? endsAt`. Login is allowed outside that window so voters can see permitted results. `before_vote` allows aggregate results before submitting, `after_vote` requires an existing ballot, and `never` denies voter results even after closing. Results contain `eligibleCount`, `ballotCount`, and `options: [{ id, label, votes }]`; selection totals may exceed ballot count. Revoked voters cannot read or change the poll, and their ballots stop contributing to both participation and option totals. Restoration counts their retained ballots again.

The Worker derives person identity from the session, never from a submitted person ID. Ballot writes use one D1 batch: recheck session/identifier/eligibility/publication/window/rules/revision, claim the latest receipt with a fresh internal nonce, then condition all option/ballot/choice writes on that nonce. A losing request writes nothing; a later SQL failure rolls back the whole batch. D1 also generates ballot/write-in timestamps. A winning claim proves authorization at that point, so later session expiry during response processing does not turn an accepted ballot into an apparent failure. Retries still require a currently valid eligible session. Eligible session checks on protected poll reads use D1 time and share a transaction with the returned data. Own-ballot and detail reads do not compute aggregate totals; denied results requests also avoid aggregate queries. The database stores one current ballot and latest receipt per person/poll, not a selection or request history.

All routes inherit the existing rate limit, error redaction, `no-store`, origin checks, and 16 KiB JSON limit. JSON mutations reject unknown fields. Details/descriptions are returned as Markdown source, never rendered HTML; the voter page sanitizes rendered descriptions and displays write-in labels as text.

### Poll setup and deployment

For local setup, follow [authentication configuration](#configuration-and-deployment), apply `pnpm cf:migrate:local`, and run `pnpm db:verify`. Set `CHAPTER_SCHEMA_READY`, `AUTH_READY`, and `POLLS_READY` to `true` in ignored `worker/.dev.vars` after migration. Configure the existing Turnstile keys for action `poll-auth`, then run `pnpm dev:all` and create a poll with current dates.

Production needs migration `0004_poll_api.sql` before enabling `POLLS_READY`. Apply pending migrations with `pnpm cf:migrate`, verify with `pnpm db:verify --remote`, and inspect size with `pnpm db:size --remote`. Keep readiness flags as Worker secrets; `POLLS_READY=false` disables poll routes without disabling existing forms. The session-context and recovery fixes add no migration or secret. Deploy the compatible Worker before the SPA, then check entry, voting, retries, results, and logout on a controlled poll with real Turnstile. Older open pages must refresh to load the updated request contract; submissions without the marker are rejected. Archive the controlled test poll afterward. Email delivery and Discord OAuth are not required for unverified entry.

Run `pnpm check`, `pnpm build:spa`, and `pnpm test:e2e:polls`. The browser suite uses disposable local D1 and fake external services, with no production changes. Install Chromium once with `pnpm exec playwright install chromium`.

## Security review and member-import gate

The October 2026 review retains one organizer access level through configured API tokens. Passing the application token check authorizes Worker D1 operations; organizers do not need Cloudflare credentials. Honor-mode identity remains deliberately unverified. The review adds form-provider hardening and authorization/error regressions without changing poll request contracts, adding secrets, or migrating the schema.

The importer may be developed once the scoped application review has no unresolved unauthorized-access, unauthorized-modification, private-data disclosure, or identity/consent corruption finding. Repeat those checks against the new importer before uploading real members. The reviewed branch meets that application gate after its fixes; deployment and real upload remain separate steps. The production Turnstile voting check is still pending. Global coverage now passes the unchanged thresholds at 80.54% lines/statements. Existing dependency advisories in development/build tooling remain open; passing coverage does not constitute a clean dependency audit or full production acceptance.

No production changes were made during this review. Deploy the updated Worker after merge; no schema or secret change is required. Existing form widgets already send the retained action, so no coordinated SPA change is required. Verify the new form/confirmation headers and complete controlled delivery/Turnstile checks separately. See [database capacity and recovery diagnostics](./DATABASE.md#capacity-review-2026-10-04).
