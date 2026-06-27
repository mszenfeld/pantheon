# QA Loop Engineering — Doctrine

> Ported from av-marketplace's `loop-engineering` skill. This is the **canonical source** of the scenario-kind / coverage taxonomy that `src/modules/qa-loop/classify.ts` and `qa_loop_ingest` implement (design spec §5). Keep this doc and that code in sync.

## The closed loop

QA on Pantheon is a closed **test → fix → retest** loop (design spec §4), not a one-pass run:

1. **Baseline** (authoritative, once) — run every scenario; record pass/fail + kind + coverage.
2. **Loop** — while failures remain ∧ within budgets: pick still-failing issues ≥ severity, dispatch **Svarog** one issue at a time, re-test the affected sections, evaluate regression-then-progress.
3. **Final** (authoritative, once) — re-run the entire plan. This is the **only** run that may stamp `✅ Fixed`.

## Oracle separation (the load-bearing invariant)

A fix is **never** "Fixed" because the fixer says so. It is Fixed only when an **independent** re-run by the verifier (Zmora) confirms the scenario passes in the authoritative **final** run. The fixer (Svarog) is test-first and may add its own regression tests — that is bonus hardening, **not** the oracle. The QA plan + scenario files are sacred; Svarog must never edit them. Only `qa_loop_finalize`, after the final ingest, writes the `Fixed` marker — one deterministic writer owns it, designing out the marker-erasure / status-race bug class.

## Scenario kinds

Every scenario is classified into exactly **one** kind at plan-parse (so the mutation guard can strip mutating scenarios pre-dispatch):

- **`feature`** — exercises new behavior under test. A green run needs ≥1 `feature`-kind PASS, else the result is `NotVerified` (nothing was truly proven).
- **`sanity`** — baseline / smoke; the app was already meant to do this.
- **`negative`** — asserts something should be **rejected / blocked** (expected non-2xx, no state change).

## Coverage buckets

`qa_loop_ingest` rolls each scenario result into a bucket:

**Exercised** (the scenario actually ran):
- `feature` ← `feature`-kind scenario passed.
- `sanity` ← `sanity`-kind scenario passed.
- `enforcement` ← a **passing `negative`** — the rejection was *enforced*.

**Not verified** (the scenario did not truly run; routed from Zmora's SKIP / `NEED_INFO` reason):
- `auth-unverified` — a feature gated behind auth that was not satisfied.
- `mutation-guard` — a mutating scenario skipped by the mutation guard (§7).
- `tool-unavailable` — a required tool (Playwright / `psql` / …) was absent.

An unrecognized SKIP reason falls back to `tool-unavailable` and is appended to `coverage.routing_warnings[]` for audit. An *unrun* `negative` routes by its skip reason like any other kind — only a *passing* negative becomes `enforcement`.

## The mutation guard

The loop re-runs scenarios (baseline + per-iteration re-test + final), so a mutating scenario's side effects **compound**. By default the loop **strips mutating-expected-success scenarios pre-dispatch** (HTTP `POST`/`PUT`/`PATCH`/`DELETE` or a write/DB-write step expected to succeed) — the mutating call never executes — recording each as `mutation-guard`. A `negative`-kind scenario asserting a mutation is **blocked** is **not** stripped (the write never lands; stripping it would gut enforcement coverage). `--allow-mutations` keeps them in.

## Oracle honesty

A plan whose **entire feature surface** is mutation-guarded (every feature scenario lands in `not_verified`) finalizes **`NotVerified`**, never `Pass`. Green requires something feature-kind to have actually passed.

## Anti-patterns (stop causes are conservative by design)

- **Regression masquerading as progress** — a scenario that passed baseline then fails a re-run stops the loop (regression beats progress; checked first).
- **No-progress churn** — an iteration where nothing newly passes stops the loop.
- **Hardcoding the oracle** — a fix that pastes the test's expected payload literal is flagged (non-blocking `hardcode_warnings`) by the anti-hardcoding diff.
- **Flaky-as-truth** — flakiness is a plan-quality problem; the guard stops rather than oscillates. Retry-on-flaky is a non-goal.
