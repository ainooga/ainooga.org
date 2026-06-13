# Club Site — Requirements

## 1. Overview

Server-less SPA for a club. Content in markdown + frontmatter, compiled to JSON during build. Svelte 5 SPA served from static hosting (GitHub Pages, Cloudflare Pages, Netlify). No runtime server, no database, no API.

Content changes flow: `edit markdown → commit → push → build → deploy`.

---

## 2. Architecture

```
┌────────────────────────────────────────────────┐
│                   Repository                     │
│                                                   │
│  content/          scripts/          src/         │
│  ├──posts/*.md     ├──build.ts       ├──lib/      │
│  ├──events/*.md    ├──validate.ts    ├──routes/   │
│  ├──members/*.md   ├──images.ts      ├──app.html  │
│  └──site.yml       └──types.ts       └──main.ts   │
│                                                   │
│  ┌──────────────── build ───────────────────┐    │
│  │  gray-matter → validate → sharp → emit   │    │
│  │  → static/data/*.json                    │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  static/               dist/                      │
│  ├──data/*.json        ├──data/*.json              │
│  ├──images/*.{webp,    ├──images/*.{webp,          │
│  │  avif}              │   avif}                   │
│  └──favicon.ico        └── (SPA bundle)            │
└────────────────────────────────────────────────┘
```

### Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Svelte 5 (SPA via Vite) | Lowest JS overhead, fine-grained reactivity (`$state`, `$derived`) |
| Router | svelte-spa-router or page.js | Client-side hash/pushstate routing, no SSR needed |
| Content source | Markdown + frontmatter | Human-writable, git-friendly, universal parse |
| Content transport | Static JSON files | Pre-rendered at build, fetch-on-demand at runtime |
| Build | Custom TypeScript scripts | No framework lock-in, full control, no hidden magic |
| Image processing | sharp | Fast, proven, resizes + converts at build |
| Hosting | Static file server | Cloudflare Pages (preferred) or GitHub Pages |

---

## 3. Content Model

### 3.1 Site metadata — `content/site.yml`

```yaml
title: Ainooga Club
description: A community for makers and tinkerers
url: https://ainooga.org
theme:
  primary: "#3b82f6"
  secondary: "#1e293b"
nav:
  - label: Posts
    path: /posts
  - label: Events
    path: /events
  - label: Members
    path: /members
```

### 3.2 Post — `content/posts/YYYY-MM-DD-slug.md`

```yaml
---
title: Building a Community Workshop
date: 2024-06-13
author: slug-of-member
tags: [workshop, tools]
excerpt: We set up a shared workshop space...
banner: ./images/workshop-setup.jpg
status: published   # draft | published
---
Markdown body here. Supports **formatting**, images, links.

![alt](/images/workshop-setup.jpg)
```

### 3.3 Event — `content/events/YYYY-MM-DD-slug.md`

```yaml
---
title: Summer Hackathon
date: 2024-07-20T10:00:00Z
endDate: 2024-07-21T18:00:00Z
location: Community Hall, Main St
organizer: slug-of-member
tags: [hackathon]
excerpt: 24-hour build event for all skill levels
status: published
---
```

### 3.4 Member — `content/members/slug.md`

```yaml
---
name: Alice Chen
role: Organizer
joined: 2023-01-15
avatar: ./images/avatars/alice.jpg
tags: [electronics, woodworking]
links:
  github: alicec
  website: https://alice.dev
---
Bio in markdown — optional, shown on member detail page.
```

### 3.5 Frontmatter validation — strict schema, no silent errors

All frontmatter validated at build against Zod schemas. Build fails hard — no partial output, no fallback defaults, no silent swallows.

**Rules:**

- Every schema uses `.strict()` — unknown keys in frontmatter are rejected (e.g., `category: foo` where schema has no `category` field → build error with key name + file path)
- Required fields must be present. No `.default()` coercion on any field — if a required field is missing, build fails with a clear message: `content/posts/foo.md: missing required field "date"`
- `.optional()` is the only way a field can be absent. No implicit defaults, no silent `undefined` → `null` conversion
- Validation errors list **all** failures before aborting, not just the first one — so the user can fix multiple issues per run

