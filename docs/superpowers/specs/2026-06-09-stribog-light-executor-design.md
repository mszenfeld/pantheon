# Stribog — Light Executor Agent — Design

**Date:** 2026-06-09
**Status:** Reviewed twice by adversarial mixture-of-agents (v1 → NEEDS_REWORK;
v2 → READY_WITH_FIXES with prior blockers code-verified resolved). This v3 folds
in the re-review fixes. Ready for implementation plan.

## Problem / Motivation

Pantheon has **no real actuator** — no agent that can cause side effects in the
environment (start a service, run a build, apply a small fix and see the
result).

- `zmora-setup` looks like a provisioner but is not: its toolset is
  `Read/Glob/Grep/execute_recipe` with **no Bash** (`src/modules/qa/allowed-tools.ts`).
  The `execute_recipe` tool runs through a hard-capped sandbox (10-command
  allowlist, single statement, egress-pinned, child-env stripped of host env,
  run-bash 30 s / 1 MiB) and **returns only a status enum** — the produced value
  writes to `BindingsStore` and never reaches the LLM
  (`src/modules/qa/execute-recipe.ts`; tool registration at
  `src/modules/qa/index.ts:272-298` returns JSON status only). So `zmora-setup`
  **mints a binding, not an environment.**
- `docker`/`make`/`build` are available to no agent: they are absent from every
  agent's `allowed-tools` allowlist (Perun's only Bash grants are
  `Bash(mkdir:*), Bash(ls:*)`, `src/agents/perun.md:5`), enforced by the
  OpenCode runtime. A **Zmora FE/BE scenario task** signals a dead environment as
  `NEED_INFO kind=service`. Net effect: **nothing in the harness can
  `docker compose up` / `make` / start a service.**

More broadly, the harness has a coordinator that never executes (Perun), a
read-only explorer (Triglav), a planner (Veles), and test-only QA specialists
(Zmora). There is **no agent for the simple operational/execution work** these
agents cannot do themselves — bringing a downed environment up, a quick restart,
reading logs, a one-line config change.

We want a **light executor**: Perun delegates *simple* tasks to it. QA
environment setup is the first use case, but it is **not QA-only** — e.g. adding
a field to a Pydantic `Settings` class is a fine task for it. Complex feature
development and larger changes are reserved for a **future heavy "main
executor"** (separate design), not this agent.

## Prior art (OMO) — from MoA research, code-verified

`oh-my-openagent` (OMO) is Pantheon's primary prior art (installed package at
`~/.bun/install/cache/oh-my-openagent@4.2.2@@@1`, compiled `dist/` + README).

- **OMO layers its doers; it does not use one general worker.** *Sisyphus*
  (heavy generalist, `primary`), *Hephaestus* (deep code worker, `primary`,
  GPT-locked), and **Sisyphus-Junior** — the **leaf executor**: `subagent`,
  cheaper tier (sonnet, temp 0.1), tiny Role/Verify/Stop prompt, `task` blocked
  (cannot fan out), terminates after one verification. Stribog is the Slavic
  analog of Sisyphus-Junior; **Svarog** (the Slavic smith) is reserved for the
  future heavy main executor.
- **Execution surfaces:** `Bash` (one-shot / background) and `interactive_bash`
  (tmux-only). **No OS sandbox** — safety is layered (per-model permission deny
  maps, tmux bans, git-worktree isolation, model selection).
- **OMO's non-interactive env is git-scoped guidance, not an every-Bash
  injection, and OMO ships no command allowlist** — the equivalents below are
  **net-new infrastructure for our harness**, not inherited plumbing.
- **OMO has no value-hiding secret-minting mechanism and does not separate
  "minting" from "actuation."** The only secret-handling in its `dist` is OAuth
  `client_secret` plumbing plus an env-var sensitivity regex / MCP-error
  redaction; there is no value-hiding binding minter, and its leaf executor runs
  Bash with the operator's environment. **The minter≠actuator separation is a
  Pantheon-specific QA invariant** (`zmora-setup`), not an OMO pattern —
  load-bearing for the decision below.
- **OMO already ships the target QA pattern:** the `review-work` "QA via App
  Execution" agent detects a `RUN_COMMAND` from
  `package.json`/`Makefile`/`docker-compose`, and treats **build failure as an
  immediate FAIL.**

## Scope & relationship to existing agents

