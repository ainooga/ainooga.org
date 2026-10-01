# Poll API and organizer workflow

PR 4 implements the backend and local organizer CLI. The Svelte voter interface is PR 5. Use [the authoring examples](../examples/polls/README.md) for Markdown/YAML files and commands, and [API authentication](./API.md) for tokens, login, cookies, and provider setup. All organizer tokens have the same access, including identifiable ballots.

## Organizer endpoints

All paths below start with `/api/admin/polls`. Send `Authorization: Bearer <organizer token>`. No Cloudflare credentials are needed for these requests. Browser requests with an Origin must match `SITE_URL`; command-line requests may omit it.

| Method | Path suffix         | Input / response                                                                                                           |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | (none)              | List slugs, titles, statuses, and start/end times.                                                                         |
| POST   | (none)              | Full poll definition; creates a draft, returns 201 with saved detail.                                                      |
| GET    | `/{slug}`           | Saved definition, status, option records with IDs, and eligibility preview.                                                |
| PUT    | `/{slug}`           | Full definition; replaces draft configuration/options/tags. Published polls permit only title/description changes.         |
| POST   | `/{slug}/publish`   | Empty body or `{}`. Snapshot tag eligibility and publish; repeat calls do not refresh the snapshot.                        |
| POST   | `/{slug}/archive`   | Empty body or `{}`. Terminal archive, repeatable.                                                                          |
| GET    | `/{slug}/allowlist` | People IDs/names, added and revoked timestamps.                                                                            |
| POST   | `/{slug}/allowlist` | `{ action: "add" or "revoke", identifiers: [{ kind: "email" or "discord", value }] }`, at most 50 entries.                 |
| GET    | `/{slug}/results`   | Aggregate counts over active eligibility only.                                                                             |
| GET    | `/{slug}/ballots`   | Current identifiable ballots, identifiers, choices, revision, timestamps, and revocation status. Includes revoked ballots. |

The definition fields match [topic-vote.md](../examples/polls/topic-vote.md), plus a `description` string containing the Markdown body. All fields are required, including explicit `null` values and `eligibleTags: []` when no tags are configured. The API and CLI share strict validation. Drafts allow up to 100 predefined options, 50 tags, a 200-character title, and an 8,000-character description; the entire JSON payload must fit 16 KiB. Dates must be UTC timestamps ending in `Z` and are stored in canonical millisecond precision.

The eligibility preview reports `eligibleCount`, `missingTags`, and `snapshot`. Drafts combine current tag matches and explicit active entries, excluding explicitly revoked people. Published/archived polls report the stored snapshot, so subsequent tag changes do not change their eligibility. Missing tags are informational after publication. Publication rejects missing configured tags, no active eligible people, an expired schedule, or too few initial choices to meet the minimum (counting at most one new write-in).

Publication freezes identity mode, selection limits, predefined options, write-in rules, result visibility, start/end/edit dates, and tags. Title and Markdown description can still change. Explicit eligibility remains editable until archive. Adding restores a revoked person. Unknown add identifiers create minimal unverified people; revoking an unknown identifier fails. The whole API batch is atomic. The CLI validates a whole file before sending repeatable batches of 50 and reports confirmed progress if interrupted. Different identifiers are only deduplicated when already linked to the same person; this workflow never guesses or merges identities.

## Voter endpoints

There is no public poll listing. Anonymous callers can retrieve login requirements only. Drafts and archives return 404. Existing authentication endpoints and session cookies are unchanged.