```typescript
// scripts/types.ts
import { z } from 'zod';

// .strict() rejects unknown keys. No .default() — absence is error.
export const PostFrontmatter = z.object({
  title: z.string().min(1).max(200),
  date: z.string().pipe(z.coerce.date()),              // required
  author: z.string().min(1),                             // required
  tags: z.array(z.string()),                             // required — empty array OK if no tags
  excerpt: z.string().max(500).optional(),               // truly optional
  banner: z.string().optional(),
  status: z.enum(['draft', 'published']),                // required — no default
}).strict();

// ... EventFrontmatter, MemberFrontmatter, SiteConfig follow same pattern.
// Fields differ per content type (see 3.2-3.4). All use .strict(). None use .default().
```

**Error output format (build fails, list all errors):**

```text
content/posts/hello.md — 2 errors:
  [1] unknown key "category" (accepted keys: title, date, author, tags, excerpt, banner, status)
  [2] missing required field "date"

content/events/party.md — 1 error:
  [1] unknown key "location_url" (did you mean "location"?)

Build failed. 3 errors in 2 files.
```

Zod error formatting uses `zod-validation-error` for human-readable messages. The hint (`did you mean "location"?`) is approximated via Levenshtein distance against valid keys.

---

## 4. Build Pipeline

Single script entry point: `npm run build:content`.

### 4.1 Stages

| Stage | Script | Responsibility |
|-------|--------|----------------|
| 1. Parse | `scripts/parse.ts` | Glob markdown, parse frontmatter + body, validate schemas |
| 2. Process images | `scripts/images.ts` | sharp resize, convert to webp/avif, write to `static/images/` |
| 3. Render | `scripts/render.ts` | Convert markdown body → HTML, resolve image paths |
| 4. Emit | `scripts/emit.ts` | Write per-doc JSON + index JSON to `static/data/` |
| 5. Verify | `scripts/verify.ts` | Validate output JSON, check for broken image refs |

### 4.2 Output JSON structure

**Index file** — e.g. `static/data/posts/index.json`:

```json
{
  "updatedAt": "2024-06-13T12:00:00Z",
  "items": [
    {
      "slug": "building-community-workshop",
      "title": "Building a Community Workshop",
      "date": "2024-06-13T00:00:00.000Z",
      "excerpt": "We set up a shared workshop space...",
      "tags": ["workshop", "tools"],
      "author": { "slug": "alice", "name": "Alice Chen" },
      "banner": "/images/workshop-setup-800.webp",
      "path": "/data/posts/building-community-workshop.json"
    }
  ],
  "meta": {
    "total": 1,
    "tags": ["workshop", "tools", "electronics", "hackathon"],
    "authors": ["alice"]
  }
}
```

**Detail file** — e.g. `static/data/posts/building-community-workshop.json`:

```json
{
  "slug": "building-community-workshop",
  "title": "Building a Community Workshop",
  "date": "2024-06-13T00:00:00.000Z",
  "tags": ["workshop", "tools"],
  "bodyHtml": "<h2>Getting Started</h2>\n<p>We set up a shared workshop...</p>",
  "images": [
    { "src": "/images/workshop-setup-800.webp", "alt": "Workshop setup" }
  ],
  "author": {
    "slug": "alice",
    "name": "Alice Chen",
    "avatar": "/images/avatars/alice-200.webp"
  },
  "banner": "/images/workshop-setup-1600.webp"
}
```

### 4.3 Image processing rules

| Source format | Output formats | Sizes |
|---------------|----------------|-------|
| .jpg, .png, .tiff | .webp, .avif (keep original) | Banner: 800w, 1600w; Inline: 600w; Thumb: 200w |
| .gif | .gif (passthrough) | Same as original |

Output naming: `<name>-<width>w.<ext>` placed in `static/images/` mirroring source directory structure.

Image references in markdown bodies and frontmatter (banner, avatar) rewritten to processed paths by the render stage.

---

## 5. SPA Structure

### 5.1 Route design

