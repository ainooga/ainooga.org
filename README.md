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

| Script | What |
|--------|------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm build` | Build content + SPA for production |
| `pnpm build:content` | Build markdown content → JSON only |
| `pnpm check` | Full validation: lint + type-check + test + complexity |
| `pnpm test` | Run unit + component tests |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm lint` | ESLint check |
| `pnpm format` | Prettier check |
| `pnpm format:write` | Format all files |

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
