# Newsletter signup — state contract

This document defines the states, transitions, and contracts for the site-wide
newsletter subscription flow in `SiteFooter.svelte`. It deliberately does not
prescribe markup, animation, or styling — only the behavioral contract an
implementation must satisfy.

---

## Architecture overview

The frontend talks to a single backend endpoint. Turnstile siteverify is handled
server-side, not by a separate Worker call from the frontend.

```
User → [Svelte footer form] → POST /api/subscribe → [Cloudflare Pages Function]
                                                      ├─ siteverify (Cloudflare API)
                                                      ├─ D1 insert
                                                      └─ SendGrid email send
```

The deployment Turnstile Worker (`turnstile-siteverify-ainooga-org`) exists but
is **not** wired into this flow — the Pages Function calls siteverify directly.
This is intentional: verification and subscription are atomic in one request.

---

## States

### 1. IDLE

The form is visible with an email address input and a "Subscribe" button.
No Turnstile widget is rendered. No verification state exists.

**Transition trigger:** User clicks "Subscribe" with a non-empty, valid-looking
email address.

**Handoff:** Email value is captured. Form transitions to REVEALING.

---

### 2. REVEALING

The Turnstile widget container becomes visible. The widget is rendered into it.
The Submit button should show a loading or "waiting" state — the user's next
action is to complete the Turnstile challenge, not to click again.

**Turnstile render inputs (contract):**

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| `sitekey`          | From `VITE_TURNSTILE_SITE_KEY` env var                   |
| `action`           | `"turnstile-spin-v1"`                                    |
| `callback`         | Function that receives the token and triggers SUBMITTING |
| `error-callback`   | Function that transitions to ERROR_TURNSTILE             |
| `timeout-callback` | Function that transitions to ERROR_TIMEOUT               |
| `expired-callback` | Function — see notes below                               |
| `refresh-expired`  | Not set (defaults to `"auto"`)                           |

**Callback contract:**

| Turnstile callback   | Transition to     | Notes                                                                                                                                                                                                               |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `callback(token)`    | SUBMITTING        | Token is fresh. Immediately send to backend.                                                                                                                                                                        |
| `error-callback()`   | ERROR_TURNSTILE   | Turnstile encountered a script/challenge error. Destroy widget, retry render.                                                                                                                                       |
| `timeout-callback()` | ERROR_TIMEOUT     | Challenge timed out. Turnstile auto-retries internally; wait for `callback` or `error-callback`. If no response within reasonable threshold, treat as ERROR_TURNSTILE.                                              |
| `expired-callback()` | (no state change) | Turnstile auto-refreshes (`refresh-expired: auto`). Do nothing — `callback` fires again with a fresh token when ready. If user submits after expiry (via `getResponse()`), the backend will reject the stale token. |

**Inactivity timeout:** A timer starts when entering REVEALING. If no
`callback` fires within the timeout window (recommended: 60 seconds),
the widget is destroyed and the form returns to IDLE. The timer resets
if the user re-clicks Subscribe, entering REVEALING afresh.

This prevents Turnstile's auto-refresh from re-challenging a user who
switched tabs, walked away, or otherwise stopped engaging with the form.
Better to return to a clean IDLE state than to surprise the user with
a verification widget they didn't ask for.

**Edge — Turnstile script never loads:** If `window.turnstile` is still
undefined after a reasonable timeout (e.g. 10s), transition to ERROR_LOAD.

---

### 3. SUBMITTING

A Turnstile token has been obtained. The form sends `POST /api/subscribe` with
the email and token. The Submit button must be disabled. No further user input
is accepted.

**Request contract:**

```
POST /api/subscribe
Content-Type: application/json

{
  "email": "<string>",
  "turnstileToken": "<string>"
}
```

**Response contract:**

| HTTP status     | `body.success` / pattern                       | Meaning                                           | Transition to               |
| --------------- | ---------------------------------------------- | ------------------------------------------------- | --------------------------- |
| 201             | `{ message: "Check your email to confirm." }`  | Email sent. New subscriber.                       | SUCCESS                     |
| 200             | `{ message: "Already subscribed!" }`           | Email already in DB.                              | SUCCESS (different message) |
| 400             | `{ error: "Verification failed. Try again." }` | Turnstile token rejected (stale, invalid, spent). | ERROR_VERIFICATION          |
| 400             | `{ error: "Valid email required" }`            | Email format rejected.                            | ERROR_VALIDATION            |
| 4xx/5xx         | any other                                      | Unhandled server error.                           | ERROR_SERVER                |
| Network failure | (no response)                                  | `fetch` threw, or DNS/timeout/CORS.               | ERROR_NETWORK               |

