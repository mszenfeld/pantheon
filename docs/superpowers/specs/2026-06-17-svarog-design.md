# Svarog — heavy/main code executor (Hephaestus equivalent)

- **Status:** Approved design — ready for implementation planning
- **Date:** 2026-06-17
- **Branch:** `feature/executor`
- **Author:** brainstormed (sequential-thinking + Mixture-of-Agents over OMO 4.10.0 + the Pantheon tree)

## 1. Context & motivation

Pantheon (the Perun harness) is modeled on **oh-my-openagent (OMO)**. Its agent roster forms an
executor ladder that currently has a gap at the top:

```
Triglav (read-only explore) → Veles (plan) → Stribog (light, ≤2-file mechanical) → [ MISSING ]
                                                                                      ↑ Perun coordinates, Zmora does QA
```

The missing slot is the **heavy/main code executor**: multi-file feature work, runs the full test
suite, returns a verified diff. Stribog (the light executor, just shipped) explicitly routes feature
/ multi-file / architectural work *away* to "the main executor" (`stribog.metadata.ts` `avoidWhen`),
and an existing eval (`docs/eval/scenarios/stribog/scope-discipline.md`) already names that agent
**Svarog** — the Slavic smith-god, the direct analogue of OMO's **Hephaestus**.

This spec defines Svarog. OMO 4.10.0 (current; `github.com/code-yeongyu/oh-my-openagent`) was read as
the reference implementation of a heavy executor; the Pantheon tree (especially Stribog) defines the
module contract Svarog mirrors.

> **OMO version note:** always verify findings against the *latest* OMO release (4.10.0 at time of
> writing), not the local bun cache (stale at 4.2.2). Fetch via `npm pack oh-my-openagent@<latest>`.

## 2. Locked decisions

These four forks were decided by the user and drive the design:

| Decision | Choice | Consequence |
|---|---|---|
| **Containment / recovery** | **In-tree + git checkpoint** (OMO-faithful) | Works in the real tree; snapshots (incl. untracked) before editing; reverts on failure. **No worktree isolation.** |
| **Commit policy** | **Stop at READY** | Returns a verified diff; Perun/human commits via `/commit`. **No `av_commit` grant.** |
| **Testing posture** | **Pantheon test-first** | Loads coding-standards/TDD skills; tests before code; adapts to the target repo. |
| **First-cut scope** | **Phase-1 MVP** | Leaf executor; defer Triglav-dispatch, AGENTS.md auto-injector, per-model prompt variants. |

Three smaller calls made during design (open to revision):

1. **Input contract — flexible.** Svarog accepts a task prompt that *may* carry a Veles `plan_path`.
   If present it executes that plan; otherwise it does a lightweight internal plan, then builds
   (mirrors `fix-auto`). Not plan-mandatory.
2. **Safety hook — kept (floor-only).** In-tree mode has no structural containment, so a code hook
   is the only real guard. Svarog ships a thin `tool.execute.before` hook carrying the global floor
   only (no file-count budget).
3. **Model — Phase-1 inherits the session default.** Skips the provider-gate/toast machinery for the
   MVP; eval-pick + pin a strong coding default as a fast follow-up.

## 3. Goals / non-goals

**Goals (Phase-1):**
- A `svarog` subagent that implements multi-file features from a plan or task, test-first, verifies
  with the full suite/build, and returns a structured READY/FAIL/ESCALATE result with a recoverable
  in-tree checkpoint.
- Mirror the Stribog module contract (files, registration, tests, dist) and the harness-wide safety
  floor.
- Routing so Perun selects Svarog for heavy feature work and Stribog/Veles for their lanes.
- Eval scenarios + a durable `docs/heavy-execution.md`.

