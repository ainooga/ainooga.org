# Polls

Organizers manage polls with Markdown/YAML files and `pnpm poll`. Voters follow a shared link and enter their email, with a Discord username fallback. No match leads to `contact@ainooga.org` for help. `identityMode: honor` means unverified entry: knowing an eligible identifier is enough to enter as that person.

## Create and publish

Copy the [example poll](./topic-vote.md) into ignored `.local/polls/` or `ai/polls/`, then edit the title, choices, **UTC dates**, and voters. These files are CLI inputs, not static site content, and do not need to be committed.

```sh
mkdir -p .local/polls
cp docs/polls/topic-vote.md .local/polls/
```

Put `AINOOGA_API_TOKEN` and `AINOOGA_API_URL` in ignored `.env`: use `http://localhost:8787` locally or `https://ainooga.org` for production. See [organizer setup](../API.md#organizer-setup) for tokens. To use another env file, add `--env-file .env.prod.local` after `pnpm poll`; existing shell variables take precedence.

After editing your copies:

```sh
pnpm poll validate .local/polls/topic-vote.md
pnpm poll create .local/polls/topic-vote.md
pnpm poll show topic-vote
pnpm poll publish topic-vote
pnpm poll invite topic-vote
```

`validate` works offline. `create` saves a draft; check its settings and eligible-person count with `show` before publishing. Drafts are not visible on the voter page. Once published, the link is `https://ainooga.org/#/polls/topic-vote` or, locally, `http://localhost:5173/#/polls/topic-vote`. There is no public poll directory.

For production, use `pnpm poll --env-file .env.prod.local <command> ...` with `AINOOGA_API_URL=https://ainooga.org`. Existing shell variables override the env file. Deployment of the invitation endpoint must finish before using `invite`; it requires no migration or new secrets.

## Send invitations

`pnpm poll invite <slug>` emails everyone currently eligible through any configured tag or explicit allowance. It collects all email identifiers for those people, normalizes/deduplicates addresses, and sends a separate message to each address. Other recipients are never included in the message. People with no email identifier cannot receive an email. Newsletter and event subscription settings are separate from this explicit poll invitation command.

The poll must be published and not yet closed. Creating or publishing does not send email. Invitations contain the poll link and voting instructions, not an authentication token or verification code.

The command prints `{ recipients, accepted, failed }` and exits nonzero if any send fails. `accepted` means the provider accepted the message, not confirmed inbox delivery. `failed` includes timed-out sends whose delivery is uncertain. Check Cloudflare Email Sending activity if the command fails or loses its response. There are no automatic retries; running `invite` again sends the entire current audience another invitation.

## Settings

Choices accept either a label string or `{ label, description }`. Descriptions are optional plain text, up to 1,000 characters. Both labels and descriptions are frozen after publication.

Keep every field in the example, including `null` values and `eligibleTags: []`. Put the description in the Markdown body, not frontmatter. Quote UTC dates ending in `Z`.

`eligibleEmails` is optional. When provided, it replaces the explicit person allowlist using those emails; `[]` clears it. When omitted on an update, the existing explicit allowlist is preserved. Tag eligibility still applies. Unknown addresses create minimal unverified person records, without subscriptions or organizer access. This is saved in the same transaction as the poll. `show` lists all email identifiers of explicitly allowed people, including linked aliases.

| Setting                           | Meaning                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `identityMode`                    | Use `honor` for the current voter page; verified sign-in is not yet supported there.                                                       |
| `minSelections` / `maxSelections` | `1/1`: one choice; `N/N`: exactly N; `1/N`: up to N; `1/null`: any number, at least one.                                                   |
| `allowWriteIns`                   | One new option with the first vote: topic up to 200 characters and optional plain-text description up to 1,000 characters.                 |
| `resultsVisibility`               | `before_vote`, `after_vote`, or `never`, including after closing.                                                                          |
| `startsAt` / `endsAt`             | Voting opens at the start and stops at the end. Voters see local times.                                                                    |
| `allowEdits` / `editDeadline`     | With edits enabled, `null` means until closing. An explicit cutoff must be after the start and at or before the end. Otherwise use `null`. |
| `eligibleTags`                    | Current person tags, matched live with OR. `[]` means explicit guest-list entries only.                                                    |
| `eligibleEmails`                  | Optional email list granting explicit voting eligibility. Addresses are trimmed and lowercased.                                            |

## Guest lists and later changes

Eligibility is any current matching tag OR an explicit person allowance. Tag changes take effect immediately, including on published polls. Missing tags, no eligible voters, expired dates, or impossible selection limits prevent publication.

For separate guest-list management, the [guest list example](./eligible-voters.yml) accepts emails and **numeric Discord IDs**, not usernames. Already-linked identifiers share one person and ballot; the CLI does not create links. New identifiers create unverified records without a `member` tag, subscriptions, or organizer access. Discord username entry additionally needs the account username on its Discord record, to be populated by the later import. Until then, use email entry.

- `pnpm poll update <file>` replaces a draft. After publication, only title, description, and explicit eligibility can change. Providing `eligibleEmails` replaces all explicit person allowances, including ones previously added through Discord; omit it to preserve those allowances.
- `pnpm poll allowlist add|remove <slug> <file>` changes explicit allowances. Uploads are repeatable. Removal does not override a matching tag. To remove all access, remove the explicit allowance and every matching person tag. Accepted ballots remain in results; ineligible people cannot read or edit them.
- `pnpm poll results <slug>` shows totals; `pnpm poll ballots <slug>` exposes individual ballots to organizers. Keep that output private.
- `pnpm poll archive <slug>` permanently hides the poll. Run `pnpm poll --help` for all commands.

If another tab changes the voter identity, submitting opens a confirmation dialog. Yes submits the preserved choices as the displayed email or Discord account; No asks for an eligible email in the same dialog. Cancelling keeps the draft. Replacing an existing vote still follows the poll's edit rules. A pending write-in cannot replace an existing vote; cancel and reload that voter's ballot to edit its selections.

If a vote saves but its choices cannot reload, **Reload saved vote** retries loading them. Editing stays unavailable until that succeeds; the saved vote is not resubmitted.

Write-ins appear as **Topic** and **Description (optional)** fields on the first ballot only. A duplicate topic selects the existing option and keeps its original description. After voting, these fields are hidden; voters can select or deselect existing options, including write-ins, but cannot add or change a topic or description.

The voter page supports edits when permitted. **Refresh poll** clears unsaved selections. **Retry same vote** safely checks an uncertain submission; conflicts reload the saved ballot before another explicit submission.

## Development and deployment

Follow [poll setup and deployment](../API.md#poll-setup-and-deployment) for migrations, readiness flags, and local Turnstile configuration. Run `pnpm worker:dev` and `pnpm dev` in separate terminals locally. This version requires migration 0005; follow the [schema rollout](../DATABASE.md#schema-simplification-rollout). Refresh already-open poll pages and check a controlled poll with real Turnstile. Older pages cannot submit without the new session marker.

Write-in descriptions use the existing `poll_options.description` column, so this update needs no additional migration or secrets. Deploy the Worker before the SPA so the new description field is accepted. Older clients can still omit that field.

Validate changes with `pnpm check`, `pnpm build:spa`, and `pnpm test:e2e:polls`. The browser suite uses disposable local D1 and fake external services. Detailed request formats and limits live in the [API reference](../API.md#poll-api).