**Atom city guarantee:** The backend verifies the Turnstile token **and** inserts
the subscriber in a single request handler. There is no partial-failure window
where the token is consumed but the subscriber isn't created, or vice versa.
If the token fails, no DB write occurs. If the DB write fails, the token is
already spent — the user must re-verify on retry.

---

### 4. SUCCESS

The subscription was accepted. Show a confirmation message — the user needs to
check their email and click the confirmation link. The form should reset to
IDLE state (optionally with a soft "Subscribe another" affordance).

**Reset contract:**

- Clear the email input
- Destroy the Turnstile widget (`turnstile.remove(widgetId)`)
- Return to IDLE (no Turnstile visible)
- Do **not** auto-navigate or reload

---

### 5. ERROR states

All error states must offer a path forward. No dead ends.

| State              | Cause                                          | User sees                               | Continuation                                                                                                                                        |
| ------------------ | ---------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| ERROR_LOAD         | Turnstile script failed to load                | "Verification couldn't load."           | Retry button → re-render widget. If it fails again, offer email as fallback (see below).                                                            |
| ERROR_TURNSTILE    | Challenge error (network glitch, script error) | "Verification failed."                  | Retry button → destroy + re-render widget.                                                                                                          |
| ERROR_TIMEOUT      | Challenge timed out                            | "Verification timed out."               | Retry button → destroy + re-render widget.                                                                                                          |
| ERROR_VALIDATION   | Email format rejected by backend               | Show the backend's `error` message.     | User edits email. On next submit, skip Turnstile reveal if widget still exists with a valid token; otherwise re-render.                             |
| ERROR_VERIFICATION | Turnstile token rejected by siteverify         | "Verification failed. Try again."       | Reset widget (`turnstile.reset(widgetId)`) — Turnstile generates a fresh token. User completes challenge again.                                     |
| ERROR_SERVER       | Backend returned unexpected error              | "Something went wrong. Try again."      | Offer retry. The previous token is spent; destroy and re-render widget so user gets a fresh one.                                                    |
| ERROR_NETWORK      | `fetch` failed (offline, DNS, CORS)            | "Network error. Check your connection." | Offer retry. The token was never sent to the backend, so it's unspent — do **not** destroy the widget. Retry the `apiPost` with the existing token. |

**Fallback for Turnstile load failure:** If Turnstile repeatedly fails to load
(ERROR_LOAD after retry), consider offering an email-only fallback: "Can't load
verification. Enter your email and we'll send a signup link instead." This is
acceptable because the confirmation email acts as a secondary verification step.

---

## Complete state map

```
                        ┌──────────────────────────────────────────────┐
                        │                   IDLE                       │
                        │  [email input] [Subscribe button]            │
                        │  No Turnstile rendered                       │
                        └───────────────┬──────────────────────────────┘
                                        │ user clicks Subscribe
                                        │ (email non-empty)
                                        ▼
                        ┌──────────────────────────────────────────────┐
                        │               REVEALING                      │
                        │  Turnstile widget renders                    │
                        │  Button shows "Verifying…"                   │
                        │  ── inactivity timer (60s) ────────────────► │
                        └──┬───────────────┬───────────────┬───────────┘
                           │               │               │
                  callback(token)    error-callback   timeout-callback
                           │               │               │
                           ▼               ▼               ▼
                    ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
                    │ SUBMITTING   │ │ ERROR_      │ │ ERROR_      │
                    │ POST /api/   │ │ TURNSTILE   │ │ TIMEOUT     │
                    │ subscribe    │ │ [Retry]────►│ │ [Retry]────►│
                    └──┬───────┬───┘ └─────────────┘ └──────────────┘
                       │       │                           │
                  success     error                   (auto-retry)
                       │       │                     may fire callback
                       ▼       ▼                         │ later
                 ┌──────────┐  │ (see ERROR states       │
                 │ SUCCESS  │  │  table)                 │
                 │ "Check   │  │                         │
                 │ email"   │  ▼                         ▼
                 └──────────┘  ┌───────────────────────────────────────┐
                               │         ERROR_VERIFICATION           │
                               │  token rejected by backend           │
                               │  [Try again]──►reset widget──►IDLE   │
                               ├───────────────────────────────────────┤
                               │         ERROR_NETWORK                │
                               │  fetch failed                        │
                               │  [Try again]──►retry as SUBMITTING   │
                               │         (token unspent)              │
                               ├───────────────────────────────────────┤
                               │         ERROR_SERVER                 │
                               │  unexpected backend error            │
                               │  [Try again]──►destroy widget──►IDLE │
                               │         (token spent)                │
                               └───────────────────────────────────────┘
```