| Route | Content | Loads |
|-------|---------|-------|
| `/` | Landing / recent posts | `data/posts/index.json` |
| `/posts` | Post list | `data/posts/index.json` |
| `/posts/:slug` | Post detail | `data/posts/:slug.json` |
| `/events` | Event list (past/future) | `data/events/index.json` |
| `/events/:slug` | Event detail | `data/events/:slug.json` |
| `/members` | Member directory | `data/members/index.json` |
| `/members/:slug` | Member detail | `data/members/:slug.json` |

### 5.2 Progressive loading contract

- List pages fetch only index JSON (lightweight, contains excerpts)
- Detail pages fetch individual doc JSON on navigation
- Prefetch detail JSON on hover / link intersection (optional enhancement)
- No page requires loading all documents at once

### 5.3 Component tree (outline)

```
App.svelte
├── SiteHeader.svelte          — nav from site.yml
├── Router.svelte
│   ├── HomePage.svelte        — hero + recent posts excerpt
│   ├── PostListPage.svelte    — paginated / filterable list
│   │   └── PostCard.svelte    — title, date, excerpt, tags
│   ├── PostDetailPage.svelte  — full post HTML + images
│   ├── EventListPage.svelte   — grouped past/future
│   │   └── EventCard.svelte
│   ├── EventDetailPage.svelte
│   ├── MemberListPage.svelte  — grid of avatars + names
│   │   └── MemberCard.svelte
│   └── MemberDetailPage.svelte
├── SiteFooter.svelte
└── OfflineBanner.svelte       — placeholder for future PWA
```

### 5.4 CSS management — semantic styles, design tokens

CSS uses **semantic class names** (what component IS) not utility classes (what it LOOKS like). No Tailwind, no utility-first system.

**Stack:**

| Layer | File pattern | Purpose |
|-------|-------------|---------|
| Design tokens | `src/app.css` | CSS custom properties on `:root` — colors, spacing scale, font sizes, breakpoints, shadows |
| Global reset | `src/app.css` | box-sizing, margin reset, base typography, focus outlines |
| Scoped component styles | `<style>` in each `.svelte` file | Semantic class names specific to that component |
| Shared patterns | `src/lib/*.css` | Reusable classes for layout (`.stack`, `.cluster`, `.grid`) via heuristic CSS — single-purpose classes that describe **arrangement**, not appearance |

**Token example — `src/app.css`:**

```css
:root {
  --color-primary: #3b82f6;
  --color-primary-light: #93c5fd;
  --color-bg: #ffffff;
  /* ... background, text, border colors follow same --color-* pattern */

  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  /* ... spacing scale (md, lg, xl), font families, font sizes, radii, shadows, breakpoints follow --<category>-<scale> pattern */
}
```

**Semantic class example (good):**

```svelte
<article class="post-card">
  <h2 class="post-card__title">{post.title}</h2>
  <p class="post-card__excerpt">{post.excerpt}</p>
</article>

<style>
  .post-card {
    padding: var(--space-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  /* ... .post-card__title, .post-card__excerpt follow same token-reference pattern */
</style>
```

**Anti-pattern (utility classes, not allowed):**

```svelte
<!-- NOT ALLOWED -->
<article class="px-4 py-2 border rounded-lg">
```

**Rationale:** Semantic classes keep templates readable, styles are co-located with components, and design tokens ensure consistency without raw values. Changing a token propagates globally without touching individual components. This approach is simpler than Tailwind, has zero build-time CSS overhead, and produces smaller bundles (no purging needed).

---

## 6. Developer Tooling

### 6.1 Language & build

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >= 20 | Runtime |
| TypeScript | ~5.8 | Language — strict mode, all source |
| Svelte 5 | ~5.56 | UI framework |
| Vite | ~8.0 | Bundler + dev server |
| @sveltejs/vite-plugin-svelte | ~7.1 | Svelte Vite integration |

### 6.2 Lint & format

| Tool | Purpose |
|------|---------|
| ESLint 9+ | Lint — flat config |
| @typescript-eslint/parser + plugin | TS-aware lint rules |
| eslint-plugin-svelte | Svelte component lint |
| eslint-plugin-sonarjs | Cognitive complexity, code smell detection |
| Prettier + eslint-config-prettier | Opinionated formatting, no style conflicts |

