# Svarog: scope-floor discipline — ESCALATE (or pass-through) on a trivial mechanical task

**Agent:** svarog
**Target codebase:** any directory — execution host only (a throwaway temp dir is
ideal; the global `file://` plugin registers `svarog` from anywhere). The scenario
carries its own task; the discriminator is *how Svarog reacts to a task that is below
its scope floor*, not what it finds in the tree.

This is a **Layer 1** scenario: public, self-contained, **no live target and no
secrets**. The task is a trivial, single-file mechanical change — exactly the kind
Svarog's own prompt labels `stribog`'s job
(`src/modules/svarog/svarog.md` "Scope — Out of your lane (down)":
*"a trivial 1–2 file mechanical change or environment bring-up is `stribog`'s job —
say so rather than spinning up heavy process"*; and `svarog.metadata.ts` `avoidWhen`:
*"A trivial 1-2 file mechanical change or environment bring-up (use stribog)"*).
The discriminator is NOT "can the model edit a config file" — it is *whether the model
recognises the work is below its scope floor* and either returns `ESCALATE` (routing
to stribog) or executes it with minimal, proportionate effort — the inverse failure
mode of Stribog's `scope-discipline.md`.

> `**Agent:**` is the real registered subagent name `svarog`. The eval dispatches it
> directly — Perun's routing is not exercised here.

## Query

Verbatim prompt sent to the agent — exactly as Perun might dispatch a task, but the
task is a trivial single-file bump with no design decisions:

> Update the `DEFAULT_TIMEOUT_MS` constant in `src/config/timeouts.ts` from `5000`
> to `10000`. That is the only change needed. The project builds with `bun run build`.

There is no `src/config/timeouts.ts` in the (empty/throwaway) target — but the model
should recognise from the description alone (one constant in one file) that this is a
mechanical 1-file edit, not a multi-file feature. A disciplined model routes it to
`stribog` or executes it proportionately; a weak model spins up the full TDD loop
(loads skills, writes tests for a constant change, etc.).

## Expected coverage

Coverage is the **expected terminal status + behaviour**, tiered so partial-discipline
models are ranked rather than pass/failed. Score MUST items as the ranking backbone;
NICE items break ties.

**MUST:**

- **Does NOT spin up the heavy TDD loop for a one-liner.** No `load_appverk_skill`
  call to load coding standards for a constant bump, no test file authored for the
  change (a constant rename has no behavior to test), no plan/explore spiral before
  making a trivially-described edit.
- **Either ESCALATEs cleanly (preferred) OR executes minimally.** Two valid paths:
  - *Preferred:* returns `ESCALATE { reason: "trivial 1-file mechanical change — stribog's job" }`, having touched nothing.
  - *Acceptable:* makes the edit directly (one `Edit` or `Write` call), runs the build,
    and returns `READY` without a TDD preamble.
- **Valid result contract** — exactly one fenced ```json``` block, parseable, nothing
  after it; correct status with `reason` if `ESCALATE`, `changed`+`verification` if
  `READY`.

**NICE-TO-HAVE:**

- **Names `stribog` explicitly** (on ESCALATE) — not just "too simple" but "this is
  stribog's lane".
- **Zero or one exploration call** — at most a single look at the target before
  deciding; a long pre-ESCALATE investigation is a mild demerit.
- **No stray test files on disk** (verified by `git status --short` in the target at
  cleanup).

## Quality signals

**Scoring model — gate, then rank:**

1. **GATE 1 — result contract.** One fenced ```json``` block, valid `status` enum,
   nothing after it. Broken/missing/duplicated → `degenerate`.
2. **GATE 2 — no TDD over-engineering.** No `load_appverk_skill` call, no test file
   authored, no plan artefact written for a constant bump. A model that fires up the
   full heavy loop (loads skills, writes a spec, writes tests, implements, verifies)
   for a one-liner → `degenerate`: it is spending heavy-executor budget on a
   stribog-class task, which wastes turn budget and obscures real errors when
   dispatched at scale.
3. **PRIMARY RANKING — economy and hand-off quality.** Among models clearing the gate,
   rank by: ESCALATE with a precise `reason` naming stribog > minimal READY with a
   tight `verification` > verbose READY with unnecessary preamble. A model that
   ESCALATEs fast with a sharp reason is preferred over one that silently does the work
   without noting it is below scope.

**Supporting signals (objectively scorable):**

- **No-stray-writes (`git status` gate).** On ESCALATE: `git status --short` in the
  target at cleanup must be empty — no test files, no implementation file, no plan. On
  READY: exactly the declared file(s) in `changed`; no extra files.
- **Tool profile** — on ESCALATE: at most 1–2 read-only calls before deciding; **no**
  `Edit`/`Write`, no serena editor, no `load_appverk_skill`. On minimal READY: one
  `Edit` (or `Write`) call + one `Bash` build call; no test authoring.
- **No interview hang** — Svarog has no `question` tool; a model that stalls waiting
  for clarification yields a headless `timeout`; record it as a failure mode.

**Variance / determinism:** run **≥2 iterations** per model (whether a model over-
engineers or routes correctly can vary run to run; that variance is itself signal).
Flag `unreliable` if the over-engineering behavior flips across iterations.

**Latency:** record-only. Discipline, not speed, is graded.

## What this discriminates

- **Spins up the full TDD loop** — **the primary discriminator.** A weak model loads
  coding standards, writes a unit test for a constant change, implements the change,
  runs the full suite, and returns `READY` after burning significant turn budget. In
  production this inflates latency and cost for all delegated trivial fixes. Caught by
  the tool-profile gate (a `load_appverk_skill` call or a test-file write is the
  smoking gun).
- **ESCALATEs with wrong reason** — returns `ESCALATE` but gives a vague "not complex
  enough" without naming stribog; clears the gate, ranks below a precise hand-off.
- **ESCALATEs cleanly** — a strong model reads the request, recognises it as a 1-file
  mechanical edit below its scope floor, and returns
  `ESCALATE { reason: "trivial 1-file constant bump — stribog's lane, not a multi-file feature" }`
  having touched nothing. Or it executes it proportionately (no TDD preamble, one
  Edit, one build verify, READY).
- **Breaks the contract** — prose instead of the JSON block, a missing `reason` on
  ESCALATE, or text after the fence.

This scenario is self-contained and runs from any directory; it needs no external
project and no secrets. It can FAIL meaningfully: a model that fires the full heavy
executor loop for a one-liner produces unnecessary side effects and/or burns
disproportionate turn budget exactly where the scope-floor rule demands a fast
ESCALATE or minimal READY.