---

## Turnstile widget lifecycle rules

1. **Render once per reveal.** When entering REVEALING, call `turnstile.render()`
   on a fresh container element. If the widget is destroyed (SUCCESS or
   ERROR_SERVER), the container element should be removed from the DOM or a new
   one created so the next render is clean.

2. **Reset on token rejection.** On ERROR_VERIFICATION, call
   `turnstile.reset(widgetId)` — this invalidates the old token and generates a
   new challenge. Do not destroy and re-render; reset is lighter.

3. **Destroy on terminal success.** On SUCCESS, call
   `turnstile.remove(widgetId)` and return to IDLE. The container element is no
   longer needed.

4. **Destroy + re-render on hard errors.** On ERROR_LOAD, ERROR_TURNSTILE,
   ERROR_SERVER: destroy the widget, remove the container, re-render on retry.
   This ensures a clean slate.

5. **Keep widget on network errors.** On ERROR_NETWORK, the token was never
   consumed. Keep the widget and its token intact. Retry sends the same token.

6. **Inactivity timer on REVEALING.** When entering REVEALING, start a timer.
   If no `callback` fires within the timeout window (recommended: 60 seconds),
   destroy the widget (`turnstile.remove(widgetId)`) and return to IDLE.

   Cancel the timer on any of:
   - `callback(token)` fires → SUBMITTING
   - `error-callback` fires → ERROR_TURNSTILE (timer cancelled, error state owns the UX)
   - `timeout-callback` fires → ERROR_TIMEOUT (timer cancelled, error state owns the UX)
   - User navigates away or component unmounts

   Do **not** show an error message when the timer fires. The form silently
   returns to IDLE — the user sees the email input and Subscribe button as if
   they never clicked. This is the least surprising outcome for someone who
   walked away mid-flow.

---

## Test coverage requirements

### Testing philosophy

The state machine is designed so that every transition can be exercised in a
unit test — no headless browser, no real Turnstile widget, no real backend.

The formula for each state-transition test is:

