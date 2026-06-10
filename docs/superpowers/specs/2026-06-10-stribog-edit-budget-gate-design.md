# Stribog Tool-Enforcement & Edit-Budget Gate — Design (v2)

**Date:** 2026-06-10
**Status:** Approved direction (brainstormed + MoA-verified with live `opencode serve` probes)
**Branch:** `feature/stribog-executor` (extends Phase 1; lands before Phase 2)
**v2 note:** Scope expanded after a sequential-thinking + mixture-of-agents review empirically
disproved a Phase-1 assumption (see Empirical findings). v1 enforced only an edit-budget
on top of an allow-list believed to be a runtime boundary; the allow-list is NOT
enforced, so v2 adds the actual tool-name enforcement that makes the boundary real.

## Problem

Two problems, one root cause (the prompt-frontmatter `allowed-tools:` line is cosmetic):

1. **CRITICAL — Stribog's allow-list is not enforced at runtime.** `src/modules/stribog/
   allowed-tools.ts:1-3` asserts "OpenCode's allow-list is deny-by-default … anything not
   listed is not callable." This is false. opencode is **default-allow**; the real gate is
   a per-agent `tools: { name: false }` map in the agent config, which Stribog does not set
   (`src/modules/stribog/index.ts:13-25` returns `{ description, mode, prompt }` only). The
   `allowed-tools:` string lives only inside the prompt text (`prompt.ts:14`). Consequence
   (empirically proven, below): a live `stribog` session can call `execute_recipe` (mint
   secrets — breaks **minter ≠ actuator**), `task` (fan out — breaks **leaf**), `todowrite`,
   `webfetch`, etc. The Phase-1 "structural" invariants are currently advisory prose.

2. **Scope file-count is weak on small models.** The eval (2026-06-09 + re-run after
   `4f71cce`) showed the prompt-level "1–2 files" rubric does not hold: models scaffold
   whole modules (`deepseek-v4-flash` ~48 tool calls → timeout; `qwen3.6-plus` built
   `src/modules/svarog/`), or emit a design proposal instead of `ESCALATE`.

The chosen success criterion (user) is **side effects, enforced structurally**: on any
model, a Stribog session must (a) be unable to call tools outside its allow-list — closing
the secret/leaf breach — and (b) modify at most 2 distinct files. Exploration latency is
accepted as a model-quality concern measured by the eval, not guaranteed by the harness.

## Empirical findings (live opencode 1.15.10, MoA challenger probes)

All verified against a live `opencode serve` on a disposable worktree, and the installed
binary / `@opencode-ai/plugin@1.15.11` types:

- **Allow-list inert (proven behaviorally).** In a live `stribog` session: `todowrite`,
  `task`, and `execute_recipe` all executed to `status: completed`. `GET /agent` shows
  `tools: null` for `stribog`. → enforcement absent.
- **`apply_patch` is provider-gated, NOT a hole.** `GET /experimental/tool?provider=
  anthropic&model=claude-sonnet-4-6` omits it; live probes on `deepseek-v4-flash` and
  `gpt-5.4-mini-fast` returned tool-unavailable. (v1's `apply_patch` worry was a false
  specific.) The real exposed extras are `task`, `execute_recipe`, `todowrite`,
  `webfetch`, `websearch`.
- **`tool.execute.before` input is `{ tool, sessionID, callID }` + `{ args }`** — **no**
  `agent` field, **no** `cwd` (`@opencode-ai/plugin/dist/index.d.ts:235-241`). Tool names
  are **lowercase** runtime ids (`edit`, `write`, `bash`, …), not the allow-list's
  `Edit`/`Write` casing (`/experimental/tool/ids`; commit/coordinator-policy gates match
  lowercase).
- **Throw-to-deny works and the turn CONTINUES (proven).** A `throw` from
  `tool.execute.before` becomes a tool-error part the model reads; the turn does not abort.
  Live: a blocked `git commit` produced `TOOL bash status=error … "Direct git commit is
  blocked"` then the model emitted "CONTINUED". The coaching-message design is sound.
- **The marker lands in the tool part's `state.error`, with `info.error` empty and the turn
  `completed`** — NOT in the assistant message's `info.error` (which is set only when the
  turn dies). Counting markers via `last.info.error` misses the cooperative case.
- **Attribution: `getSessionAgentCached(sessionID, client)` works for direct dispatch.**
  `SessionAgentRegistry` has a single writer (`dispatch.ts:422`, foreground
  `dispatch_parallel`) → empty for eval/direct sessions → registry-keyed hook is inert in
  evals. The first user message's `info.agent` IS `"stribog"` for direct dispatch (proven),
  and `packages/skill-utils/src/session-identity.ts:14-23` reads exactly that.

## Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Tool-name enforcement — native | Set `config.agent.stribog.tools` to an explicit deny-map for every non-allow-listed structured tool (`task`, `execute_recipe`, `todowrite`, `webfetch`, `websearch`, and any other not in the allow-list). opencode is default-allow, so denies must be explicit. |
| 2 | Tool-name enforcement — hook (defense-in-depth + proven) | The stribog `tool.execute.before` hook also **denies any tool whose lowercase id is not in the allowed set** `{read, glob, grep, edit, write, bash}` (marker `STRIBOG_TOOL_DENIED`). This is the empirically-proven mechanism and covers us if `config.tools` turns out unenforced (see Open Questions). Ship BOTH — a security invariant gets belt-and-suspenders. |
| 3 | Edit-budget | Same hook: count distinct normalized paths across `edit`/`write` (lowercase) per session; the call introducing a 3rd distinct path throws `STRIBOG_SCOPE_VIOLATION` with coaching. Sticky; the first 2 paths stay editable. `STRIBOG_EDIT_BUDGET = 2` (named constant, interpolated into the message, drift-tested). |
| 4 | Attribution | `getSessionAgentCached(input.sessionID, client) === STRIBOG_AGENT_KEY`. Plugin factory changes from `async () =>` to `async ({ client }) =>`. Fail-open (pass the call through) for any other/undefined agent or any resolution error. NOT `SessionAgentRegistry`. |
| 5 | Tool names | Match lowercase runtime ids `"edit"`, `"write"`, `"bash"`, etc. — NEVER the `Edit`/`Write` allow-list casing. |
| 6 | Marker surfacing & eval counting | Markers thrown from the hook land in the tool part's `state.error`. Eval counts `STRIBOG_TOOL_DENIED` / `STRIBOG_SCOPE_VIOLATION` by scanning tool parts across `session.messages`, NOT `last.info.error`. |
| 7 | State lifecycle | `Map<sessionID, Set<normalizedPath>>`, cleared on `session.deleted` only. No wall-clock TTL sweep (a 5-min-max turn — `DEFAULT_TASK_TIMEOUT_MS`, `dispatch.ts:182` — cannot outlive a session; an age-based sweep risks resetting a live budget). |
| 8 | Path normalization | `path.resolve(filePath)`; opencode passes **absolute** `filePath` for edit/write, so this is idempotent. Relative input (no `cwd` in hook) → fail-open rather than resolve against the wrong base. Case-variant double-count only tightens the budget (safe direction). |
| 9 | Bash-verb restriction (rm / mutating-git / non-docker-make-etc.) | **OUT OF SCOPE, documented.** The allow-list's `Bash(docker:*)`-style scoping is also inert, so Stribog's bash is currently a full host shell (modulo the global commit gate, which blocks `git commit` for all sessions). Restricting bash verbs is a separate coordinator-policy-style token-matching effort; flagged as a follow-up. This spec accepts the Phase-1 host-env Bash trust boundary and does not widen or close it. |
| 10 | Prompt change | Simplify the scope rubric to the mechanical contract, via **line-by-line** surgery that preserves the `4f71cce` no-questions language and the secret rule verbatim (they share `stribog.md` line 10). |

## Design

### A. Native tool deny-map — `src/modules/stribog/index.ts`

In the existing `config` hook, after creating `config.agent[STRIBOG_AGENT_KEY]`, set:

```ts
config.agent[STRIBOG_AGENT_KEY].tools = {
  task: false, execute_recipe: false, todowrite: false,
  webfetch: false, websearch: false,
  // (extend with any future non-allow-listed structured tool)
}
```

This is the opencode-native enforcement (mirrors `coordinator/index.ts:367` and
`qa/index.ts:178-183`). It needs no session attribution. **Open question (plan's first
task): behaviorally verify opencode 1.15.10 honors `config.agent[x].tools` — the `/agent`
probe showed `tools:null` even for agents that set it, so this must be confirmed by a live
denial probe, not assumed.** If unenforced, Decision #2's hook denial is the load-bearing
path; if enforced, the hook denial is redundant defense-in-depth (kept anyway).

### B. The hook — `src/modules/stribog/tool-budget-hook.ts`

- `makeStribogToolHook(client)` returns a `tool.execute.before` function; wired into the
  plugin's returned object as `"tool.execute.before"` (the root merger
  `mergeToolExecuteBefore`, `src/index.ts:55-69`, chains it after commit + coordinator-policy).
