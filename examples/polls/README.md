# Author a poll

Copy `topic-vote.md` and `eligible-voters.yml` into ignored `.local/polls/`. Replace the example title, dates, choices, and voters. Keep real member information out of committed examples. These files are CLI inputs, not part of the static content build.

Set `AINOOGA_API_TOKEN` and `AINOOGA_API_URL` in your ignored `.env` (local API: `http://localhost:8787`). For production, pass `--env-file .env.prod.local` on each command. Existing shell environment variables take precedence over the env file.

```sh
pnpm poll validate .local/polls/topic-vote.md
pnpm poll create .local/polls/topic-vote.md
pnpm poll allowlist add topic-vote .local/polls/eligible-voters.yml
pnpm poll show topic-vote
pnpm poll publish topic-vote
pnpm poll results topic-vote
pnpm poll ballots topic-vote
```

`create` saves a draft. Edit the file and use `update <file>` to replace a draft's configuration. `show` reports the saved configuration, option IDs, missing tags, and the effective eligible-person count. `publish` is a separate explicit action. `list`, `allowlist list <slug>`, `allowlist revoke <slug> <file>`, and `archive <slug>` are also available; see `pnpm poll --help`.

Frontmatter must use YAML inside plain `---` lines, with every shown field present. The Markdown body is the description; do not add a `description` or `status` field. Quote timestamps and use UTC `Z`. Set `maxSelections: null` for no configured maximum. Set min/max to 1 for single choice, N/N for exactly N, or 1/N for up to N. API requests accept at most 100 selected option IDs and one write-in of at most 200 characters. Drafts support up to 100 predefined options and 50 existing tags. Total JSON request size must fit 16 KiB.

`eligibleTags` uses existing `person_tags`, with OR matching. Publishing takes one snapshot and combines it with explicit eligibility, deduplicating by person. It does not infer chapter membership or assign tags. Missing tags, no active voters, an expired schedule, or impossible selections block publication. An explicit revocation wins over tag matches. Adding again restores eligibility. Unknown identifiers in an add file create minimal unverified people; they do not grant membership, newsletter consent, or organizer access. Link identifiers using the existing organizer API when they belong to one person.

An eligibility file is a plain YAML list. The CLI validates the entire file before uploading batches of at most 50 entries. Uploads are repeatable; on failure it reports the confirmed progress. Both emails and linked Discord IDs can refer to the same voter. Revoking an unknown identifier is an error.

After publication, only title/description and explicit eligibility can change. Voting rules, dates, tags, and predefined options are frozen. Tag changes elsewhere do not refresh the snapshot. Revoked voters' ballots remain stored but stop counting; restoring eligibility counts them again. Archiving is terminal and hides the poll from voters. Organizer tokens can read identifiable ballots, so protect these files and command output.

This PR provides the API and organizer CLI. A voter webpage is a separate PR. See [poll API contracts and deployment](../../docs/POLLS.md) to test voting directly.
