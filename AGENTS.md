# ainooga.org

Static SPA for a club. Content in markdown + frontmatter, compiled to JSON at build. Svelte 5 SPA served from static hosting. No runtime server, no database, no API.

## Code Map

- `content/`: source markdown — `posts/`, `events/`, `members/`, `site.yml`. Frontmatter validated by Zod.
- `scripts/`: build pipeline (TypeScript). `build.ts` orchestrates parse → images → render → emit → verify.
- `src/`: Svelte 5 SPA. `pages/` per route, `lib/` for services, fetchers, stores.
- `static/`: build output + hand-placed assets. `data/` gets generated JSON, `images/` gets processed images.
- `tests/`: `unit/` (pure logic), `components/` (Svelte), `e2e/` (Playwright). `fixtures/` for test content.
- `.githooks/`: `pre-commit` (lint-staged + image size check), `pre-push` (full check suite).
- `.github/workflows/deploy.yml`: CI/CD — check → build → deploy to GitHub Pages.

## Architecture Rules

### Content pipeline — build scripts

- Single entry: `npm run build:content` → `scripts/build.ts` orchestrates stages.
- Stages: parse (gray-matter + Zod validate) → process images (sharp) → render (markdown → HTML, resolve image paths) → emit (write JSON) → verify (sanity checks).
- All frontmatter validated against Zod schemas with `.strict()`. No `.default()`. No silent fallbacks. Build fails hard listing all errors.
- Image processing: `.jpg/.png/.tiff` → `.webp` + `.avif` at defined sizes. GIF passthrough.
- No partial output on failure. Build either succeeds fully or fails.

### SPA structure — Svelte 5

- Svelte 5 with `$state`, `$derived`, `$effect`. No legacy Svelte 4 patterns.
- Client-side routing via `svelte-spa-router`. Hash/pushstate, no SSR.
- Progressive loading: list pages fetch index JSON only, detail pages fetch per-doc JSON on navigation.
- Every route has loading skeleton, error state (with retry), and 404 handling.
- Design tokens in `src/app.css` CSS custom properties. Semantic class names only — no Tailwind, no utility classes.
- Browser APIs (clipboard, localStorage, fetch, etc.) use service interface pattern: interface → browser impl + fake impl → injected via Svelte context.

### Testing

- Vitest for unit + component tests. jsdom for DOM environment. Playwright for E2E.
- Service interface pattern: fakes for browser APIs, injected via Svelte context in test render.
- Coverage targets: lines >= 80%, branches >= 70%, functions >= 80%, statements >= 80%.

### Developer tooling

- Node >= 20, pnpm, TypeScript strict mode.
- ESLint flat config + `@typescript-eslint` + `eslint-plugin-svelte` + `eslint-plugin-sonarjs`.
- Prettier with `prettier-plugin-svelte`.
- Complexity gates: cyclomatic > 10 error, cognitive > 15 error, nesting > 5 error, function lines > 50 error, file lines > 300 error, maintainability index < 60 error.
- Git hooks via `simple-git-hooks` in `.githooks/`. Pre-commit: `lint-staged` + image size check (500 KB max). Pre-push: full `pnpm check`.
- Setup: `pnpm run setup` installs deps, inits git hooks, builds content once.

## Style

- Write boring, idiomatic TypeScript. Strict mode enforced.
- Keep scripts single-purpose per stage. Orchestrator (`build.ts`) calls stages, stages don't call each other.
- Zod schemas use `.strict()`, no `.default()`, `.optional()` for truly optional fields only.
- Prefer semantic CSS class names over utility. Design tokens via CSS custom properties.
- Service interfaces for anything touching browser APIs. Constructor-inject or context-inject fakes in tests.
- Error messages must be human-readable, point to the offending file + field. Use `zod-validation-error`.
- No skipped tests, no soft assertions. Build stops on any failure.
- Use table tests when cases are repetitive. Use fully functional fakes, not mocks.
- `pnpm check` before push: lint + type-check + test + complexity. No warnings tolerated.

## Key Patterns

- Content change flow: `edit markdown → commit → push → build → deploy`.
- Build pipeline stages are async and sequential. Each stage writes to disk; next stage reads from disk.
- All frontmatter validation errors are collected and reported together, not first-fail.
- Image refs in markdown bodies and frontmatter are rewritten to processed paths during render stage.
- Test files mirror source layout: `tests/unit/` for `scripts/*.ts`, `tests/components/` for `src/**/*.svelte`.
- 404 handling at three levels: SPA router catch-all, fetch error states in detail pages, `static/404.html` for hosting fallback.
- No utility-first CSS (Tailwind). No raw values in component styles — always reference CSS custom properties.