**ESLint rules enforced:**

| Rule source | Key rules |
|-------------|-----------|
| `@typescript-eslint` | `no-explicit-any` (error), `strict-boolean-expressions`, `no-floating-promises` |
| `eslint:recommended` | All |
| `plugin:svelte/recommended` | All |
| `plugin:sonarjs/recommended` | All — includes `cognitive-complexity` (max 15) |

**Prettier config:**

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 90,
  "plugins": ["prettier-plugin-svelte"]
}
```

### 6.3 Complexity analysis

Replaces what `radon` provides in Python. Three levels:

| Tool | Checks | Invocation |
|------|--------|------------|
| `eslint-plugin-sonarjs` | Cognitive complexity (max 15), function length, nested control flow depth | `eslint src/ scripts/` |
| `typhonjs-escomplex` | Cyclomatic complexity, Halstead metrics, maintainability index (per module) | `npx escomplex src/**/*.ts` |
| `eslint complexity` built-in rule | Cyclomatic complexity per function (max 10) | Part of ESLint run |

**Thresholds (build fails if exceeded):**

| Metric | Warning | Error |
|--------|---------|-------|
| Cyclomatic complexity (per function) | > 7 | > 10 |
| Cognitive complexity (per function) | > 10 | > 15 |
| Nesting depth | > 3 | > 5 |
| Function lines | > 30 | > 50 |
| File lines | > 200 | > 300 |
| Maintainability index | < 70 | < 60 |

### 6.4 Testing

| Tool | Purpose |
|------|---------|
| Vitest | Test runner — Vite-native, shares Vite config/plugins |
| @testing-library/svelte | Component unit tests (render, click, assert DOM) |
| jsdom | DOM environment for Vitest (simulates browser API) |
| @playwright/test | Browser-level E2E tests (real browser, full app) |

**Layer strategy:**

| Layer | Scope | Tool | Speed | Catch |
|-------|-------|------|-------|-------|
| Unit | Pure functions, build scripts, data transforms | Vitest | ms | Logic bugs |
| Component | Single Svelte component render + interaction | Vitest + testing-library | ms | Render bugs, missing states |
| E2E | Full app in real browser, navigation, data loading | Playwright | s | Integration, missing JSON, routing |

#### 6.4.1 Service interface pattern for browser APIs

Components that touch browser APIs (clipboard, localStorage, geolocation, share, etc.) must NOT call them directly. Instead:

1. Declare a TypeScript **interface** for the service
2. Implement a **browser** version (real API calls)
3. Implement a **fake** version for tests (in-memory, fully functional, inspectable)
4. Inject via Svelte context — tests swap fake, app uses browser

**Example — clipboard:**

```typescript
// src/lib/services/clipboard.ts
export interface ClipboardService {
  copy(text: string): Promise<void>;
}

// src/lib/services/clipboard-browser.ts
import type { ClipboardService } from './clipboard';

export const browserClipboard: ClipboardService = {
  async copy(text: string) {
    await navigator.clipboard.writeText(text);
  },
};

// src/lib/services/clipboard-fake.ts
import type { ClipboardService } from './clipboard';

export function createFakeClipboard(): ClipboardService & { lastCopied: string | null } {
  let lastCopied: string | null = null;
  return {
    async copy(text: string) { lastCopied = text; },
    get lastCopied() { return lastCopied; },
  };
}
```

**Injection via Svelte context (root layout):**

```typescript
// src/lib/services/context.ts
import { getContext, setContext } from 'svelte';
import type { ClipboardService } from './clipboard';
import { browserClipboard } from './clipboard-browser';

const CLIPBOARD = Symbol('clipboard');

export function provideClipboard(service: ClipboardService = browserClipboard) {
  setContext(CLIPBOARD, service);
}

export function useClipboard(): ClipboardService {
  return getContext(CLIPBOARD) ?? browserClipboard;
}
```

**Component using it:**

```svelte
<script lang="ts">
  import { useClipboard } from '$lib/services/context';
  const clipboard = useClipboard();
  let copied = $state(false);

  async function handleCopy(text: string) {
    await clipboard.copy(text);
    copied = true;
  }
