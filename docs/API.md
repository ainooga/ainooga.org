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

Poll slugs use 1–160 ASCII letters, digits, underscores, or hyphens. Authentication requires a published poll and its active allowlist. The voting window is enforced by the future ballot endpoints, not by login. This allows login after voting closes to view permitted results later.

All POST bodies below are strict JSON objects. Unknown fields are rejected. Organizer requests use the bearer header; voter requests use cookies. Browser mutations must send the exact `SITE_URL` origin. Production authentication is same-origin at `https://ainooga.org`; preview sites cannot use production authentication. Local tools may omit `Origin` when using an organizer bearer token.

| Method and path                                 | Input                                                    | Result                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/admin/me`                             | Organizer token                                          | `{ name, personId }`                                                                    |
| `POST /api/admin/people/{personId}/identifiers` | Organizer token; `{ kind: "email" or "discord", value }` | `{ id, personId }`; idempotent for the same owner, `409` for another owner              |
| `POST /api/polls/{slug}/auth/honor`             | `{ identifier: { kind, value }, turnstileToken }`        | Poll-bound honor session cookie                                                         |
| `POST /api/polls/{slug}/auth/email/request`     | `{ email, turnstileToken }`                              | `202`, `{ challengeId, message }`, browser challenge cookie                             |
| `POST /api/polls/{slug}/auth/email/verify`      | `{ challengeId, code }` and challenge cookie             | Verified session cookie                                                                 |
| `POST /api/polls/{slug}/auth/discord/start`     | `{ turnstileToken }`                                     | `{ url }` and challenge cookie; navigate the browser to the URL                         |
| `GET /api/auth/discord/callback`                | Provider `state` and `code`, challenge cookie            | Verified session cookie and redirect to `/#/polls/{slug}`                               |
| `GET /api/polls/{slug}/session`                 | Session cookies                                          | `{ authenticated: false }` or `{ authenticated: true, personId, assurance, expiresAt }` |
| `POST /api/auth/logout`                         | Session/challenge cookies                                | Revokes those sessions and pending browser challenges; clears cookies                   |

Successful honor and code-verification responses contain `{ authenticated: true, assurance }`. Email identifiers are trimmed and lowercased without rewriting dots or plus suffixes. Discord identifiers are numeric strings of 17–20 digits, never display names. Linking never merges people or marks an identifier verified, and authentication never creates membership, consent, eligibility, or organizer access.

The poll UI and ballot/results endpoints arrive in later PRs. The Discord redirect path is reserved for that UI; this PR can be exercised through API tests with synthetic polls.

## Verification and sessions

Email codes are six digits, last ten minutes, and allow five attempts. Resends require at least one minute, with at most five challenges per identifier per hour across all polls and browsers. The generic `202` response also covers unknown/ineligible addresses, throttled resends, and delivery failures; it acknowledges a request, not successful delivery. Failed sends invalidate their challenge and emit a diagnostic without the address or code.

Codes are stored as challenge-specific HMACs using `AUTH_SECRET`. Successful consumption, identifier verification, and session creation are one atomic D1 batch. Concurrent code submissions can succeed only once. Code verification updates only the proven email's `verified_at`. Newsletter confirmation is separate and does not authenticate voters.

Discord uses the authorization-code flow with the `identify` scope. State is browser-bound, single-use, and expires after ten minutes. The returned stable ID must already be linked to an eligible person; provider emails and names never establish links. Provider tokens are discarded after lookup. A failed/cancelled exchange requires a new start request.

Verified sessions have a fixed 24-hour lifetime, reusable across eligible polls. Honor sessions also last 24 hours but belong to one poll. A browser has one current honor session and one verified session; a new honor login replaces the previous honor session without replacing verified proof. A matching honor session takes precedence on its honor poll. Verified polls reject honor sessions. Expiry, current identifier ownership/value, publication, and allowlist revocation are checked on each session lookup. Future protected poll handlers must reuse these checks before accessing ballots or results.

Session tokens are random and stored hashed in D1. Production cookies use `__Host-` names, `Secure`, `HttpOnly`, and `SameSite=Lax`. Explicit HTTP localhost configuration uses separate `dev-` cookie names without `Secure`. Historical `verified_at` alone never authenticates a new session. Logout revokes only the presented browser sessions, not every device used by that person.

Authentication responses use `Cache-Control: no-store` and no cross-origin access headers. Invalid fields/JSON return `400`, bad tokens `401`, denied access `403`, missing resources `404`, identity collisions `409`, oversized bodies `413`, wrong content type `415`, and rate limits `429`. Errors contain `{ error, code, requestId }`. Unconfigured/disabled features return `503`; unexpected errors are redacted. Request bodies are bounded to 16 KiB while reading, even without `Content-Length`.

Anonymous login initiation requires Turnstile with action `poll-auth` and the configured site hostname. The `AUTH_RATE_LIMITER` binding allows 1,000 authentication requests per IP per minute per Cloudflare location, leaving room for a shared chapter-event network. This edge throttle is approximate; D1 atomically enforces email attempt and resend limits. Hourly cleanup removes up to 1,000 sessions and 1,000 challenges that expired more than 24 hours ago. Removal reuses SQLite pages; allocated database size need not immediately shrink.

## Configuration and deployment

1. Apply migration 0003 with `pnpm cf:migrate`, then run `pnpm db:verify --remote` and `pnpm db:size --remote`. Routine migration never reruns the legacy backfill. Existing forms can remain open for this migration.
2. Deploy the Worker with `AUTH_READY` absent or false. New routes return `503`; existing form readiness remains controlled by `CHAPTER_SCHEMA_READY`.
3. Configure `ORGANIZER_API_TOKENS` and an independently generated `AUTH_SECRET` using Worker secrets. Configure `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. Register the exact Discord callback `https://ainooga.org/api/auth/discord/callback`. These values stay out of the SPA.
4. Retain the existing Cloudflare `EMAIL` binding and verified sender domain for `noreply@ainooga.org`. The account is already on Workers Paid. Verify the production Turnstile hostname; the later poll widget must use action `poll-auth`.
5. Set the `AUTH_READY` Worker secret to `true`, retain `CHAPTER_SCHEMA_READY=true`, and run `pnpm api:whoami`. Removing/replacing organizer entries takes effect with the updated secret deployment. Set `AUTH_READY=false` to disable new authentication without disabling forms.

Only deployment maintainers need Cloudflare access for these setup steps. Ordinary organizer commands use the application token exclusively. An automatic Worker deployment before migration is safe while `AUTH_READY` remains absent/false. Worker invocation logging is disabled to keep OAuth codes and confirmation tokens out of URL logs; application diagnostics omit secrets and personal data. Cloudflare Email Sending has its own dashboard logs/preview settings, separate from Worker logs.

For local development, copy `worker/.dev.vars.example` to the ignored `worker/.dev.vars`, run `pnpm cf:migrate:local`, and supply local configuration before setting both readiness flags true. Use `SITE_URL=http://localhost:5173` through the existing Vite proxy; register that site's callback separately for manual Discord testing. `AINOOGA_API_URL=http://localhost:8787` is suitable for the local organizer command. Automated tests use isolated D1 databases and fake email, Discord, Turnstile, clock, and rate-limiter services; they send no real email.

Run `pnpm check` and `pnpm test:coverage`. A Worker `wrangler deploy --dry-run` validates bundling/bindings without deploying. Live email delivery and Discord browser consent still need a controlled smoke check with organizer-owned identities and an allowlisted test poll before the voting UI is released. This PR does not import real members, create production polls, or implement the later comprehensive security review.