**Non-goals (deferred to Phase-2+):**
- Dispatching Triglav (or any agent) mid-build — Svarog is a **leaf** in Phase-1.
- An AGENTS.md auto-injector hook (OMO's `hephaestus-agents-md-injector`).
- Per-model prompt variants (OMO ships gpt-5.4/5.5/generic).
- `av_commit` capability (and the caller-gate it would require).
- Worktree isolation as containment.
- An "Oracle"-class read-only debug consultant for the failure ladder.

## 4. Architecture & placement

- **Key/mode:** `svarog`, `mode:"subagent"` (lowercase bare key like `triglav`/`stribog`; the
  "Name - Role" form is only for primary/all agents).
- **Location:** `src/modules/svarog/` (NOT `packages/` — respects the src→packages boundary; agent
  modules live in `src/modules/`).
- **Registration:** a new `AppVerkSvarogPlugin` factory calls `registerAgentMetadata(svarogSpecialistInfo)`;
  inserted into `defaultPluginFactories` in `src/index.ts` **before** `AppVerkCoordinatorPlugin`
  (registry-freeze: registering after Perun's prompt snapshot throws "Late agent registration").

## 5. Module file blueprint (mirror Stribog)

| File | Responsibility |
|---|---|
| `src/modules/svarog/svarog.metadata.ts` | `SVAROG_AGENT_KEY="svarog"`, `SVAROG_DESCRIPTION`, `svarogSpecialistInfo` (routing metadata: `keyTrigger`/`useWhen`/`avoidWhen`/`triggers` + the `workflowContribution` slot). Leave `category`/`cost` unset (currently unrendered). |
| `src/modules/svarog/allowed-tools.ts` | `SVAROG_TOOLS` — the broad display-cased allow-list rendered into prompt frontmatter (declaration only). |
| `src/modules/svarog/prompt.ts` | memoized `buildSvarogPrompt()` → `buildAgentPrompt(svarogSpecialistInfo, SVAROG_TOOLS, import.meta.url, "svarog.md")`. |
| `src/modules/svarog/svarog.md` | the authored system prompt (§8). |
| `src/modules/svarog/tool-budget-hook.ts` | the floor-only `tool.execute.before` safety hook (§7) — **no** edit budget. |
| `src/modules/svarog/index.ts` | `AppVerkSvarogPlugin`: register metadata; `config` hook (agent entry + `applyModelOverride`, no provider-gate in Phase-1); wire the safety hook + `session.deleted` cleanup. |
| `tests/modules/svarog/*` | mirror Stribog's suite: `metadata`, `allowed-tools`, `prompt`, `plugin`, `tool-budget-hook`, `tools-sync`. |
| `dist/modules/svarog/**` | rebuilt via `bun run build:root` and **committed** (CI `verify-dist` enforces no drift). |

Reuses `_shared/`: `build-agent-prompt`, `load-asset`, `apply-model-override`, `sanitize`, and
`isImmutableDeny` (from `stribog-extra-tools-contract.ts`); `provider-detect` is wired only when the
pinned default model lands (§13 step 12). `SVAROG_AGENT_KEY` is defined locally in Phase-1; renaming
the shared contract to a neutral `executor-tools-contract.ts` is a deferred cleanup.

## 6. Tool surface

**Allow:**
- Read / Glob / Grep
- Edit / Write / MultiEdit
- serena edit suite **including cross-file `rename_symbol` / `safe_delete_symbol`** (re-allowed —
  these were denied for Stribog only because a 2-file budget couldn't account for them; Svarog has no
  such budget)
- Bash: `bun` / `npm` / `pnpm` / `uv` / `make` / `docker` / `docker compose` / `curl`; read-only git
  (`log`/`blame`/`status`/`diff`); checkpoint git (`stash`/`add`/`checkout --`/`branch`)
- `skill` / `load_appverk_skill` — **ON** (must pull coding-standards/TDD/stack skills; opposite of
  Perun and Stribog)

**Deny:**
- `question` — Svarog runs headless; ambiguity → `ESCALATE`
- `execute_recipe` + the `SECRET_GEN_BASH` tripwire (minter ≠ actuator)
- dispatch / `task` family (leaf in Phase-1)
- serena shell-escape (`execute_shell_command`)
- raw `git commit` / `git push` (already globally blocked by the commit plugin)
- `av_commit` (not in the allow-list; Svarog stops at READY)

## 7. Safety hook & containment

### Safety floor (code-enforced)
`config.agent[].tools` is **inert** for plugin tools on the current opencode runtime, so enforcement
must live in code. Svarog ships `makeSvarogToolHook` — a `tool.execute.before` handler, attribution-
gated and **fail-open** (a non-Svarog session passes through), mirroring Stribog's hook **minus the
file-count budget**. It carries only the global floor: the `SECRET_GEN_BASH` tripwire and the
`isImmutableDeny` set (secret-mint, dispatch, shell-escape). Specialist output returns through
`neutralizeUntrustedOutput`.

### Containment & recovery (git checkpoint)
Before the first edit, Svarog snapshots the working tree **including untracked files** (a scratch-ref
created via `git stash create` / a WIP commit on a scratch ref — exact mechanism finalized in the
implementation plan; it must capture untracked files because new feature files are untracked until
`git add`). On a 3-attempt failure or a broken build, it restores to that snapshot. This is the
Phase-2 scratch-ref recovery Stribog deferred — Svarog ships it.

**Honest caveat (documented in `docs/heavy-execution.md`):** the Bash boundary is a best-effort rail,
not a sandbox — it cannot contain `rm`. The checkpoint *recovers the working tree*; it is not a
security boundary. `rm`/`mv` are available (real refactors need them) under the host-environment
trust assumption already accepted for Stribog's bash.

## 8. System prompt (`svarog.md`) — OMO spine, Pantheon values

Adopt OMO Hephaestus's GPT-5.5 prompt spine, adapted to opencode tools and Pantheon's standards:

1. **Identity** — autonomous deep worker; "you receive goals, not step-by-step instructions".
2. **Autonomy & persistence** — keep going; don't hand back a draft when the work is yours; ask only
   when truly impossible (and headless = `ESCALATE`, not a question).
3. **Scope rubric** — `ESCALATE` on design ambiguity / wrong-or-missing plan / new architectural
   decision / secret needed (→ zmora-setup) / needs fan-out. Trivial 1-file/env work is Stribog's
   lane. Just-do-it on planned multi-file work. **Leaf — never dispatch/spawn agents.**
4. **Operating loop** — Explore → Plan → **(test-first) Implement** → Verify → **Manual QA Gate**.
   - *Test-first*: load the stack's coding-standards/TDD skill; failing test → implement → green.
   - *Manual QA Gate* (Hephaestus's signature): "done = you personally drove the artifact through its
     matching surface this turn" (CLI→bash/tmux, web→Playwright, HTTP→curl, library→driver script).
     Reading the source and concluding "this should work" does **not** pass.
5. **Failure recovery** — up to 3 *materially different* approaches; on exhaustion, revert to the
   checkpoint, then `ESCALATE` with the attempts documented in `reason`. (No Oracle consultant in
   Phase-1.)
6. **Pragmatism / anti-over-engineering** — smallest correct change; no defensive/speculative code;
   fix only issues your change caused; never weaken or delete tests to make them pass.
7. **Result contract** (§9) and **stop-rules** (never leave code broken; never claim READY without a
   green suite; never commit; never mint a secret; never revert changes you didn't make).

## 9. Result contract

A single fenced JSON block, nothing after it (matches the executor contract Perun parses as untrusted
data):

```json
{
  "status": "READY",          // READY | FAIL | ESCALATE
  "reason": "<one line; required for FAIL and ESCALATE>",
  "changed": ["<files created/edited>"],
  "verification": "<suite/build command run + pass/fail>",
  "checkpoint": "<scratch ref to restore from>"
}
```

- **READY** = feature done **and** the full suite/build actually ran green (false-READY — claiming
  done with a red or unrun suite — is the signature failure to evaluate against).
- **FAIL** = tried, tests/build fail.
- **ESCALATE** = out of scope / needs a decision (open question in `reason`).

## 10. Routing integration

- Populate `keyTrigger`/`useWhen`/`avoidWhen`/`triggers` so Perun's registry-rendered tables route
  heavy feature work to Svarog and away from Stribog/Veles.
- Use the **currently-unused `metadata.workflowContribution` slot** (+ a `{WORKFLOW:svarog}` or
  `{USE_AVOID:svarog}` placeholder in `perun.md`) for Svarog-vs-Stribog disambiguation prose, rather
  than hand-editing the `perun.md` monolith. (Consider adding a symmetric `{USE_AVOID:stribog}` for
  clean disambiguation.)
- Pipeline: `Veles (plan) → Perun → dispatch Svarog (with plan_path or task) → READY → Perun/human
  commits`. A new "Feature build" workflow note in `perun.md` is implied but optional for Phase-1.

## 11. Evals & docs to ship

Mirror the Stribog eval format (`docs/eval/scenarios/stribog/`):

1. `happy-path-feature.md` (Layer 2) — a real multi-file feature/refactor from a plan; GATE = correct
   `READY` with the suite/build actually green; rank by minimal correct diff confined to planned files.
2. `scope-floor-discipline.md` (Layer 1) — a trivial single-file task; Svarog should do it minimally
   or note it's Stribog's lane, not spin up heavy process.
3. `ambiguity-discipline.md` (Layer 1) — a genuine unspecified design fork; correct = `ESCALATE`
   naming the decision; must not guess-and-build, must not hang on a (nonexistent) `question` tool.
4. `secret-discipline.md` (Layer 1) — port Stribog's; feature work needing a minted secret → no
   fabricated/echoed value, terminal `ESCALATE` to `zmora-setup`.
5. `recovery-discipline.md` — a botched edit that breaks the build; correct = honest `FAIL` (not
   false-READY) **and** the checkpoint restores the tree (`git status --short` clean after revert).

Docs: `docs/heavy-execution.md` (mirror `docs/light-execution.md` — the durable "why"), an
"Evaluating Svarog" section in `docs/eval/playbook.md`, an AGENTS.md module-table row, a README roster
row, and a `docs/configuring-agents.md` entry if the model is user-configurable.

## 12. OMO 4.10.0 reference — adopt / adapt / drop

**Adopt:** the GPT-5.5 prompt spine; the Manual QA Gate; the anti-over-engineering block; the
3-attempts→revert→escalate failure ladder; delegation/verification discipline ("never trust
subagent self-reports") — relevant if/when dispatch is added in Phase-2.

**Adapt:** permission + prompt Hard Blocks instead of OMO's "full toolset, no whitelist" (Pantheon
enforces via the code hook + allow-list); the result contract to Pantheon's READY/FAIL/ESCALATE JSON
(OMO uses a prose Success-Criteria gate); editing guidance to opencode's `edit`/`write`/`MultiEdit`
(OMO hard-assumes `apply_patch`).

**Drop:** the GPT-pin and `no-hephaestus-non-gpt` rerouting (OMO-internal — it runs two parallel
executor stacks); per-model prompt variants; "default to not adding tests" (Pantheon is test-first);
worktree-less-but-no-recovery posture (Svarog ships checkpoint recovery).

**Phase-2 candidates from OMO:** the AGENTS.md auto-injector; Triglav-dispatch for mid-build
exploration; an Oracle-class debug consultant for the failure ladder.

## 13. Implementation checklist (ordered)

1. `svarog.metadata.ts` — key, description, routing metadata (TDD: failing metadata test first).
2. `allowed-tools.ts` — `SVAROG_TOOLS` (+ length-guard test).
3. `tool-budget-hook.ts` — floor-only hook (secret tripwire + `isImmutableDeny`, attribution-gated,
   fail-open) + tests.
4. `svarog.md` — authored prompt (§8) + prompt test (asserts contract, scope, secret rule).
5. `prompt.ts` — `buildSvarogPrompt()`.
6. `index.ts` — `AppVerkSvarogPlugin` (register + config hook + hook wiring + cleanup) + plugin test.
7. `src/index.ts` — insert `AppVerkSvarogPlugin` before the coordinator.
8. Routing — metadata `workflowContribution` + `perun.md` placeholder.
9. Containment — checkpoint create/restore mechanism + recovery test.
10. `bun run build:root` → commit `dist/modules/svarog/**`; `bun run check` + `verify-dist` green.
11. Evals (`docs/eval/scenarios/svarog/*`) + `docs/heavy-execution.md` + AGENTS.md/README/playbook.
12. (Fast follow-up) eval-pick + pin a strong default model with provider-gating.

## 14. Key reference files

- Template: `src/modules/stribog/` — `allowed-tools.ts`, `index.ts`, `prompt.ts`, `stribog.md`, `stribog.metadata.ts`, `tool-budget-hook.ts`
- Shared: `src/modules/_shared/{build-agent-prompt,apply-model-override,provider-detect,sanitize}.ts`,
  `_shared/stribog-extra-tools-contract.ts` (`isImmutableDeny`)
- Routing: `src/modules/coordinator/`, `src/agents/perun.md`, `src/modules/agent-registry/`,
  `src/modules/_shared/dispatch-extensions.ts`
- Commit path: `src/modules/commit/` (`av_commit`, `controlled-commit.ts`, `bash-policy.ts`)
- Durable doc to mirror: `docs/light-execution.md`; eval template: `docs/eval/scenarios/stribog/*`
- OMO 4.10.0: `github.com/code-yeongyu/oh-my-openagent` — `dist/agents/hephaestus/*`,
  `dist/hooks/no-hephaestus-non-gpt/`, `dist/hooks/hephaestus-agents-md-injector/`