- **Attribution:** `if ((await getSessionAgentCached(input.sessionID, client)) !==
  STRIBOG_AGENT_KEY) return`. Whole body wrapped so any internal error → return (never
  throw from the hook except the two intended denials). Import `getSessionAgentCached` from
  `@appverk/opencode-skill-utils` (allowed `src → packages` direction).
- **Tool-name gate (Decision #2):** `const ALLOWED = new Set(["read","glob","grep","edit",
  "write","bash"])`. If `!ALLOWED.has(input.tool)` → `throw` with `STRIBOG_TOOL_DENIED` +
  coaching ("`<tool>` is not in Stribog's allow-list; this is a leaf actuator — do not use
  it. If the task needs it, return `ESCALATE`.").
- **Edit-budget (Decision #3):** for `input.tool === "edit" || "write"`: read
  `output.args.filePath`; if missing/non-absolute → return (fail-open, Decision #8);
  `const p = path.resolve(filePath)`; per-session `Set`; add iff already present or
  `set.size < STRIBOG_EDIT_BUDGET`; else `throw` `STRIBOG_SCOPE_VIOLATION` (message
  interpolates `STRIBOG_EDIT_BUDGET` and lists the two touched paths + the refused one).
  The refused path is NOT added to the set.
- **Lifecycle:** the plugin also registers an `event` hook clearing the session's `Set` on
  `session.deleted` (mirror `coordinator/index.ts:401`).

### Deny messages

```
STRIBOG_TOOL_DENIED: tool "<tool>" is outside Stribog's allow-list (read/glob/grep/edit/
write/bash only). Stribog is a leaf actuator — it does not mint secrets or dispatch. If
the task requires this, return the ESCALATE result.

