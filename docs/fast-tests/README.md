# Fast tests: design and findings

## Test design

- **One browser journey.** The [poll spec](../../tests/e2e/polls.test.ts) uses Chromium, real cookies and native dialog behavior, the actual poll handler, and a separate ephemeral D1 database. Drop the response only after a vote commits; switch voters in a second tab; reject the stale retry; verify that Escape restores focus and keeps the draft; require explicit approval before writing the new voter's ballot. No production network or content build.
- **Verify other behavior where it lives.** Node and jsdom own parsing, command policies, mounted UI transitions and request/response contracts. For example, [newsletter recovery](../../tests/components/newsletter-recovery.test.ts) observes a lost `201`, a spent proof returning `400`, a fresh proof returning `200`, and one email. Separate [D1 tests](../../tests/integration/forms.test.ts) prove normalized claims and single-use redemption. This does not certify native email validation or live Turnstile timing.
- **Use D1 where SQL matters.** Keep real constraints, atomic batches, races, historical migrations and SQL clocks. Reuse local runtimes across cases in compatible files, but allocate a fresh, never-reused binding per case. Drain background work before releasing it. Prepare unchanged migration batches inside workerd. Run [capacity](../../tests/capacity/capacity.test.ts) separately in CI: it seeds 24,000 ballots locally to check storage and queries, not 24,000 HTTP requests.
- **Run independent lanes against the commit.** [Pre-commit](../../.githooks/pre-commit) finishes staged lint and image checks, then exports the index and runs Node/jsdom, D1 and Chromium in parallel. Unstaged files and generated content cannot make that snapshot pass. Use `pnpm test:local` for the same lanes against the working tree. [CI](../../.github/workflows/check.yml) also runs capacity and builds and checks the artifact once; the hook does neither.

## Findings

| Measurement                                                    |                          Result |
| -------------------------------------------------------------- | ------------------------------: |
| Old application suite, sequential, 640 cases                   |                       100.096 s |
| Old poll browser command with content build                    |                        78.390 s |
| Same ten old browser cases without content build, clean source |                        14.117 s |
| Current hook, TypeScript edit, 30 passes                       |   16.728 s median, 17.640 s p95 |
| Current hook, mixed staged edits, 30 passes                    |   16.904 s median, 18.836 s p95 |
| Current hook, four-core affinity pilot                         |                        44.793 s |
| Current hook, one memory sample                                | 3.78 GiB peak PSS, 17.22 s wall |

The 30-run samples used Linux, Node 24.20.0, pnpm 11.7.0 and 15 available logical CPUs, with 631 local cases per run. The previous hook took about 1.6–1.7 s and did not run tests. The test suite passed on Node 22, including coverage thresholds, capacity and artifact smoke. Independent fault checks caught wrong-cookie retry, regenerated request IDs, nonmodal dialogs, missing focus restoration, duplicate claims and stale concurrent writes. Cancellation after the first accepted ballot closed the loopback listener and cleaned up the observed browser/runtime processes.

### Experiments not adopted

- **Clone a migrated D1 template:** all 32 cases passed on every run; the clones matched fresh replay across 66 schema entries and 20 tables and stayed isolated under simultaneous writes. Warm median fell from **6.158 to 5.542 s**; peak PSS fell from **932.4 to 912.3 MiB**, with overlapping ranges. Building the template and mapping binding files added **1.130 s**, so the tested cohort would lose about 0.51 s including startup. Miniflare shutdown left **571 KiB in WAL**; a safe physical copy required offline checkpointing and an internal storage layout. Keep replay. Separately, the pinned compatibility converter ignored `d1Persist`; the optional capacity file inspection still merits checking.
- **Serialize the lanes:** isolated D1 with file parallelism disabled used **0.74 GiB** but took **87 s**. The isolated fast and browser lanes peaked at **1.00 and 1.29 GiB**. Lowering nominal worker caps alone kept the parallel hook near **3.7–3.8 GiB**. Before accepting a slower hook, profile Node/Vitest startup imports and measure staggering the short lanes while D1 runs.
