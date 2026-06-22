# Pages Functions → Workers migration

## Motivation

The `functions/` directory used Cloudflare Pages Functions to handle API
endpoints (`/api/subscribe`, `/api/contact-sponsor`, `/confirm`). Pages
Functions are Workers under the hood, but the Pages deployment pipeline
rejects several `wrangler.toml` features that a standalone Worker supports.

The specific blocker was `[[send_email]]` — the Send Email binding for
confirmation emails. Pages refuses it in `wrangler.toml` and the dashboard
won't allow adding it while bindings are managed via `wrangler.toml` (due to
`[[d1_databases]]`). A standalone Worker accepts `[[send_email]]` without
issue.

## Architecture

```
Before                              After
──────                              ─────
Browser → Pages Functions          Browser → Worker (ainooga-api)
           ├─ DB (D1)                        ├─ DB (D1)
           └─ EMAIL (missing)                └─ EMAIL (Send Email binding)
         + Pages static assets             + Pages static assets (unchanged)
```

The Pages project (`ainooga-org`) continues to serve the SPA static assets
from `dist/`. The Worker (`ainooga-api`) handles all API routes. A Cloudflare
Route connects them so `ainooga.org/api/*` and `ainooga.org/confirm` are
handled by the Worker while everything else goes to Pages.

## Worker structure

```
worker/
├── wrangler.toml          # Worker config with D1 + send_email bindings
├── .dev.vars              # Local secrets (TURNSTILE_SECRET_KEY, SITE_URL)
└── src/
    ├── index.ts           # Router — dispatches to handlers, adds CORS
    ├── subscribe.ts       # POST /api/subscribe
    ├── contact-sponsor.ts # POST /api/contact-sponsor
    ├── confirm.ts         # GET /confirm
    ├── adapters.ts        # DB, Email, Turnstile factories
    └── types.ts           # Shared types (Env, DbClient, EmailSender, etc.)
```

### `worker/wrangler.toml`

```toml
name = "ainooga-api"
compatibility_date = "2026-06-22"
main = "src/index.ts"

[[d1_databases]]
binding = "DB"
database_name = "ainooga-d1"
database_id = "3072a675-8a15-4019-8648-17a17ad1cadd"

[[send_email]]
name = "EMAIL"

[vars]
SITE_URL = "https://ainooga.org"
```

Note: `TURNSTILE_SECRET_KEY` is set via `wrangler secret put` (not in
`wrangler.toml`). Locally it lives in `worker/.dev.vars`.

## Key differences from Pages Functions

| Concern           | Pages Functions                                    | Worker                                           |
| ----------------- | -------------------------------------------------- | ------------------------------------------------ |
| Entry signature   | `onRequest(context)`                               | `fetch(request, env)`                            |
| Binding for EMAIL | Not supported in `wrangler.toml`                   | `[[send_email]]`                                 |
| Routing           | File-based (`api/subscribe.ts` → `/api/subscribe`) | Code-based (`index.ts` switch on `url.pathname`) |
| CORS              | Middleware file (`_middleware.ts`)                 | Inline in `index.ts` response headers            |
| Dev server port   | `wrangler pages dev` → `:8788`                     | `wrangler dev` → `:8787`                         |
| Secrets file      | `.env`                                             | `.dev.vars`                                      |

## Local development

Two servers needed:

```bash
# Terminal 1 — Worker (API on :8787)
pnpm worker:dev

# Terminal 2 — SPA dev server (proxies /api → :8787)
pnpm run build:content && pnpm dev
```

Or in one terminal (backgrounds the Worker):

```bash
pnpm dev:all
```

Vite proxies `/api/*` and `/confirm` to `http://localhost:8787` (configured in
`vite.config.ts`).

Before first local run, apply D1 migrations to the local database:

```bash
pnpm cf:migrate:local
```

## Deployment

### 1. Connect Worker to GitHub (Cloudflare Git integration)

Same pattern as Pages — Cloudflare manages the deploy directly via OAuth:

**Dashboard → Workers & Pages → ainooga-api → Settings → Git integration →
Connect to GitHub**

| Setting           | Value                               |
| ----------------- | ----------------------------------- |
| Repository        | `ainooga.org` (same repo as Pages)  |
| Root directory    | `worker/`                           |
| Production branch | `main`                              |
| Build command     | (leave empty — wrangler handles it) |

Now pushes to `main` that touch `worker/**` automatically deploy the Worker.
The Pages project (`ainooga-org`) has its own separate Git integration pointing
at the repo root — two independent auto-deploys from one repo.

### 2. Set the Turnstile secret

```bash
cd worker && npx wrangler secret put TURNSTILE_SECRET_KEY
```

Enter the production secret key when prompted.

### 3. (done) Configure routing

Routes are set in `worker/wrangler.toml` and were applied via `wrangler deploy`:

```toml
routes = [
  { pattern = "ainooga.org/api/*", zone_id = "b973825a865d2deb4c37e6651513a84a" },
  { pattern = "ainooga.org/confirm", zone_id = "b973825a865d2deb4c37e6651513a84a" },
]
```

Requests matching these routes run the Worker. Everything else hits Pages static assets.

### 4. (done) `functions/` cleanup

The `functions/` directory has been deleted. All API logic lives in `worker/`.

### 5. (done) Local dev scripts updated

- `cf:dev` now runs `cd worker && wrangler dev`
- Vite proxies both `/api/*` and `/confirm` to `:8787`
- `dev:all` starts Worker + Vite in one terminal

## Logging

Worker logs appear in **Dashboard → Workers & Pages → ainooga-api →
Observability → Logs**. The log messages from `adapters.ts` use `[subscribe]`
prefix and will show:

- `[subscribe] Sending confirmation to ...` — about to send email
- `[subscribe] Confirmation email sent to ...` — send succeeded
- `[subscribe] Failed to send confirmation to ...` — send threw
- `[subscribe] EMAIL binding not configured` — binding missing

## Current status (2026-06-22)

- [x] Worker created at `worker/` and deployed as `ainooga-api`
- [x] `TURNSTILE_SECRET_KEY` secret set on the Worker
- [x] **Configure Cloudflare Routes** — Routes added for `ainooga.org/api/*`
      and `ainooga.org/confirm` pointing to the `ainooga-api` Worker
- [x] `functions/` directory deleted — all API logic lives in `worker/`
- [x] `package.json` updated: `cf:dev` now runs the Worker directly,
      `dev:all` works in a single terminal, lint-staged covers `worker/`
- [x] `vite.config.ts` proxies both `/api/*` and `/confirm` to `:8787`
- [x] Tests updated to import from `worker/src/` instead of `functions/lib/`
- [x] `eslint.config.js` updated: `worker/**/*.ts` replaces `functions/**/*.ts`
- [x] Routes configured in `wrangler.toml` and applied via `wrangler deploy`
- [x] `CLOUDFLARE.md` and `docs/INFRA.md` updated to reflect Worker architecture
- [ ] **Test a subscription end-to-end in production** — final manual step.
      Submit the mailing list form and sponsor form on ainooga.org, verify
      confirmation email arrives, click confirm link. Check Worker logs under
      Dashboard → ainooga-api → Observability → Logs for `[subscribe]` messages.