STRIBOG_SCOPE_VIOLATION: edit budget exhausted (<STRIBOG_EDIT_BUDGET> distinct files
already modified: <p1>, <p2>; refused: <p3>). This task exceeds Stribog's scope. Return
the ESCALATE result now, listing the files you already touched in `reason`.
```

### Prompt surgery — `src/modules/stribog/stribog.md` (line-by-line, per F8)

Current line 10 packs three rules into one paragraph; do NOT delete it wholesale.

- **Replace lines 5–9** (the "accept only if ALL hold" rubric clauses) with the mechanical
  contract: "You may modify at most **2 distinct files** per task; a third is refused with
  `STRIBOG_SCOPE_VIOLATION` (the harness enforces this). You may use only read/glob/grep/
  edit/write/bash; any other tool is refused with `STRIBOG_TOOL_DENIED`. If the task plainly
  needs more than 2 files, a new module/agent, or a design decision, return `ESCALATE`
  immediately — and if a tool/edit is refused, do not retry: return `ESCALATE` listing the
  files you already touched."
- **Preserve VERBATIM** the two clauses that already live in line 10: the `4f71cce`
  no-questions / headless-`ESCALATE` sentences, and the secret rule ("Producing or refreshing
  a SECRET / credential value is NOT your job (that is `zmora-setup`); never mint, read for
  output, or echo secrets.").
- **Line 20** ("Editing" — "Keep changes to the 1–2 files…"): reword to reference the
  enforced budget rather than restating a judgment rubric.
- **Line 36** (ESCALATE contract — "list the touched files in `reason`"): keep unchanged.

### Constants

`STRIBOG_EDIT_BUDGET = 2` and the allowed-tool-name set exported from `stribog.metadata.ts`
(single source for hook, deny-map cross-check, and tests).

## What this does and does not guarantee

- **Guarantees (for a session positively attributed as `stribog`):** cannot call any tool
  outside `{read,glob,grep,edit,write,bash}` — so cannot `execute_recipe` (minter ≠ actuator
  restored) or `task` (leaf restored); cannot modify more than 2 distinct files via
  edit/write. Holds on any model, prompt-injection included, **for attributed sessions**.
- **Residual / does not guarantee:** if session-identity resolution transiently fails the
  hook fails open (same accepted residual as the coordinator bash gate — not a hard
  boundary); `config.tools` enforcement is unverified pending the plan probe (the hook is the
  fallback); **bash verbs are unrestricted** (Decision #9 — `rm`, `git push`, etc. run via
  bash; only `git commit` is globally blocked); the budget bounds file **count**, not blast
  radius within those 2 files (Perun's Phase-2 scratch-ref snapshot is the recovery net).
- **Does not flatter the eval:** passing `scope-discipline`'s GATE 2 (`ESCALATE` + zero
  writes) remains an unassisted model-quality bar; the hook bounds production damage, it does
  not make a weak model escalate before writing its ≤2 files.

## Eval implications (corrected per F5/F7)

- **Marker counting (F5):** scan tool parts' `state.error` across `session.messages` for
  `STRIBOG_TOOL_DENIED` / `STRIBOG_SCOPE_VIOLATION`; do NOT read `last.info.error` (empty in
  the cooperative-continue case). A marker in `info.error` instead means the turn died at the
  wall (a `degenerate` signal).
- **scope-discipline grading (F7) — no GATE reversal.** Keep GATE 2 (`ESCALATE` + zero
  writes) as the `recommend` pass bar unchanged. Do NOT relabel "wrote ≤2 then escalated" as
  a new `acceptable` pass tier — that contradicts scope-discipline.md:70-87. Instead add a
  **diagnostic sub-axis within `degenerate`**: "gate cooperation — after a
  `STRIBOG_SCOPE_VIOLATION`/`STRIBOG_TOOL_DENIED` denial, did the model stop and `ESCALATE`?"
  — measures hook efficacy without promoting a files-written run to a pass.
- New scenario opportunity (optional): a `tool-denial` discipline scenario that dispatches a
  task tempting `execute_recipe`/`task` and asserts the marker fires (the gate, not the
  model, is under test). Lower priority than fixing the two existing gates' grading.
- The playbook's "Evaluating Stribog" section gains the marker-via-`state.error` note.

## Testing (TDD)

- **Runtime-denial (the headline security test):** with the plugin loaded, a `stribog`
  session is refused `execute_recipe` and `task` (assert the throw/marker from the hook;
  and, once the Open Question is settled, assert `config.tools` denial too). A non-stribog
  session is unaffected.
- **Tool-name gate:** `read/glob/grep/edit/write/bash` pass; `task/execute_recipe/todowrite/
  webfetch` throw `STRIBOG_TOOL_DENIED`; matched on **lowercase** ids (a fixture using
  `"Edit"` capital must NOT be what the test asserts — pin lowercase so a casing regression
  fails).
- **Edit-budget:** 1st/2nd distinct path pass; 3rd throws `STRIBOG_SCOPE_VIOLATION`;
  same-path re-edit passes after budget reached; refused path is NOT added to the set;
  cross-tool same path (`write` then `edit` of one file) counts once; missing/relative
  `filePath` → fail-open (passes, not counted); message contains `STRIBOG_EDIT_BUDGET` value.
- **Attribution:** resolves stribog → enforced; resolves other agent → pass-through;
  resolves undefined / client throws → fail-open.
- **Lifecycle:** `session.deleted` clears the session's path set.
- **Drift:** `STRIBOG_EDIT_BUDGET === 2`; allowed-name set matches the hook; allow-list still
  17 entries; prompt mentions both markers and the budget; `4f71cce` no-questions + secret
  sentences still present in `stribog.md` (guard against the F8 regression).
- **Integration:** plugin wires `tool.execute.before`; chain coexists with commit +
  coordinator-policy (both fire for a non-stribog `bash`; a stribog denial short-circuits
  later hooks for that one call — assert this is harmless).
- **Eval regression:** re-run `scope-discipline.md` (≥2 iters) on `gpt-5.4-mini-fast` +
  `qwen3.6-plus`; expect qwen's build attempts to terminate at the wall (markers in tool
  `state.error`) rather than a 240 s timeout. Manually probe that `execute_recipe`/`task` are
  now refused for a stribog session.

## Open questions for the plan

1. **Does opencode 1.15.10 honor `config.agent[x].tools`?** **ANSWERED (2026-06-10 live probe):
   NO — it is inert.** A worktree patched with `tools: { execute_recipe: false }` still let a
   `stribog` session call `execute_recipe` to completion. Therefore the **hook (Decision #2) is
   the sole load-bearing enforcement**; the `config.tools` deny-map (Decision #1) is declarative
   only — kept (well-commented) so a future opencode fix yields free defense-in-depth, but it
   must NOT be presented as the boundary (that is exactly the cosmetic-allow-list trap this spec
   exists to fix).
2. **`session-identity` first-turn window:** confirm the first user message (carrying
   `info.agent`) exists before the first tool call in a stribog turn (coordinator-policy
   already relies on this; expected safe).

## Out of scope

- Bash-verb restriction (Decision #9) — separate follow-up; the broader "allow-list unenforced"
  remediation for OTHER agents (Perun/Triglav/Veles/Zmora) is also out of scope here but
  flagged: the same `config.tools`-vs-prompt gap likely affects them and warrants its own pass.
- Per-task declared file allow-lists (Phase 2 candidate).
- Tool-call/exploration-step budgets (latency) — the chosen criterion is side-effect hardness.
- Changes to the secret/liveness rules or the result contract — they passed eval.