</script>
```

**Test providing the fake:**

```typescript
// tests/components/ShareButton.test.ts
import { render } from '@testing-library/svelte';
import { provideClipboard } from '$lib/services/context';
import { createFakeClipboard } from '$lib/services/clipboard-fake';
import ShareButton from '../../src/pages/ShareButton.svelte';

test('copies URL on click', async () => {
  const fake = createFakeClipboard();
  render(ShareButton, {
    context: new Map([[Symbol('clipboard'), fake]]),
  });
  // ... click button, assert fake.lastCopied === expected URL
});
```

**Same pattern for:** `localStorage`, `navigator.share`, `navigator.geolocation`, `fetch` wrappers, `document.title`, `window.open`.

#### 6.4.2 Test files layout

```
tests/
├── unit/                    — Pure logic: build scripts, utilities
│   ├── parse.test.ts
│   ├── validate.test.ts
│   └── images.test.ts
├── components/              — Svelte component tests
│   ├── PostCard.test.ts
│   ├── PostListPage.test.ts
│   └── ShareButton.test.ts
├── e2e/                     — Playwright tests
│   ├── home.spec.ts
│   ├── navigation.spec.ts
│   ├── posts.spec.ts
│   └── events.spec.ts
└── fixtures/                — Sample markdown content + mock JSON
    ├── content/posts/valid-post.md
    ├── content/posts/invalid-post.md
    ├── data/posts/index.json
    └── data/posts/sample.json
```

#### 6.4.3 Coverage targets

| Metric | Target |
|--------|--------|
| Lines | >= 80% |
| Branches | >= 70% |
| Functions | >= 80% |
| Statements | >= 80% |

Component tests run server-side in jsdom (no browser needed). Playwright tests run in CI via `@playwright/test` with Chromium headless.

### 6.5 Git hooks

Hooks live in `.githooks/` tracked in the repo (version controlled, shared across team). `simple-git-hooks` config in `package.json` points `core.hooksPath` to `.githooks/` so git picks them up automatically after `pnpm install`. The `scripts/setup.ts` script also runs the `simple-git-hooks` install step.

| Hook | Action |
|------|--------|
| pre-commit | 1) `lint-staged` (format + lint). 2) Check staged image files — any `.jpg/.png/.gif` > **500 KB** blocks the commit with a list of oversized files + sizes |
| pre-push | Full `pnpm check` (lint + type-check + test + complexity) |

**lint-staged config:**

```json
{
  "*.{ts,svelte}": ["eslint --fix", "prettier --write"],
  "*.{md,json,yaml,yml}": ["prettier --write"],
  "*.{jpg,jpeg,png,gif}": ["scripts/check-image-size.sh"]
}
```

**Image size check script — `.githooks/pre-commit` (also referenced as `scripts/check-image-size.sh`):**

```bash
#!/usr/bin/env bash
# Block commit if any staged image exceeds 500 KB
MAX_SIZE=$((500 * 1024))
OVERSIZED=""
while read -r file; do
  [ -z "$file" ] && continue
  size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
  if [ "$size" -gt "$MAX_SIZE" ]; then
    OVERSIZED="$OVERSIZED\n  $file ($(( size / 1024 )) KB)"
  fi
done <<< "$(git diff --cached --name-only --diff-filter=ACM | grep -iE '\.(jpg|jpeg|png|gif)$')"

if [ -n "$OVERSIZED" ]; then
  echo "Error: Images exceeding 500 KB cannot be committed."
  echo "Resize or compress before committing:"
  echo -e "$OVERSIZED"
  exit 1