Stribog is a **pure actuator**; `zmora-setup` remains the **value-hiding
minter**, unchanged. They split on one axis — **"do an action" vs "produce a
value"** — kept unambiguous three ways:

1. **Different trigger signals, not free choice.** `zmora-setup` is driven by a
   QA plan's explicit `SETUP-NN` binding-input steps; Stribog by a
   `NEED_INFO kind=service` liveness signal or an explicit ops delegation.
2. **Mutually-exclusive `useWhen`/`avoidWhen`** in each agent's metadata.
3. **Allowlists backstop misroutes:** `zmora-setup` has no `Bash` (cannot
   actuate); Stribog has no `execute_recipe` (cannot value-hide-mint). A wrong
   dispatch **fails cleanly instead of doing the wrong thing** — the security
   boundary doubles as the routing safety net.

## Decisions

| # | Decision | Notes |
|---|----------|-------|
| 1 | **Dedicated, narrow leaf executor** (own module + `SpecialistInfo`). | Validated by adversarial review. Deciding factor: evolution asymmetry — allowlist is the boundary, so narrow→general is safe additive widening; general→narrow is an irreversible clawback. |
| 2 | **Keep `zmora-setup` separate — Stribog does NOT absorb it.** Stribog has **no `execute_recipe`, no binding minting, no binding env-injection.** | Re-review verified the secret-leak hole is closed *by construction*: the QA binding-injection hook only writes env for agents whose key starts with `zmora-` (`src/modules/qa/shell-env-hook.ts:32`), so a `stribog`-keyed agent can never receive a minted secret. Absorption may be revisited later only with a designed crossover defense. |
| 3 | **One undivided agent — no internal variants** (no `-code` variant). | Validated. Sound while the heavy executor (Svarog) stays a committed future deliverable. |
| 4 | **Tools:** `Read/Glob/Grep` + `Bash` + `Edit`/`Write`. Boundary = **complexity**. | The **grant** of `Edit`/`Write` is allowlist-level; only its **scope** (which files / how complex) is prompt-level + post-hoc signal. Path-scoped `Edit`/`Write` is **not expressible** in the harness permission schema (edit is a flat ask/allow/deny enum), so prompt + observability + the scratch-ref net (below) is the available mechanism. |
| 5 | **Operates in the real working tree** — edits persistent, QA tests actual state. | Validated; concurrency / orphan / recovery implications specified below. |
| 6 | **Hub-and-spoke: only Perun dispatches.** Stribog never fans out. | Validated, and **load-bearing for correctness**: the service-address handoff and the "once-per-run bring-up" rule both depend on Perun owning dispatch. |
| 7 | **Model: Sonnet-class default** (`claude-sonnet-4-6`), **overridable** via `agents.stribog.model` (the same config path `triglav`/`zmora` use). Cost `CHEAP`. | A model-tier hint and config default, **not a security pin**; `CHEAP` must not be surfaced as a routing preference. |
| 8 | **Name: Stribog.** | — |

## "Simple enough for Stribog" rubric

Lives in **Perun's routing** and **Stribog's self-gate**. A task is for Stribog
when **all** hold:

1. Touches a **narrow, known set of files** (order of 1–2), not a sprawling
   refactor.
2. Is **local and mechanical** — add a field/entry, change a value,
   start/restart a service, read logs — with **no new abstractions, modules, or
   architectural decisions**.
3. Has **deterministic, fast verification** (build/lint passes, service
   responds).
4. **Self-gate / escalation:** if it turns out non-trivial mid-task, Stribog
   **stops and returns an `ESCALATE` result**, reporting **any partial edit
   already written to the real tree**. Until Svarog exists, `ESCALATE` = stop
   and return to Perun (no agent-to-agent handoff), who surfaces it to the human.

## Agent specification

- **Name:** Stribog · bare agent key `stribog` · **Mode:** `subagent` ·
  **Cost:** `CHEAP` · **Model:** `claude-sonnet-4-6` default, overridable.
- **Metadata:** a `SpecialistInfo` with mutually-exclusive routing —
  *useWhen:* bring up / fix a downed environment for QA; small mechanical change
  (config field, value); light debugging (logs, restart, diagnosis).
  *avoidWhen:* producing a secret/credential value (→ `zmora-setup`); feature
  development, multi-file or architectural change, complex code (→ main
  executor).
