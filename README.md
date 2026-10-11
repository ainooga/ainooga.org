# AI Nooga

Chattanooga's AI club — education, policy, research, networking.

Static SPA. Content in markdown, compiled to JSON at build. Svelte 5, served from Cloudflare Pages or GitHub Pages.

## Prerequisites

- Node.js >= 20
- pnpm >= 9

## Quick start

```bash
pnpm run setup
pnpm dev
```

## Scripts

| Script               | What                                                   |
| -------------------- | ------------------------------------------------------ |
| `pnpm dev`           | Build content, then start dev server with hot reload   |
| `pnpm build`         | Build content + SPA for production                     |
| `pnpm build:content` | Build markdown content → JSON only                     |
| `pnpm check`         | Full validation: lint + type-check + test + complexity |
| `pnpm test`          | Run unit + component tests                             |
| `pnpm test:e2e`      | Run Playwright E2E tests                               |
| `pnpm lint`          | ESLint check                                           |
| `pnpm format`        | Prettier check                                         |
| `pnpm format:write`  | Format all files                                       |

## Content

Add markdown files to:

- `content/posts/` — blog posts
- `content/events/` — events
- `content/members/` — member profiles
- `content/sponsors/` — sponsor profiles

Frontmatter validated strictly at build. See [REQUIREMENTS.md](./REQUIREMENTS.md) for the content model.

### Example: add an event

```bash
touch content/events/2026-07-15-ai-policy-salon.md
# Edit with title, date, location, excerpt in frontmatter
pnpm build:content  # validates and generates JSON
pnpm dev            # see it live
```

Published events sync to D1 after checks pass on `master`. PRs validate and preview
the event records without accessing production. Add `timezone`, optional `capacity`,
and `links: [{ platform: luma, externalId: evt-..., url: https://luma.com/... }]`
to frontmatter. Keep published filenames stable; a platform ID also allows matching
an existing event after a rename. Omitted fields and links are preserved in D1;
drafts and removed files do not delete event history or registrations.

Use `pnpm events validate`, `pnpm events sync --local`, or
`pnpm events sync --remote --dry-run` to check changes. For automation, configure
GitHub Actions secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with D1 write
permission for the account. The Check workflow can be rerun or manually triggered
on `master` to retry a failed sync. Website deployment runs separately.
Changed events use transactional D1 file imports, which briefly pause database
access. Unchanged events do not write.

## Project structure

```
ainooga.org/
├── content/          # Source markdown
├── scripts/          # Build pipeline (TypeScript)
│   ├── build.ts      # Orchestrator
│   ├── parse.ts      # gray-matter + Zod validate
│   ├── images.ts     # sharp processing
│   ├── render.ts     # markdown → HTML
│   ├── emit.ts       # write JSON
│   └── verify.ts     # sanity checks
├── src/              # Svelte 5 SPA
│   ├── pages/        # Route pages
│   ├── components/   # Reusable components
│   └── lib/          # Services, utilities
├── static/           # Build output + assets
├── tests/            # Unit, component, E2E
└── .githooks/        # Git hooks
```

## Design

Premium editorial aesthetic. Typography-first with Playfair Display (headings) and Inter (body). Warm off-white background, deep navy primary, copper accent. No utility CSS — semantic class names only.

## License

MIT

## Poll administration

Organizers author polls in Markdown/YAML and manage them with `pnpm poll`. See the [poll guide](docs/polls/POLLS.md) and its [complete example](docs/polls/topic-vote.md). Poll files are not part of the static content build.