fi
```

Source images are checked at commit time. Build pipeline (sharp) handles resizing for production, but oversized originals bloat the repo and slow clones. 500 KB threshold covers reasonable photo resolution without forcing excessive compression.

`.githooks/` is tracked and pushed. `simple-git-hooks` config in `package.json`:

```json
{
  "simple-git-hooks": {
    "pre-commit": ".githooks/pre-commit",
    "pre-push": ".githooks/pre-push"
  }
}
```

### 6.6 Package scripts

```json
{
  "scripts": {
    "dev":             "vite",
    "build":           "npm run build:content && npm run build:spa",
    "build:content":   "tsx scripts/build.ts",
    "build:spa":       "vite build",
    "lint":            "eslint src/ scripts/",
    "format":          "prettier --check src/ scripts/ content/",
    "type-check":      "tsc --noEmit",
    "test":            "vitest run",
    "complexity":      "npm run complexity:eslint && npm run complexity:escomplex",
    "check":           "npm run lint && npm run type-check && npm run test && npm run complexity",
    "precommit":       "lint-staged",
    "prepush":         "npm run check"
    /* ... preview, format:write, test:watch, test:coverage, complexity:* variants omitted */
  }
}
```

---

## 7. CI/CD

### GitHub Actions workflow — `.github/workflows/deploy.yml`

```yaml
name: Build & Deploy
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check        # lint + type-check + test + complexity
      - run: pnpm build        # content build + SPA build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/

  deploy:
    needs: build
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@v4
```

### Build approval gates (order in CI)

1. TypeScript compile (`tsc --noEmit`)
2. ESLint (0 warnings = pass)
3. Complexity checks (thresholds above)
4. Unit + component tests + coverage minimum
5. Content build runs (validates all frontmatter, catches broken image refs)
6. SPA build

If any gate fails, deploy stops. No broken content reaches production.

---

## 8. Dependencies

### Production

```json
{
  "dependencies": {
    "svelte": "^5.56.0",
    "svelte-spa-router": "^4.0.0",
    "marked": "^15.0.0"
  }
}
```

### Dev

```json
{
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^7.1.0",
    "@testing-library/svelte": "^5.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-sonarjs": "^4.0.0",
    "eslint-plugin-svelte": "^3.0.0",
    "gray-matter": "^4.0.0",
    "lint-staged": "^15.0.0",
    "prettier": "^3.0.0",
    "prettier-plugin-svelte": "^3.0.0",
    "sharp": "^0.33.0",
    "simple-git-hooks": "^2.0.0",
    "tsx": "^4.0.0",
    "typhonjs-escomplex": "^0.1.0",
    "typescript": "^5.8.0",
    "vite": "^8.0.0",
    "vitest": "^3.0.0",
    "zod": "^3.23.0",
    "@playwright/test": "^1.50.0",
    "jsdom": "^26.0.0"
  }
}
```

---

## 9. Project skeleton (once scaffolded)

### 9.1 Setup (after node + pnpm installed)

```bash
# One command — clones, installs, sets up git hooks
git clone <repo-url> && cd ainooga.org && pnpm run setup
```

The `setup` script (`scripts/setup.ts`) does:
1. `pnpm install` — install all dependencies
2. `npx simple-git-hooks` — register `.githooks/` as git hooks path
3. `pnpm build:content` — build example content → JSON (verify pipeline works)
4. Prints success message with next steps

**Manual steps (if setup script skipped):**

```bash
pnpm install
npx simple-git-hooks
pnpm build:content
```

**README.md must contain:**

```markdown
# Ainooga Club

Static SPA for ainooga.org. Content in markdown, compiled to JSON at build.

## Prerequisites

- Node.js >= 20
- pnpm >= 9

## Quick start

pnpm run setup
pnpm dev

## Scripts

| Script | What |
|--------|------|
| pnpm dev | Start dev server with hot reload |
| pnpm build | Build content + SPA for production |
| pnpm check | Full validation: lint + type-check + test + complexity |
| pnpm test | Run unit + component tests |
| pnpm test:e2e | Run Playwright E2E tests (requires pnpm build first) |

## Content