- **Tools (allowlist):** `Read`, `Glob`, `Grep`, `Bash`, `Edit`, `Write`. **No**
  dispatch/fan-out tools; **no** `execute_recipe`; **no** `interactive_bash`
  (see below).

### Result contract (Stribog → Perun)

Stribog returns a **structured JSON result with a `status` enum**, matching how
Perun already parses child results (it keys on an inner `status`, e.g.
`NEED_INFO`, per `src/agents/perun.md:190-191`) — **not** free prose:

```json
{
  "status": "READY",
  "reason": "<one line; required for FAIL and ESCALATE>",
  "baseUrl": "<scheme://host:port; only on READY when you brought a service up>",
  "started": ["<service or process you started and left running>"]
}
```

Perun reads `baseUrl` and threads it into the next Zmora dispatch's
`Base URL: <base-url>` prompt line (the existing channel,
`src/agents/perun.md:163,169,407`). The address is **intentionally
non-persistent** — it lives in Perun's turn context and is re-derived on resume
by re-probing / re-dispatching; it is **never** written to `BindingsStore`
(which stays secrets-only, preserving the minter≠actuator separation).

## Execution surface, liveness & long-running services (v1)

`interactive_bash` is an **OMO-only tmux subsystem absent from our `src/`**
(0 occurrences). v1 does **not** port it. Long-running services start **detached
via plain `Bash`** (`docker compose up -d`, or `<run-command> &`).

**Liveness contract (false-READY guard).** A detached process can exit non-zero
*after* backgrounding while the `Bash` call already returned 0, so liveness is
**not** "the start command succeeded". Stribog must run a **bounded poll loop**
(N attempts, fixed interval, hard timeout) `curl`-probing the reported
`baseUrl`; for `<cmd> &` it captures the background PID and verifies it is still
alive. A non-2xx / connection-refused after the budget, or a dead PID, is a
**`FAIL` with a distinct reason** (build failure is likewise an immediate FAIL).
Porting `interactive_bash`/tmux is future work, needed only for non-daemonizing
processes that require an attached terminal.

## Concurrency, idempotency & orphaned services

- **Idempotency:** Stribog **probes liveness first**; if the service is already
  up, it reuses it and returns `READY` (no double-start).