| Method | Path                        | Response / input                                                                                                                                                                       |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/polls/{slug}/access`  | Only `{ identityMode, methods }`. Honor mode offers `honor`; verified mode offers `email`, plus `discord` when configured.                                                             |
| GET    | `/api/polls/{slug}`         | Eligible session required. Poll text/configuration, options with IDs/labels/origin/position, and own ballot. No eligibility tags, roster, write-in authors, or other people's ballots. |
| GET    | `/api/polls/{slug}/ballot`  | Own current ballot or `null`.                                                                                                                                                          |
| PUT    | `/api/polls/{slug}/ballot`  | Strict submission body below; returns the accepted current ballot.                                                                                                                     |
| GET    | `/api/polls/{slug}/results` | Eligible session required; aggregate counts subject to result visibility.                                                                                                              |

```json
{
  "requestId": "06ec5d6c-e86e-4961-aa1c-0f9179d1a53c",
  "expectedRevision": 0,
  "optionIds": [12, 13],
  "writeIn": null
}
```

Use a fresh UUID for each logical submission. First submission requires revision 0; an edit requires the revision returned by the last ballot read. `optionIds` accepts at most 100 IDs from this poll. `writeIn` is required and is either `null` or one trimmed, nonempty label of at most 200 characters. Repeated IDs and equivalent write-ins count once toward selection limits. Write-in matching trims/collapses whitespace and lowercases; a duplicate selects the existing option. New write-ins are created only with an accepted ballot and become immediately visible to eligible voters. They remain available if their author's choices change. Display labels retain their submitted internal spacing. Render labels as text.

The response is `{ revision, submittedAt, updatedAt, optionIds }`; both predefined and write-in selections are option IDs. A latest request retried with the same canonical payload returns the same accepted ballot without writing again, including after voting or editing closes. A changed payload under the same UUID, stale revision, invalid selection set, or competing edit returns 409. Refetch the ballot and options before making a new submission. Do not silently turn a conflicting retry into a new vote. Only the latest receipt is retained; retrying a superseded submission conflicts. Invalid fields return 400; validation happens before database writes.

Voting is open at `startsAt` and closed at `endsAt`: `[startsAt, endsAt)`. Existing ballots can change only with `allowEdits: true` and before `editDeadline ?? endsAt`. Login is allowed outside that window so voters can see permitted results. `before_vote` allows aggregate results before submitting, `after_vote` requires an existing ballot, and `never` denies voter results even after closing. Results contain `eligibleCount`, `ballotCount`, and `options: [{ id, label, votes }]`; selection totals may exceed ballot count. Revoked voters cannot read or change the poll, and their ballots stop contributing to both participation and option totals. Restoration counts their retained ballots again.

The Worker derives person identity from the session, never from a submitted person ID. Ballot writes use one D1 batch: recheck session/identifier/eligibility/publication/window/rules/revision, claim the latest receipt with a fresh internal nonce, then condition all option/ballot/choice writes on that nonce. A losing request writes nothing; a later SQL failure rolls back the whole batch. Eligible session checks and read responses also share a transaction. The database stores one current ballot and latest receipt per person/poll, not a selection or request history.

All routes inherit the existing rate limit, error redaction, `no-store`, origin checks, and 16 KiB JSON limit. JSON mutations reject unknown fields. Details/descriptions are returned as Markdown source, never rendered HTML; the later UI must safely render descriptions and must not insert write-in labels as HTML.

## Local setup and testing

```sh
pnpm cf:migrate:local
pnpm db:verify
pnpm db:size
```

After migration, set `POLLS_READY=true` in ignored `worker/.dev.vars`, alongside the existing auth configuration and readiness flags. Restart `pnpm worker:dev`. The organizer CLI uses `.env` by default; use `AINOOGA_API_URL=http://localhost:8787`. The examples' dates must include your test time. New polls begin as drafts, so upload eligibility before publishing.

For direct voter testing, first call the existing honor or verified login endpoint with a real local Turnstile token and `Origin: http://localhost:5173`, preserving its cookies. Then send a GET for details and PUT for the ballot using those cookies; PUT requires the same Origin. Organizer bearer tokens do not authenticate voter routes. Automated tests use functional provider fakes and disposable D1, so they do not require Cloudflare credentials, send email, or change your persistent local database.

Run `pnpm check`. Targeted coverage lives in `tests/integration/polls-*.test.ts` and `tests/unit/poll-files.test.ts`; it includes real CLI subprocesses through HTTP and D1, migrations, privacy, lifecycle, tag snapshots, date/selection/visibility rules, revocation, concurrent writes, retries, and transaction rollback. Run the Worker bundler without deployment with `pnpm exec wrangler deploy --dry-run --config worker/wrangler.toml`.

## Production rollout

Existing forms and authentication can stay enabled. The new routes return 503 unless `POLLS_READY=true`; it must be absent/false until migration 0004 is applied. Keep this operator setting as a Worker secret so an ordinary code deployment does not replace its value.

1. Apply `0004_poll_api.sql` using `pnpm cf:migrate`, then run `pnpm db:verify --remote` and `pnpm db:size --remote`. Routine migration applies any pending migrations and never reruns the old backfill.
2. Deploy this Worker version (automatic deployment after merge or `pnpm worker:deploy`). An automatic deployment before step 1 remains safe while `POLLS_READY` is absent/false.
3. Run `pnpm exec wrangler secret put POLLS_READY --config worker/wrangler.toml` and enter `true`. Keep `AUTH_READY` and `CHAPTER_SCHEMA_READY` enabled, with the existing organizer tokens, auth secret, provider settings, and rate-limit bindings.
4. Use `pnpm poll --env-file .env.prod.local list` to verify organizer access. Create a controlled poll with organizer-owned identities and current dates; test login, vote/retry, and results, then archive it. Confirm unauthenticated details remain private and existing forms/auth still respond correctly. This smoke check is an explicit production operation, not part of the test suite.

To disable the new routes, set `POLLS_READY=false`. An older Worker can ignore these additive tables; do not drop tables or restore an old database just to roll back application code, since that would risk discarding accepted records. Merging this PR does not import members or release a voter UI. Real email delivery, Turnstile `poll-auth`, and Discord configuration/consent still require the PR 3 provider checks before the voter UI release.
