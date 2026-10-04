# Polls

Organizers manage polls with Markdown/YAML files and `pnpm poll`. Voters follow a shared link and enter their email, with a Discord username fallback. No match leads to `contact@ainooga.org` for help. `identityMode: honor` means unverified entry: knowing an eligible identifier is enough to enter as that person.

## Create and publish

Copy the [example poll](./topic-vote.md) and [guest list](./eligible-voters.yml) into ignored `.local/polls/`, then edit the title, choices, **UTC dates**, and voters. These files are CLI inputs, not static site content.

```sh
mkdir -p .local/polls
cp docs/polls/topic-vote.md docs/polls/eligible-voters.yml .local/polls/
```

Put `AINOOGA_API_TOKEN` and `AINOOGA_API_URL` in ignored `.env`: use `http://localhost:8787` locally or `https://ainooga.org` for production. See [organizer setup](../API.md#organizer-setup) for tokens. To use another env file, add `--env-file .env.prod.local` after `pnpm poll`; existing shell variables take precedence.

After editing your copies:

```sh
pnpm poll validate .local/polls/topic-vote.md
pnpm poll create .local/polls/topic-vote.md
pnpm poll allowlist add topic-vote .local/polls/eligible-voters.yml
pnpm poll show topic-vote
pnpm poll publish topic-vote
```

`validate` works offline. `create` saves a draft; check its settings and eligible-person count with `show` before publishing. Then share `https://ainooga.org/#/polls/topic-vote` or, locally, `http://localhost:5173/#/polls/topic-vote`. There is no public poll directory.

## Settings

Keep every field in the example, including `null` values and `eligibleTags: []`. Put the description in the Markdown body, not frontmatter. Quote UTC dates ending in `Z`.

| Setting                           | Meaning                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `identityMode`                    | Use `honor` for the current voter page; verified sign-in is not yet supported there.                                                       |
| `minSelections` / `maxSelections` | `1/1`: one choice; `N/N`: exactly N; `1/N`: up to N; `1/null`: any number, at least one.                                                   |
| `allowWriteIns`                   | One new option per person, up to 200 characters. Accepted write-ins become choices for everyone.                                           |
| `resultsVisibility`               | `before_vote`, `after_vote`, or `never`, including after closing.                                                                          |
| `startsAt` / `endsAt`             | Voting opens at the start and stops at the end. Voters see local times.                                                                    |
| `allowEdits` / `editDeadline`     | With edits enabled, `null` means until closing. An explicit cutoff must be after the start and at or before the end. Otherwise use `null`. |
| `eligibleTags`                    | Existing person tags, matched with OR. `[]` means explicit guest-list entries only.                                                        |

## Guest lists and later changes

Publishing snapshots tag matches together with explicit entries. Later tag changes do not alter that list. Missing tags, no eligible voters, expired dates, or impossible selection limits prevent publication.

Guest-list files accept emails and **numeric Discord IDs**, not usernames. Already-linked identifiers share one person and ballot; the CLI does not create links. New identifiers create unverified records without membership, subscriptions, or organizer access. Discord username entry additionally needs the account username on its Discord record, to be populated by the later import. Until then, use email entry.

- `pnpm poll update <file>` replaces a draft. After publication, only title, description, and explicit eligibility can change.
- `pnpm poll allowlist add|revoke <slug> <file>` changes access for everyone in that file. Uploads are repeatable. Revocation overrides tag matches and excludes retained ballots from results; adding again restores them.
- `pnpm poll results <slug>` shows totals; `pnpm poll ballots <slug>` exposes individual ballots to organizers. Keep that output private.
- `pnpm poll archive <slug>` permanently hides the poll. Run `pnpm poll --help` for all commands.

If another tab changes the voter identity, submitting opens a confirmation dialog. Yes submits the preserved choices as the displayed email or Discord account; No asks for an eligible email in the same dialog. Cancelling keeps the draft. Replacing an existing vote still follows the poll's edit rules.

If a vote saves but its choices cannot reload, **Reload saved vote** retries loading them. Editing stays unavailable until that succeeds; the saved vote is not resubmitted.

The voter page supports edits when permitted. **Refresh poll** clears unsaved selections. **Retry same vote** safely checks an uncertain submission; conflicts reload the saved ballot before another explicit submission.

## Development and deployment

Follow [poll setup and deployment](../API.md#poll-setup-and-deployment) for migrations, readiness flags, and local Turnstile configuration. Use `pnpm dev:all` locally. The current UI adds no migration or secret; production still needs the existing poll schema and enabled API. Deploy the compatible Worker before the SPA, refresh any already-open poll pages, and check a controlled poll with real Turnstile. Older pages cannot submit without the new session marker.

Validate changes with `pnpm check`, `pnpm build:spa`, and `pnpm test:e2e:polls`. The browser suite uses disposable local D1 and fake external services. Detailed request formats and limits live in the [API reference](../API.md#poll-api).