- **Concurrency (enforcement + accepted risk):** "bring-up once per run before
  scenarios, no concurrent same-target bring-up" is a **Perun routing rule**
  (Perun owns dispatch; decision #6). It is **not** enforced at the dispatch
  layer — the coordinator worker pool (`DISPATCH_CONCURRENCY=4`) does not
  serialize actuator work — so **v1 explicitly accepts the risk** that a
  mis-routed concurrent same-target bring-up is undetected at dispatch time. A
  **host-port collision is detected by the liveness probe** (connection refused
  / a non-matching service answering the port after bring-up) and surfaces as a
  **distinct `FAIL` reason**, not a generic FAIL.
- **Orphans:** v1 has **no managed teardown**. Detached services **persist
  beyond the run** and are the human's to stop; Stribog reports what it started
  in `result.started`. (The QA TTL sweeps bindings only, not OS processes;
  OMO's process-cleanup subsystem is not ported in v1.) Best-effort stop on
  run-end is a future option.

## Workspace, trust model & safeguards

Stribog runs in the **real working tree**; edits are persistent and
**git-visible**.

- **Trust assumption (stated plainly):** Stribog's `Bash` runs **repo-controlled
  code** (`make` / `npm run` / `docker compose` / `uv`) with the **operator's
  full host env and credentials** — the same posture as any real coding agent,
  OMO included. `buildChildEnv` host-env stripping protects only the
  `execute_recipe` child (which Stribog does not have), not normal `Bash`. This
  is the accepted trust boundary for a real actuator with no OS sandbox.
- **The `Bash` command allowlist is defense-in-depth, NOT a security boundary**
  (token-matching cannot inspect flag values; cf. `AGENTS.md`). Starting set:
  `docker`/`docker compose`, `make`, package managers
  (`npm`/`pnpm`/`bun`/`uv`), `curl`, and **read-only `git`**
  (`git --no-pager log`/`blame`/`status`/`diff`). `rm` is excluded (recovery is
  the scratch-ref net below, not `git revert`).
- **Edit recovery is the scratch-ref net, NOT program-name bans.** Program-name
  matching cannot stop `git reset --hard` / `git checkout -- .` / `git clean`
  from erasing the uncommitted diff. Therefore **Perun snapshots a scratch ref
  before each Stribog run** (a committed v1 component, below) so tracked-file
  edits are revertable. This covers **edits only** — it does **not** undo side
  effects an actuator exists to cause (started services, untracked artifacts);
  those are the orphan policy's domain. The two safety dimensions
  (diff-revert vs side-effect-cleanup) are kept distinct.
- **Forced non-interactive env is NET-NEW infrastructure to build** (its own
  task + test): inject `CI=true`, `GIT_TERMINAL_PROMPT=0`, `PAGER=cat`,
  `DEBIAN_FRONTEND=noninteractive`, `npm_config_yes=true` on Stribog's `Bash`.
  It is a **hang-prevention / UX safeguard, not a security boundary**. **No other
  bash `tool.execute.before` hook fires for a Stribog session** (the
  coordinator-policy gate is coordinator-only; verified `isCoordinatorSession`),
  so this hook stands alone — no compose-ordering problem.
- **Complexity guard = post-hoc observability signal, NOT a control.** It
  surfaces "should have escalated" *after* edits — an advisory marker in the
  result when the change edits **more than 2 distinct files** (aligned with the
  rubric's 1–2; config-overridable). It does not prevent the edit.
- **No minted QA binding is co-resident with the actuator** (Stribog has no
  `execute_recipe` and is excluded from the `zmora-`gated binding env-injection).
  Residual secret exposure is the **same filesystem / host-env surface any
  operator-privileged coding agent has** (reading `.env`, `~/.aws`, etc.), owned
  by the trust assumption above — not a value-hiding regression.

## Module structure & registration

- New module `src/modules/stribog/`, **skeleton cloned from Triglav**
  (`src/modules/explore/`): `allowed-tools.ts` (deny-by-default), prompt,
  `SpecialistInfo`, registration as `mode:subagent`, bare key `stribog`. The
  clone is for *plumbing*, not behavior.
- Lives in `src/` (packages cannot import `src/`). Surfaced to Perun's
  `SPECIALISTS_TABLE` via the `registerAgentMetadata` bridge.
- `validateDispatchable` already accepts any subagent
  (`src/modules/coordinator/dispatch.ts`) — no dispatch-core change.
- **`zmora-setup` is unchanged** — not retired. No change to the QA module's
  `VARIANTS` / `SETUP_TOOLS` / `execute_recipe` gate / `BindingsStore` /
  `shell.env` binding-injection hook (the QA-only mechanism that injects minted
  values into a `zmora-` session's shell env — Stribog does **not** use it), and
  `zmora-fe`/`zmora-be` are untouched.
- **Net-new components to build (each with its own task + tests):**
  (a) the forced-non-interactive-env hook for Stribog's `Bash`;
  (b) the `Bash` command-classification allowlist;
  (c) **the Perun pre-Stribog scratch-ref snapshot** (commit v1 — the edit
  recovery net);
  (d) **a Perun routing rule:** on `NEED_INFO kind=service` (or explicit ops
  delegation), dispatch Stribog before re-asking the human; on a `READY` result,
  re-dispatch the blocked Zmora wave threading the reported `baseUrl`.

## Policy: `docker`/`make`/`build` access

Blocked for Perun (and every other agent) by **each agent's own `allowed-tools`
allowlist** enforced by the OpenCode runtime (Perun's only Bash grants are
`Bash(mkdir:*), Bash(ls:*)`, `src/agents/perun.md:5`); the coordinator-policy
gate is coordinator-only defense-in-depth. **There is no shared chokepoint to
"carve an exception" from** — Stribog simply **declares
`docker`/`make`/package-managers in its OWN `allowed-tools`.** No change to
Perun's allowlist or the coordinator gate is needed.

## Testing (TDD)

- **Tool-allowlist drift test** for Stribog, modeled on
  `tests/modules/explore/allowed-tools.test.ts`.
- **Isolation:** Stribog exposes exactly its allowlist; no dispatch tools, no
  `execute_recipe`.
- **Secret-gate invariant:** the `shell.env` hook returns **no bindings** for a
  session keyed `stribog` (direct unit test of the `zmora-` prefix gate against a
  non-zmora agent name) — locks the separation against future prefix-logic drift.
- **Regression (independent assertions):** Perun stays `docker`/`make`/`build`
  banned; the coordinator bash gate does **not** fire for a Stribog session.
- **Flow:** `kind=service` → Perun dispatches Stribog → `READY` + `baseUrl`
  threaded into the Zmora wave; `won't-start` / **crash-after-background** →
  `FAIL` (the liveness poll budget catches the false-READY case).
- **Net-new infra:** the non-interactive-env hook injects the expected keys for
  Stribog's `Bash`; the command-allowlist classifies actuating vs banned verbs;
  the scratch-ref snapshot is created before a Stribog run and reverts a
  tracked-file edit.
- **Complexity guard:** advisory marker fires when > 2 distinct files are edited.

## Out of scope / future

- **Value-hiding secret minting** — stays in `zmora-setup`.
- **`interactive_bash` / tmux porting** — Bash backgrounding suffices for v1.
- **Managed environment lifecycle / teardown & orphan reaping** (best-effort
  stop on run-end is a future option).
- **The heavy "main executor" (Svarog)** — features, large/complex code; Stribog
  *escalates* to it (until it exists, escalate = stop & return to Perun).
- **Absorbing `zmora-setup`** — revisit only with a designed crossover defense.
- **No `-code` variant of Stribog.**

## Accepted risks / compromises

- **`Edit`/`Write` scope is prompt-level + post-hoc signal** (path-scoping is
  unsupported by the harness schema); the *grant* is allowlist-level. Edit
  recovery net = git-visibility + the Perun scratch-ref snapshot (tracked-file
  edits only).
- **The `Bash` actuator runs repo-controlled code with operator
  privileges/env** — accepted trust assumption (OMO-equivalent); residual secret
  exposure is the operator's filesystem/host-env surface; the command allowlist
  is defense-in-depth only.
- **Concurrency:** "once per run, no concurrent same-target bring-up" is a Perun
  routing rule, **not** dispatch-layer-enforced; v1 accepts that a mis-routed
  concurrent bring-up is undetected at dispatch time (a port collision still
  surfaces via the liveness probe).
- **Real-tree, no worktree isolation;** started services persist (no v1
  teardown).
- **First real OS-level actuator in the harness; no OS sandbox** — safety is
  layered, not sandboxed.

## Validated by adversarial review (do not re-litigate)

The minter≠actuator separation (decision #2) was traced to its only injection
writer and confirmed closed by construction. Decisions **#1** (narrow, not
general), **#3** (one undivided agent), and **#6** (hub-and-spoke) survived the
decision-adversary lens. **#3**'s "no `-code` variant" holds while Svarog
remains a committed future deliverable.

## Naming rationale

- **Stribog** — Slavic god of wind/air; the winds ("Stribog's grandsons") spread
  and carry out tasks. Light, swift, dispatched everywhere → the light leaf
  executor.
- **Svarog** — Slavic smith/forge god (analog of OMO's Hephaestus) → reserved for
  the future heavy main executor.

## Changelog

- **v3 (2026-06-09)** — re-review (READY_WITH_FIXES) fixes: defined the
  structured Stribog→Perun **result contract** (`status` enum + `baseUrl`,
  parsed like `NEED_INFO`; address non-persistent, never in `BindingsStore`);
  added the **liveness false-READY guard** (bounded poll + PID check); resolved
  the **git allowlist contradiction** (read-only git; `rm` excluded; recovery via
  scratch-ref, not `git revert`); **committed the scratch-ref snapshot as a v1
  component** (single consistent status) and scoped it to tracked-file edits;
  added the **Perun auto-dispatch routing rule** and the concurrency
  enforcement/accepted-risk framing; pinned the **complexity threshold (> 2
  files)**; reworded the secret claim (residual filesystem surface); corrected
  the OMO secret-count framing and the `perun.md:5` Bash-grant phrasing; added a
  secret-gate-invariant TDD assertion.
- **v2 (2026-06-09)** — resolved the v1 `NEEDS_REWORK`: keep `zmora-setup`
  separate (Stribog = pure actuator); descope `interactive_bash`; defined the
  service-address handoff; added concurrency/orphan policy; reframed the
  `docker`/`make`/`build` ban as an allowlist fact; relabeled the complexity
  guard as a post-hoc signal; marked non-interactive-env + command-allowlist as
  net-new; pinned a default (overridable) model; fixed citations.
