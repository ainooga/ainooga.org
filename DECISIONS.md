# Design & Implementation Decisions

Every major decision made while building ainooga.org v1, with rationale. Accumulated during implementation — not retrofitted.

---

## 1. Design System

### 1.1 Color palette

| Token | Value | Rationale |
|-------|-------|-----------|
| `--color-bg` | `#FBF9F6` | Warm off-white. Rejects cold tech blue-white. Reference: quality paper stock, interior of a good hotel lobby. |
| `--color-surface` | `#FFFFFF` | Cards and surfaces need contrast against warm bg. Pure white keeps it clean. |
| `--color-surface-alt` | `#F2EFEB` | Alternating sections. Slightly warmer than bg for depth without harsh borders. |
| `--color-text` | `#1A1614` | Near-black with warm undertone. Pure black (`#000`) is too harsh for editorial reading. |
| `--color-text-secondary` | `#6B6560` | Muted but readable. Warm undertone matches palette. |
| `--color-primary` | `#1B2A3C` | Deep navy. Authority, intelligence, night sky over Chattanooga. Not blue-tech (#3b82f6). |
| `--color-accent` | `#B87333` | Copper. References Chattanooga's industrial heritage (copper, metal). Warm, premium, distinctive. |
| `--color-accent-subtle` | `#F0E6D8` | Copper tint for hover states, avatar backgrounds. |

**Rejected:** `#3b82f6` (blue tech — generic startup), `#10b981` (green — SaaS), any neon/purple (AI cliché). The goal was warm + authoritative, not "tech company."

### 1.2 Typography

| Role | Font | Why |
|------|------|-----|
| Headings | Playfair Display | Refined serif. Signals intellectual authority. Georgia alternative rejected — too common. |
| Body | Inter | Clean, highly readable at all sizes. Open Sans rejected — too wide for editorial feel. |
| Monospace | JetBrains Mono | Code blocks. Referenced in app.css but loaded from system if unavailable. |

**Pairing logic:** Serif for titles = editorial/literary feel (like a magazine). Sans for body = clarity for technical content. The contrast between them signals "this is both thoughtful and technical."

**Rejected type scales:** 4px base (too cramped for editorial). Chose a generous scale: base 16px → 5xl 3.25rem (52px) for hero.

### 1.3 Spacing

- Base unit: 0.25rem (4px). Multiples create a consistent rhythm.
- Cards/comfy padding: `--space-xl` (2rem/32px). Generous but not wasteful.
- Section padding: `--space-4xl` (6rem/96px). Allows content to breathe.
- Hero padding-top: `--space-5xl` (8rem/128px). Feels luxurious, invites reading.

**Philosophy:** "Billion dollar design" means space is free. Cramped layouts feel cheap regardless of content quality.

### 1.4 Layout

- Max content width: 1200px (`--content-max`). Wide enough for editorial two-column layouts.
- Narrow content: 720px (`--content-narrow`). Detail pages use this for optimal reading line length (~66 chars).
- Grid: 2-col and 3-col with `gap: var(--space-xl)`. Consistent across home, events, members.
- Cards: border + subtle shadow on hover. No heavy box-shadows (feels material-design cheap).

**Rejected:** Full-bleed layouts for an SPA (better for marketing sites), fixed sidebar (too complex for current content volume), masonry (adds visual noise without content to justify it).

---

## 2. Architecture

### 2.1 Hash routing over pushState

**Decision:** Custom hash-based router in `Router.svelte` instead of svelte-spa-router or page.js.

**Rationale:**
- Zero dependencies for routing. No npm package overhead.
- Hash routing works trivially on static hosting — no server rewrites needed.
- `404.html` fallback + hash redirect handles deep links.
- For Svelte 5, `svelte-spa-router` v4 compatibility is uncertain. Custom router is ~50 lines, trivial to maintain.

**Trade-off:** URLs contain `#/events` instead of `/events`. Ugly but functional. Can migrate to pushState later with a Vite plugin that generates per-route HTML shells.

### 2.2 Build pipeline as separate TS scripts (not Vite plugin)

**Decision:** Separate `scripts/` directory with TypeScript, invoked via `tsx`. Not a Vite plugin.

**Rationale:**
- Build is independent of the bundler. Can run without Vite.
- Content build takes ~200ms. Running it as a Vite plugin would couple it to the dev server.
- Each stage is a separate file — single responsibility, testable in isolation.
- Follows AGENTS.md prescription: "Keep scripts single-purpose per stage."

### 2.3 No routing library

**Decision:** Custom Svelte 5 hash router in `Router.svelte`.

**Rationale:** Svelte 5 `$state` makes reactive hash parsing trivial. No external dependency needed. For 7 routes, a library is overhead.

**Edge case handled:** `{#key route.page + JSON.stringify(route.params)}` ensures component destroy/recreate on route change, resetting internal state (scroll position, loaded data).

---

## 3. Content Model Extensions

### 3.1 Sponsor content type

**Decision:** Added `content/sponsors/` with `SponsorFrontmatter` schema.

**Rationale:** The user specified sponsorship solicitation. A separate content type allows:
- Dedicated `/sponsor` page with tier table
- Featured sponsors on home page
- Clear schema validation at build

**Schema design choices:**
- `tier: enum` over just string: validates at build, enables tier-based rendering logic.
- `featured: boolean` controls home page display. Not auto-featured — editorial decision.
- No `.default()` on any field. AGENTS.md rules apply.
- `since: date` tracks relationship length. Useful for "since 2025" displays.

### 3.2 Event schema — location type

**Decision:** `location: string` (free text) rather than structured `{name, address, city}`.

**Rationale:** Events may be at varied venues (Enterprise Center, co-working spaces, breweries, member homes). Free text is simpler and handles "The Enterprise Center, Chattanooga" without forcing a schema explosion. Structured address can be added when map embeds are needed.

### 3.3 Site config — nav as array

**Decision:** Nav in `site.yml` as an array of `{label, path}` objects.

**Rationale:** Single source of truth for navigation. Build pipeline reads it, SPA fetches it. Adding a nav item = editing one file. No TypeScript recompilation needed.

---

## 4. SPA Design

### 4.1 Home page layout

**Decision:** Hero → Upcoming Event → All Events → Recent Posts → Sponsor Bar → Footer.

**Rationale:**
1. Hero establishes identity immediately (who, where, what).
2. Upcoming event is the primary call-to-action (face-to-face is core value).
3. Events section reinforces the IRL focus.
4. Posts demonstrate intellectual substance (education, policy, research).
5. Sponsors show legitimacy and provide CTA for potential sponsors.

**Rejected:** Post-first layout (puts writing ahead of events — wrong priority for a club that meets), no hero (feels like a blog, not a club), sponsor-first (premature — need social proof first).

### 4.2 Loading states — skeletons, no spinners

**Decision:** CSS-only skeleton placeholders (shimmer animation). No spinners, no loading bars.

**Rationale:**
- Skeletons show structure immediately. User's brain registers "content is coming" rather than "something is loading."
- CSS-only — no JS cost for the animation itself.
- Matches AGENTS.md section 13.3: "Skeletons feel faster because they show structure upfront."

### 4.3 Error handling — notfound vs fetch error

**Decision:** Two error variants: `'notfound'` (404 from JSON fetch) and `'fetch'` (network error).

**Rationale:**
- 404 = the content legitimately doesn't exist. Show `NotFound.svelte` (stylized 404 page).
- Fetch error = network blip. Show retry button.
- Different user experiences for different failure modes. The 404 page should feel final; the retry state should feel transient.

**Missed in v1 (documented):** `NotFoundError` class for type-safe error discrimination. Currently using string literals. Should refactor when other error types are added.

### 4.4 Focus management

**Decision:** Router calls `focus()` on `<main> h1` after hash change.

**Rationale:** SPA route changes don't trigger browser focus management. Without this, keyboard users remain focused on the clicked link. Moving focus to the page title is the WCAG recommended pattern.

**Implementation:** `onHashChange` in `Router.svelte` queries `document.querySelector('main h1')` and focuses it. Simple, works for all pages.

### 4.5 No Svelte context for browser services (v1)

**Decision:** v1 calls `fetch()` directly in pages. Service interface pattern deferred.

**Rationale:** AGENTS.md prescribes service interfaces for clipboard, localStorage, etc. v1 has no clipboard or localStorage usage — only `fetch` for data loading. Adding the abstraction layer now would be speculative. The fetch wrapper in `src/lib/fetch.ts` provides a typed base that can be upgraded to a context-based service later.

**When to add:** When a second browser API is needed (clipboard for sharing, localStorage for preferences).

---

## 5. Developer Experience

### 5.1 pnpm over npm

**Decision:** pnpm as package manager.

**Rationale:** Strict dependency isolation, faster installs, disk efficiency. The club project doesn't need it, but the standard is set for consistency.

### 5.2 tsx over ts-node / ts-node-esm

**Decision:** `tsx` for running TypeScript build scripts.

**Rationale:** ES module support without configuration. Faster than `ts-node --esm`. Single dependency.

### 5.3 TypeScript strict mode with verbatimModuleSyntax

**Decision:** `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`.

**Rationale:** Prevents entire classes of bugs at compile time. `verbatimModuleSyntax` forces explicit `type` imports — keeps bundler output clean. Slightly more verbose imports, zero runtime issues.

### 5.4 ESLint flat config

**Decision:** `eslint.config.js` (flat config) over `.eslintrc.*`.

**Rationale:** ESLint 9+ deprecates legacy config. Flat config is the future. No `.eslintignore` needed — `ignores` in config handles it.

### 5.5 Complexity gates via ESLint only (v1)

**Decision:** `eslint-plugin-sonarjs` for cognitive complexity, ESLint built-in `complexity` for cyclomatic. No `typhonjs-escomplex`.

**Rationale:** `escomplex` requires separate tooling and output parsing. For v1, ESLint gates are sufficient and fail the build immediately. `escomplex` can be added when the codebase grows past 10 files.

---

## 6. What's Deferred (v1.x)

These were explicitly deferred to keep v1 shippable, not forgotten:

| Feature | When | Why deferred |
|---------|------|--------------|
| Image processing (sharp) | v1.1 | Requires C++ build tools in CI. Content has no images yet. |
| Per-doc SEO meta tags | v1.1 | Requires pre-render step or CF Pages Function. |
| PWA / service worker | v1.2 | No caching strategy designed. Content is static JSON — good fit for SW. |
| Client-side search | v1.3 | ~5 docs = not needed. Add when content > 20. |
| E2E tests (Playwright) | v1.1 | Requires `pnpm build` + server. CI not configured for it yet. |
| Component tests | v1.1 | No complex interactive components yet (no forms, no clipboard). |
| Fake service implementations | v1.2 | No browser APIs used yet. Add when clipboard/share added. |
| Sponsorship contact form | v1.1 | Needs form submission handling. "Contact us" button is placeholder. |

---

## 7. Specific Trade-offs

### 7.1 Hash vs pushState routing

**Decision:** Hash (`#/events`).

**Cost:** Ugly URLs. Social shares show `ainooga.org/#/events` instead of `ainooga.org/events`.

**Benefit:** Zero server configuration. Works on any static host. 404.html fallback is a 5-line redirect.

**Mitigation:** The SPA is for a club, not a product landing page. URL aesthetics matter less than reliability. Can migrate to pushState by generating per-route `index.html` files at build time (future milestone).

### 7.2 No SSR, no pre-render

**Decision:** Pure client-rendered SPA.

**Cost:** Social previews show generic og:image (homepage). No server-rendered content for crawlers.

**Benefit:** Simplest deployment. No server, no build-time HTML generation, no hydration mismatches.

**Acceptance:** Documented in REQUIREMENTS.md section 13.1. Club content is shared mostly via Discord/email, not Twitter/LinkedIn. If social sharing becomes important, pre-render can be added per 13.1 recommendations.

### 7.3 One event detail page component

**Decision:** `EventDetail.svelte` handles all rendering — body HTML, schedule tables, etc.

**Cost:** The component is ~150 lines. Could be split into `EventSchedule`, `EventLocation`, `EventMeta` sub-components.

**Benefit:** No premature abstraction. The component is readable as-is. Split when a second detail page type needs the same sub-components.

### 7.4 Copper accent over "tech blue"

**Decision:** `#B87333` (copper) instead of `#3b82f6` (blue).

**Risk:** Copper is unusual for tech. May not signal "AI club" to first-time visitors.

**Rationale:** Every AI/tech startup uses blue. Copper tells a specific story: Chattanooga's history as an industrial city (copper mining, metal manufacturing) meeting its future as a tech hub. It's distinctive, warm, and premium. Visitors who don't "get it" on first glance will understand when they read the About page.

---

## 9. Post-Implementation Revisions

### 9.1 Rebrand: Ainooga → AI Nooga

**Decision:** Renamed from "Ainooga" to "AI Nooga" throughout all source files, content, meta tags, and build output.

**Rationale:** "AI Nooga" is more immediately recognizable:
- "AI" signals the club's focus upfront
- "Nooga" is local shorthand for Chattanooga
- Together they form a name that reads as both a word and an acronym

The mark in the header changed from a lone "A" to "AI" — two characters that fit the 32px square at 18px font size.

**Scope:** 20+ files across SPA components, content markdown, scripts, static assets, and documentation.

### 9.2 Events page: redundant headings removed, bottom spacing fixed

**Decision:** Removed the `<h2 class="section__title">Events</h2>` and `<h2 class="section__title">Previous events</h2>` after their respective section labels. Replaced `section` class (which has 6rem padding) with `events-section` (2rem padding, 4rem on last).

**Before:** "Upcoming" label + "Events" heading → redundant text. 6rem bottom padding on last section → too tall.

**After:** Label only (label contains the semantic info). 2rem section padding, last section gets 4rem bottom for visual breathing room without wasted space.

### 9.3 About and Sponsor pages: consistent editorial layout

**Decision:** Converted both pages from `container-narrow` (720px) to `container` (1200px) with proper `page-title` hero headers matching Events and Posts pages.

**Rationale:** The narrow container made these pages look "squashed" when navigating from wider list pages. The club's editorial design language demands consistent page rhythm — full-width header with generous margins, then a divider, then content sections. Both pages now use the same `section__label` + `section__title` + body content pattern as every other page.

### 9.4 Sponsor contact form

**Decision:** Replaced the static "Contact us" button with a toggleable form that collects name, phone number, and preferred callback date/time.

**Design choices:**
- Form hidden by default. Click "Contact us" → slides in. Reduces visual clutter.
- Fields: Name (required), Phone (required, minimal validation), Date (optional), Time (optional).
- Validation: client-side only for v1. Phone cleaned of formatting chars, minimum 7 digits.
- On submit: shows success message with the submitted phone number, reset option.
- No server endpoint yet — logs to console. Placeholder for future form handler.
- Styled consistently with app design tokens: `form-input` uses `--color-border`, `--radius-sm`, focus ring in accent color.

**Deferred:** Server-side submission, email notification, spam protection, structured phone validation for international numbers.

---

## Standards Enforced

Throughout implementation, these rules from AGENTS.md were followed:

| Rule | Where applied |
|------|---------------|
| Zod `.strict()`, no `.default()` | `scripts/types.ts` — all schemas |
| No partial output on build failure | `scripts/build.ts` — `process.exit(1)` on any error |
| All errors collected, not first-fail | `scripts/parse.ts` — accumulates `FieldError[]` |
| Semantic CSS, no utility classes | `src/app.css` + all `.svelte` `<style>` blocks |
| No raw values in component styles | Every value references a CSS custom property |
| Boring, idiomatic TypeScript | Explicit types, no `any`, early returns, no clever patterns |
| No skipped tests | No `test.skip` or `xit` in any file |
| Human-readable error messages | `zod-validation-error` for frontmatter errors |
| 404 handling at three levels | Router catch-all + fetch error → NotFound + `static/404.html` |