> **Arrange:** Instantiate the Svelte component with a `FakeTurnstile` injected
> via context. Mock `globalThis.fetch` (which `apiPost` calls internally).
> **Act:** Trigger the state change (call the callback, fire the timer, or
> simulate a DOM event).
> **Assert:** Check that the component's rendered output matches the target
> state, and that `fetch` was (or wasn't) called with the expected payload.

Integration and E2E tests exist only to prove the glue — that real Turnstile
loads, that real HTTP reaches the real backend, that the widget's callbacks
actually fire in a real browser. They test **one** happy path and maybe **one**
error path. They do **not** exhaust the state machine.

### Layered test strategy

| Layer           | Environment                                                            | What it proves                                                      | Number of tests                   |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| **Unit**        | jsdom + `FakeTurnstile` + mocked `fetch`                               | Every state transition behaves correctly                            | All transitions (see table below) |
| **Integration** | jsdom + real `window.turnstile` (loaded via script) + mocked `fetch`   | Turnstile script loads, widget renders, callbacks wire to component | 1–2 (happy path + one error)      |
| **E2E**         | Playwright (headless Chromium) + real Turnstile sandbox + real backend | Full round-trip: page → form → challenge → HTTP → response          | 1 (happy path only)               |

### Unit-testable transitions

Every row below must run in jsdom with `FakeTurnstile` and a mocked `fetch`.
No browser automation required.

| Transition                      | Trigger                                                               | Assertion                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| IDLE → REVEALING                | Click Subscribe with non-empty email                                  | Turnstile container appears in DOM. `turnstile.render()` was called. Button shows waiting state.                    |
| REVEALING → SUBMITTING          | `callback(token)` fires                                               | `fetch` was called with `POST /api/subscribe` and body containing `{ email, turnstileToken }`. Timer was cancelled. |
| REVEALING → IDLE                | Inactivity timer fires before any callback                            | Turnstile container removed from DOM. No error message shown. Email input preserved.                                |
| REVEALING → IDLE                | Inactivity timer fires after `expired-callback` but no `callback` yet | Same as above — timer is independent of Turnstile's own expiry cycle.                                               |
| REVEALING → ERROR_TURNSTILE     | `error-callback()` fires                                              | Error message appears. Timer was cancelled. Retry button exists.                                                    |
| REVEALING → ERROR_TIMEOUT       | `timeout-callback()` fires                                            | Timeout message appears. Timer was cancelled.                                                                       |
| REVEALING → ERROR_LOAD          | `window.turnstile` undefined after timeout                            | Fallback message appears. Retry button exists.                                                                      |
| SUBMITTING → SUCCESS            | `fetch` resolves with 201 `{ message }`                               | Success message shown. Email cleared. Turnstile removed. Form returns to IDLE.                                      |
| SUBMITTING → SUCCESS (existing) | `fetch` resolves with 200 `{ message }`                               | Same as above but with "Already subscribed!" message.                                                               |
| SUBMITTING → ERROR_VERIFICATION | `fetch` resolves with 400 `{ error: "Verification failed..." }`       | Error message shown. `turnstile.reset()` called. Widget preserved.                                                  |
| SUBMITTING → ERROR_VALIDATION   | `fetch` resolves with 400 `{ error: "Valid email required" }`         | Error message shown. Email input remains editable.                                                                  |
| SUBMITTING → ERROR_SERVER       | `fetch` resolves with 500                                             | Error message shown. `turnstile.remove()` called. Widget destroyed.                                                 |
| SUBMITTING → ERROR_NETWORK      | `fetch` throws (network error)                                        | Error message shown. Widget preserved (`remove` not called). Retry re-sends same request.                           |
| Token expiry mid-flow           | `expired-callback` fires, then `callback` fires later                 | No visible change on expiry. When `callback` fires, enters SUBMITTING as normal.                                    |
| Timer cancels on callback       | `callback` fires before timer                                         | Timer does not fire. No spurious reset to IDLE.                                                                     |
| Timer cancels on unmount        | Component unmounts while in REVEALING                                 | Timer cleaned up. No stale callback fires.                                                                          |
| Timer cancels on error callback | `error-callback` fires before timer                                   | Timer does not fire. Error state persists.                                                                          |

### Integration test (1–2)

| Test                          | What it covers                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full widget render + callback | Load real Turnstile script in jsdom. Render widget with `FakeTurnstile` replaced by real `window.turnstile`. Assert that `render()` returns a string ID and `callback` fires with a non-empty token. |

### E2E test (1)

| Test            | What it covers                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full round-trip | Navigate to site, scroll to footer, enter email, click Subscribe, complete Turnstile challenge (testing sandbox), verify success message appears. |

### Test infrastructure

The `FakeTurnstile` service (`src/lib/turnstile.ts`) supports all unit tests:

```ts
class FakeTurnstile implements TurnstileService {
  render()    → "fake-widget-N"   // increments counter
  getResponse → "fake-turnstile-token"
  reset()     → noop
  remove()    → noop
}
```

Inject it via Svelte context (`setTurnstileService`). The component uses
`getTurnstileService()` and cannot tell the difference.

Mock `globalThis.fetch` to control what `apiPost` returns. Since `apiPost`
is a plain async function, every SUBMITTING → \* transition can be tested
by resolving the mock with the desired status + body.

---

## Backend contract reference

The Pages Function at `functions/api/subscribe.ts` expects:

```
POST /api/subscribe
Content-Type: application/json
{
  "email": string,         // required, validated server-side
  "turnstileToken": string // required, verified against Cloudflare siteverify
}
```

It returns:

```
201 { "message": "Check your email to confirm." }           // new subscriber
200 { "message": "Already subscribed!" }                     // existing subscriber
400 { "error": "Verification failed. Try again." }           // Turnstile rejected
400 { "error": "Valid email required" }                      // email format
500 { "error": "Something went wrong." }                     // unhandled
```

The backend does **not** distinguish between "token expired", "token already
spent", and "token never existed" — they all return the same 400 error. The
frontend should treat all token-rejection errors the same (ERROR_VERIFICATION).