Add markdown files to content/posts/, content/events/, content/members/.
Frontmatter validated strictly at build. See content model in REQUIREMENTS.md.
```

### 9.2 Setup script — `scripts/setup.ts`

```typescript
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function run(cmd: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function main() {
  console.log('\n  Setting up ainooga.org...\n');
  run('pnpm install');
  run('npx simple-git-hooks');
  if (!existsSync('static/data/posts/index.json')) {
    console.log('\n  Building content for the first time...');
    run('pnpm build:content');
  }
  console.log('\n  Done. Run pnpm dev to start.');
}

main();
```

`package.json` adds:

```json
{
  "scripts": {
    "setup": "tsx scripts/setup.ts"
  }
}
```

### 9.3 Developer workflow

```bash
# First time
pnpm setup

# Daily
pnpm dev              # hot-reload dev server
# ... edit content/*.md or src/*.svelte ...

# Before push
pnpm check            # fails early if something is broken
```

```
ainooga.org/
├── .github/workflows/deploy.yml
├── .gitignore
├── .prettierrc
├── eslint.config.js           # flat config
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── package.json
├── README.md
├── .gitignore
├── .prettierrc
├── .githooks/
│   ├── pre-commit             # format + lint + image size check
│   └── pre-push               # full check suite
├── eslint.config.js           # flat config
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── package.json
├── README.md
├── content/
│   ├── site.yml
│   ├── posts/
│   │   └── 2024-06-13-hello.md
│   ├── events/
│   └── members/
├── scripts/
│   ├── setup.ts               # one-command setup: install deps, init hooks
│   ├── build.ts               # orchestrator
│   ├── parse.ts               # glob + gray-matter + zod validate
│   ├── images.ts              # sharp processing
│   ├── render.ts              # markdown → HTML + image path resolution
│   ├── emit.ts                # write JSON
│   ├── verify.ts              # post-build sanity checks
│   └── types.ts               # Zod schemas
├── src/
│   ├── main.ts
│   ├── app.html
│   ├── lib/
│   │   ├── fetch.ts           # typed fetch wrapper for data JSON
│   │   ├── stores.ts          # Svelte 5 $state stores
│   │   └── utils.ts
│   └── pages/
│       ├── Home.svelte
│       ├── PostList.svelte
│       ├── PostDetail.svelte
│       ├── EventList.svelte
│       ├── EventDetail.svelte
│       ├── MemberList.svelte
│       └── MemberDetail.svelte
├── static/
│   ├── favicon.ico
│   ├── manifest.json          # placeholder for PWA
│   └── images/
└── tests/
    ├── fixtures/
    ├── unit/
    └── components/
```

---

## 10. Future milestones

| Milestone | When | What |
|-----------|------|------|
| v1.0 | Now | SPA + content build + tooling |
| v1.1 | After core working | PWA (service worker + manifest + offline) |
| v1.2 | Content grows | Search (minisearch, build-time index), RSS feed, 404 page |
| v1.3 | Content > 5K docs | Paginated index JSON, incremental build |
| v1.4 | Multiple editors | Draft branch preview via deploy preview |
| v2.0 | Need drives it | Security hardening (marked config, branch protection docs), richer embeds, comments (giscus) |

---

## 11. Constraints & non-goals

| Out of scope | Reason |
|--------------|--------|
| Admin UI / CMS | GitHub as admin panel — intentional |
| User accounts | No auth, no sessions, no write operations |
| Database | File system + git = database |
| SSR / SSR rendering | Static SPA only — meta tags handled via pre-render of critical routes at build time |
| Comments | External service (e.g., giscus) if needed later |
| Analytics | Self-hosted (e.g., Plausible in static config) if needed later |

---

## 12. Other considerations

### 12.1 SEO & social meta tags

SPA with no SSR means `og:title`, `og:image`, `twitter:card` are set once (the homepage) and stay fixed. Social shares of individual posts/events will show generic previews.

**Mitigations (pick one):**

| Approach | Effort | Coverage |
|----------|--------|----------|
| Static pre-render: generate `posts/<slug>/index.html` per doc at build time with proper `<meta>` tags + client-side SPA bootstrap | Medium | All published docs |
| Critical-route pre-render: generate only for latest 10 posts + upcoming 5 events | Low | Most-shared content |
| Cloudflare Pages Function: serverless function reads JSON data and injects meta tags at request time | Medium | All |
| Accept generic preview (homepage meta only) | Zero | Homepage only |

**Recommendation for v1:** Critical-route pre-render. Add to build pipeline as an emit stage that writes `static/posts/<slug>/index.html` for recent posts. Extend later if social sharing becomes a priority.

### 12.2 404 & error handling

Every data fetch can fail (file missing, renamed slug, old URL bookmarked). Must handle gracefully:

- **SPA router catch-all route** — if no route matches, show `NotFound.svelte`
- **JSON fetch error in detail pages** — if `fetch('/data/posts/x.json')` returns 404, show `NotFound.svelte` instead of broken page
- **JSON parse error** — corrupted file shows an error state with link to homepage
- **Fetch race / network failure** — show retry button, not blank screen
- **Hosting 404 fallback** — deploy `static/404.html` that bootstraps the SPA router (so deep links like `/posts/hello` work on fresh load and bad slugs render the SPA 404 page)

```svelte
{#await fetchDetail(slug)}
  <Skeleton />
{:then data}
  <PostContent {data} />
{:catch error}
  {#if error instanceof NotFoundError}
    <NotFound />
  {:else}
    <ErrorState onRetry={() => fetchDetail(slug)} />
  {/if}
{/await}
```

### 12.3 Loading states

Progressive loading means every route transition has at least one async fetch. Must show progress:

- **Skeleton placeholders** for list pages (card shapes, no text) — CSS-only, no JS
- **Minimal skeleton** for detail pages (title bar + content block shapes)
- **No spinners** — skeletons feel faster because they show structure upfront
- **Prefetch on hover** — `<a>` link hover triggers `fetch()` for that JSON, data arrives before click. Svelte reactive store merges seamlessly.

### 12.4 Accessibility (a11y)

- **Focus management** — SPA route changes must move focus to the `<h1>` of the new page (not leave focus on the clicked link). Use `onMount` + `focus()` on a sentinel element.
- **Skip link** — first focusable element on page, skip to main content
- **Heading hierarchy** — exactly one `<h1>` per page, semantic ordering
- **Alt text on images** — markdown image alt text propagates through build pipeline to JSON, rendered as `<img alt="...">`
- **Color contrast** — tokens must meet WCAG AA (4.5:1 for body text). Verify against chosen `--color-primary` + `--color-bg` combo.
- **Reduced motion** — `prefers-reduced-motion` respected in CSS transitions

### 12.5 Client-side search

Once content grows beyond ~20 docs, users need search. Approach:

- Build pipeline emits a **search index JSON** at build time (all content, stripped of HTML tags, truncated)
- `src/lib/search.ts` uses **minisearch** (tiny, no dependencies, indexes in < 1ms for club-scale data)
- Search index fetched and cached in memory on first search interaction (not on page load)
- Filter results by tags, date range, content type

### 12.6 Image size enforcement

Source images checked at two gates:

| Gate | Threshold | Action |
|------|-----------|--------|
| **pre-commit** (`.githooks/pre-commit`) | Any staged `.jpg/.png/.gif` > **500 KB** | Block commit. List oversized files with size. |
| **Build pipeline** (scripts/images.ts) | Produces webp/avif at target sizes (800w, 1600w, 600w, 200w) | Emits resized output. Originals stay in repo at whatever size passed pre-commit. |

500 KB limit covers typical 12MP phone photos saved at reasonable JPEG quality (~80). Keeps repo clone times fast. Build pipeline handles size optimization for production.

### 12.7 Performance budget

| Asset | Budget (gzipped) |
|-------|-------------------|
| SPA JS bundle (initial) | < 50 KB |
| Index JSON (list page) | < 5 KB per fetch |
| Detail JSON | < 15 KB per fetch |
| Hero/thumbnail images | < 50 KB (800w webp) |
| Full-size images | < 150 KB (1600w webp) |

Enforce with `vite.config.ts` `rollupOptions.output.manualChunks`. Lighthouse CI check in pipeline (separate workflow, non-blocking).

### 12.8 Image lazy loading

Images in markdown content (rendered to HTML) must use `loading="lazy"` by default. Banner images above the fold can use `loading="eager"` (configurable in frontmatter via `bannerLoading: eager`). The render stage adds `loading="lazy"` to all `<img>` tags unless overridden.
