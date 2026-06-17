# Svarog — heavy/main code executor (Hephaestus equivalent)

- **Status:** Revised after adversarial review — ready for implementation planning
- **Date:** 2026-06-17
- **Branch:** `feature/executor`
- **Author:** brainstormed (sequential-thinking + Mixture-of-Agents over OMO 4.10.0 + the Pantheon tree)

> **Revision note (v2).** This spec was put through an adversarial review (sequential-thinking + a
> 4-critic Mixture-of-Agents grounded in the real code + OMO 4.10.0). The review found 3 blockers and
> ~7 majors; all are folded in below. The three decisions that changed the design: **(1)** Svarog is
> grandfathered as the 3rd `@appverk/opencode-skill-utils` importer (for session identity);
> **(2)** an **opt-in worktree path** is added (`agents.svarog.worktree:true`), in-tree default;
> **(3)** a **strong default model is pinned in Phase-1** (provider-gated), not deferred. Key
> factual corrections: the reused `isImmutableDeny` would deny the serena editors Svarog needs (so
> Svarog ships a **narrowed** deny set); the git checkpoint primitive is now **prescriptive**
> (`commit-tree` scratch-ref, not `git stash`); the Manual QA Gate is **scoped to a leaf's surface**;
> Perun gets a **required Feature-build workflow**.

## 1. Context & motivation

Pantheon (the Perun harness) is modeled on **oh-my-openagent (OMO)**. Its agent roster forms an
executor ladder that currently has a gap at the top:

```
Triglav (read-only explore) → Veles (plan) → Stribog (light, ≤2-file mechanical) → [ Svarog ]
                                                                                      ↑ Perun coordinates, Zmora does QA
```

The missing slot is the **heavy/main code executor**: multi-file feature work, runs the full test
suite, returns a verified diff. Stribog (the light executor, just shipped) explicitly routes feature
/ multi-file / architectural work *away* to "the main executor" (`stribog.metadata.ts` `avoidWhen`),
and an existing eval (`docs/eval/scenarios/stribog/scope-discipline.md`) already names that agent
**Svarog** — the Slavic smith-god, the direct analogue of OMO's **Hephaestus**.

> **Reframe (load-bearing).** OMO's Hephaestus is `mode:"primary"` — an *orchestrator* with
> `question` and `task` **allowed** and a tmux/Playwright surface. Svarog is a `mode:"subagent"`
> **leaf** with `question`/`task` **denied**. So we port Hephaestus's prompt spine **selectively**:
> the surface-agnostic quality machinery (intent-mapping, self-verification, style-match, stop-rules,
> done-ritual, the *principle* of the QA gate) transfers; the parts that assume a primary's surface
> (drive-a-browser, consult-an-Oracle, ask-the-user) are scoped down or replaced.

This spec defines Svarog. OMO 4.10.0 (`github.com/code-yeongyu/oh-my-openagent`) was read as the
reference; the Pantheon tree (especially Stribog) defines the module contract Svarog mirrors.

> **OMO version note:** always verify findings against the *latest* OMO release (4.10.0 at time of
> writing), not the local bun cache (stale at 4.2.2). Fetch via `npm pack oh-my-openagent@<latest>`.

## 2. Locked decisions

| Decision | Choice | Consequence |
|---|---|---|
| **Containment / recovery** | **In-tree + `commit-tree` checkpoint, with an opt-in worktree path** | In-tree default (OMO-faithful); a prescriptive scratch-ref checkpoint (§7) snapshots tracked+untracked before editing and restores on failure. `agents.svarog.worktree:true` switches to a disposable worktree for guaranteed-clean recovery. |
| **Commit policy** | **Stop at READY** | Returns a verified diff; Perun/human commits via `/commit`. **No `av_commit` grant** (it is un-caller-gated, so withholding is the only control). |
| **Testing posture** | **Pantheon test-first** | Loads the stack's coding-standards/TDD skills; tests before code; explicit greenfield rule (§8). OMO's "don't add tests" reflex is stripped. |
| **Model** | **Pin a strong default in Phase-1** | Provider-gated pin (mirrors Stribog's existing machinery) with fallback to session default + one-time toast. Eval refines the exact pick; it is not deferred. |
| **First-cut scope** | **Phase-1 MVP** | Leaf executor (no Triglav-dispatch); defer the AGENTS.md auto-injector and per-model prompt variants. |
| **Session identity** | **Grandfather `svarog`** | Svarog becomes the 3rd allowed importer of `getSessionAgentCached` from `@appverk/opencode-skill-utils` (amend `AGENTS.md:92`). The `_shared` split remains the long-term fix. |

Smaller calls (open to revision at review):
1. **Input contract — flexible.** Svarog accepts a task prompt that *may* carry a Veles `plan_path`.
   If present it executes that plan; otherwise it does a lightweight internal plan, then builds.
2. **Safety hook — kept, with a Svarog-specific narrowed deny set.** Not the shared `isImmutableDeny`
   verbatim (that would deny Svarog's serena editors — §7).

## 3. Goals / non-goals

**Goals (Phase-1):**
- A `svarog` subagent that implements multi-file features from a plan or task, test-first, verifies
  with the full suite/build, and returns a structured READY/FAIL/ESCALATE result.
- A **prescriptive, recoverable** in-tree checkpoint **and** an opt-in worktree path.
- A **pinned, provider-gated strong model** with session-default fallback.
- A **Perun Feature-build workflow** that dispatches Svarog and consumes its result.
- Mirror the Stribog module contract (files, registration, tests, dist) and the harness safety floor.
- Eval scenarios + a durable `docs/heavy-execution.md`.

**Non-goals (deferred to Phase-2+):**
- Dispatching Triglav (or any agent) mid-build — Svarog is a **leaf** in Phase-1.
- An AGENTS.md auto-injector hook (OMO's `hephaestus-agents-md-injector`). *(Pantheon's skill-
  activation injection already feeds Svarog the stack's coding-standards; the only residual gap is
  repo-specific AGENTS.md prose, which matters mainly when Svarog edits Pantheon itself.)*
- Per-model prompt variants (OMO ships gpt-5.4/5.5/generic).
- `av_commit` capability (and the caller-gate it would require).
- An Oracle-class read-only debug consultant (Svarog uses a bounded self-root-cause step instead).
- The `skill-utils → _shared` session-identity absorption (grandfather `svarog` for now).

## 4. Architecture & placement

- **Key/mode:** `svarog`, `mode:"subagent"` (lowercase bare key like `triglav`/`stribog`; the
  "Name - Role" form is only for primary/all agents).
- **Location:** `src/modules/svarog/` (NOT `packages/` — respects the src→packages boundary).
- **Registration:** a new `AppVerkSvarogPlugin` factory calls `registerAgentMetadata(svarogSpecialistInfo)`;
  inserted into `defaultPluginFactories` in `src/index.ts` **before** `AppVerkCoordinatorPlugin`
  (registry-freeze: registering after Perun's prompt snapshot throws "Late agent registration"
  — `agent-registry/index.ts:49-58,91-94`).
- **Session identity:** Svarog imports `getSessionAgentCached`/`forgetSessionAgent` from
  `@appverk/opencode-skill-utils` (same as Stribog). This is a **new** import of a frozen package,
  so `AGENTS.md:92` must be amended to list `svarog/` as the third grandfathered consumer. The
  `_shared/SessionAgentRegistry` is **not** sufficient — it is dispatch-only and would leave the
  safety floor inert in eval/direct sessions.

## 5. Module file blueprint (mirror Stribog)

| File | Responsibility |
|---|---|
| `src/modules/svarog/svarog.metadata.ts` | `SVAROG_AGENT_KEY="svarog"`, `SVAROG_DESCRIPTION`, `svarogSpecialistInfo` (routing metadata + `workflowContribution`), `DEFAULT_SVAROG_MODEL`, the **narrowed** `SVAROG_IMMUTABLE_DENY` set. Leave `category`/`cost` unset (unrendered). |
| `src/modules/svarog/allowed-tools.ts` | `SVAROG_TOOLS` — the broad display-cased allow-list rendered into prompt frontmatter. |
| `src/modules/svarog/prompt.ts` | memoized `buildSvarogPrompt()` → `buildAgentPrompt(svarogSpecialistInfo, SVAROG_TOOLS, import.meta.url, "svarog.md")`. |
| `src/modules/svarog/svarog.md` | the authored system prompt (§8). |
| `src/modules/svarog/tool-budget-hook.ts` | the `tool.execute.before` safety hook (§7) — attribution-gated, fail-open, **no edit budget**, narrowed floor + secret tripwire. |
| `src/modules/svarog/checkpoint.ts` | the `commit-tree` scratch-ref create/restore + the opt-in worktree path (§7). |
| `src/modules/svarog/index.ts` | `AppVerkSvarogPlugin`: register metadata; `config` hook (agent entry + `applyModelOverride` with the **pinned** default + provider-gate + toast); wire the safety hook + `session.deleted` cleanup. |
| `tests/modules/svarog/*` | mirror Stribog's suite: `metadata`, `allowed-tools`, `prompt`, `plugin`, `tool-budget-hook` (re-keyed), `tools-sync`, `model-injection`, **`secret-gate-invariant`**, `checkpoint`. |
| `dist/modules/svarog/**` | rebuilt via `bun run build:root` and **committed** (CI `verify-dist` enforces no drift). |

Reuses `_shared/`: `build-agent-prompt`, `load-asset`, `apply-model-override`, `provider-detect`
(now used — the model is pinned), `sanitize`. **Does not** reuse `isImmutableDeny` verbatim (§7).
`SVAROG_AGENT_KEY` is local; `getSessionAgentCached` comes from the grandfathered `skill-utils`.

## 6. Tool surface

**Allow:**
- Read / Glob / Grep
- Edit / Write / MultiEdit
- serena edit suite (`replace_symbol_body`, `insert_after_symbol`, `replace_content`, …) **and**
  cross-file `rename_symbol` / `safe_delete_symbol` — Svarog's lane *is* multi-file refactoring
- serena `get_diagnostics_for_file` (fast inner verify loop before the full suite)
- Bash: `bun` / `npm` / `pnpm` / `uv` / `make` / `docker` / `docker compose` / `curl`; read-only git
  (`log`/`blame`/`status`/`diff`); checkpoint/worktree git (`stash`/`add`/`checkout --`/`branch`/
  `worktree`/`write-tree`/`commit-tree`/`update-ref`/`read-tree`/`reset --mixed`)
- Native **`skill`** + `load_appverk_skill` — **ON** (load the stack's `*-coding-standards` /
  `*-tdd-workflow` skills before the first edit; opposite of Perun and Stribog)

**Deny (code-enforced in the hook — config maps are default-allow, so an allow-list omission alone
does not gate a plugin/native tool):**
- `question` — Svarog runs headless; ambiguity → `ESCALATE` (must be in the deny set, not just absent)
- `execute_recipe` + the `SECRET_GEN_BASH` tripwire (minter ≠ actuator)
- dispatch / `task` family (leaf in Phase-1)
- serena shell-escape (`execute_shell_command`)
- raw `git commit` / `git push` (already globally blocked by the commit plugin — a bypassable rail,
  not a boundary) and `av_commit` (not in the allow-list)

> **Note (F-review):** the shared `isImmutableDeny` denies `rename`/`delete`/`move`/`_symbol`/
> `_content`/`_symbol_body` as whole segments, which would block the serena editors above. Svarog
> therefore defines its **own** `SVAROG_IMMUTABLE_DENY` (keeps shell-escape, dispatch/`task`,
> `execute_recipe`, secret-mint, `question`; **drops** the code-write/rename/delete patterns). §7.

## 7. Safety hook & containment

### Safety floor (code-enforced)
`config.agent[].tools` is **honored-but-default-allow** on the current runtime (an unlisted tool still
executes; only an explicit deny bites — `stribog.metadata.ts:55-59`). An allow-list therefore cannot
be enforced by the config map; it must be a code hook. Svarog ships `makeSvarogToolHook` — a
`tool.execute.before` handler, **attribution-gated** (via the grandfathered `getSessionAgentCached`,
which resolves dispatched *and* eval/direct sessions) and **fail-open** (a non-Svarog session passes
through). It enforces the **narrowed** `SVAROG_IMMUTABLE_DENY` (shell-escape, dispatch/`task`,
`execute_recipe`, secret-mint, `question`) + the `SECRET_GEN_BASH` tripwire. It carries **no** edit
budget. A re-keyed hook test must assert a `svarog`-attributed session is denied for those classes
and SECRET_DENIED for `openssl rand`/`node -e …randomBytes`, so a copy-paste that leaves the
`STRIBOG_AGENT_KEY` gate (which would silently fail-open) is caught.

### Containment & recovery — in-tree `commit-tree` checkpoint (prescriptive)
`git stash create` does **not** capture untracked files (new feature files), and `git stash -u`
mutates the tree — neither can "snapshot incl. untracked without disturbing the tree." The **only**
git construction that does (verified empirically) is a scratch-ref WIP commit:

```
# create (before the first edit; leaves the working tree + index status untouched)
TREE=$(GIT_INDEX_FILE=$tmp git add -A && GIT_INDEX_FILE=$tmp git write-tree)
CKPT=$(git commit-tree "$TREE" -p HEAD -m "svarog checkpoint")
git update-ref refs/svarog/ckpt/<session> "$CKPT"
# (working tree and the real index are never modified)

# restore (on 3-attempt failure / broken build)
git read-tree "$CKPT" && git checkout-index -a -f       # restore tracked tree
#   then remove ONLY files Svarog created this turn (tracked-created list), scoped clean -fd, NEVER -x
```

The `checkpoint` field in the result (§9) is this ref and must never be empty. **Honest limits**
(documented in `docs/heavy-execution.md`, mirroring `light-execution.md:115`): the checkpoint does
**not** recover gitignored files (`.env`, `node_modules`), embedded/vendored repos, or started
services; restore must never run `clean -x` (it would delete the user's gitignored data) and must
remove only paths Svarog created this turn. The Bash rail cannot contain `rm` — the checkpoint
*recovers the tree, it is not a sandbox*.

### Opt-in worktree path (`agents.svarog.worktree:true`)
When set, Svarog runs inside a disposable `.worktrees/<branch>` checkout (must stay git-ignored).
Recovery = **discard the worktree** — a guaranteed-clean restore that recovers tracked *and*
untracked edits and isolates the operator's WIP/gitignored files entirely. Default off (in-tree).

### Result neutralization
`neutralizeUntrustedOutput` is applied by **Perun at dispatch ingestion** (`dispatch.ts:570`), not by
Svarog's own hook — Svarog's result (incl. `changed`/`verification`/`checkpoint`) flows through it
automatically when dispatched. A direct (non-dispatched) user session returns un-neutralized, the
same posture as every agent.

## 8. System prompt (`svarog.md`) — OMO spine, ported selectively, Pantheon values

1. **Identity** — autonomous deep worker; "you receive goals, not step-by-step instructions."
2. **Autonomy & persistence** — keep going; don't hand back a draft; headless = `ESCALATE`, never a
   question (the `question` tool is denied — §7).
3. **Intent-mapping (mini-table)** — map surface request → true intent (counters literal-mode
   failures); the leaf-safe rows of OMO's table.
4. **Scope rubric** — `ESCALATE` on design ambiguity / wrong-or-missing plan / new architectural
   decision / secret needed (→ zmora-setup) / needs fan-out. Trivial 1-file/env work is Stribog's
   lane. Just-do-it on planned multi-file work. **Leaf — never dispatch/spawn agents.**
5. **Operating loop** — Explore → Plan → **(test-first) Implement** → Verify → **Manual QA Gate**.
   - *Test-first*: obey the injected MANDATORY rule — load the stack's `*-coding-standards` /
     `*-tdd-workflow` skill **before the first edit**; failing test → implement → green.
   - *Style-match / surgical*: match the codebase's naming/imports/indentation even where you'd write
     it differently; smallest correct change; no opportunistic refactor of surrounding code.
   - *Verify*: serena `get_diagnostics_for_file` on every changed file (fast) → the **full suite/build
     must actually run green** (the slow gate). Then **self-verify**: re-read every file you changed —
     does it work, does it follow the pattern?
   - *Manual QA Gate, scoped to a leaf's surface*: non-interactive CLI → run it via bash; HTTP API →
     `curl`; library/module → a minimal driver script. **Web-UI / interactive-TUI work is out of a
     headless leaf's surface → `ESCALATE` or leave it to a Zmora pass** (do NOT claim a browser/tmux
     surface Svarog cannot drive). Keep the principle: *reading the source and concluding "should
     work" does not pass.*
6. **Failure recovery** — up to 3 *materially different* approaches; then a **bounded self-root-cause
   pass** (re-read the failing surface, challenge the assumption, try one 4th materially-different
   approach); on exhaustion, **revert to the checkpoint**, then `ESCALATE` with the attempts in
   `reason`. (No Oracle in Phase-1; the self-root-cause step is its cheap leaf-safe substitute.)
7. **Pragmatism / anti-over-engineering** — smallest correct change; no defensive/speculative code;
   fix only issues your change caused; **never** weaken/delete a test to make it pass; **never** add
   tests the plan didn't call for purely to satisfy a gate (greenfield: follow the TDD skill's
   bootstrapping guidance, don't import OMO's "never add tests" reflex).
8. **Hard Invariants (enumerated block)** — never leave code broken; never claim READY without a green
   suite; never commit; never mint/echo a secret; never revert changes you didn't make; no
   type-suppression (`as any`/`@ts-ignore`); no `question`; no dispatch.
9. **Done-ritual** — before emitting READY, re-read the original task + your intent line and re-run
   the suite once more (operationalizes the false-READY guard).
10. **Result contract** (§9) and the **Svarog-vs-Zmora boundary**: the Manual QA Gate is *developer
    self-verification of your own diff* — it does not author QA plans, emit QA-XXX issues, or replace
    Zmora's independent scenario-based acceptance pass (dispatched separately by Perun).

## 9. Result contract

A single fenced JSON block, nothing after it (the executor contract Perun parses as untrusted data;
extra fields are tolerated — `dispatch.ts` treats the body as an opaque string):

```json
{
  "status": "READY",          // READY | FAIL | ESCALATE
  "reason": "<one line; required for FAIL and ESCALATE>",
  "changed": ["<files created/edited>"],
  "verification": "<suite/build command run + pass/fail>",
  "checkpoint": "<scratch ref to restore from; never empty>"
}
```

- **READY** = feature done **and** the full suite/build actually ran green (false-READY — claiming
  done with a red or unrun suite — is the signature failure the evals target).
- **FAIL** = tried, tests/build fail. **ESCALATE** = out of scope / needs a decision.

## 10. Routing integration

- Populate `keyTrigger`/`useWhen`/`avoidWhen`/`triggers` so Perun's registry-rendered tables route
  heavy feature work to Svarog and away from Stribog/Veles. Routing *prose* lives in the (currently
  unused) `metadata.workflowContribution` slot — **but** rendering it **requires adding a
  `{WORKFLOW:svarog}` placeholder to `perun.md`** (which has none today), and the builder **throws**
  on an unregistered agent — so registration (before the freeze) + the placeholder must land
  atomically, backed by a Perun-prompt render test.
- **Feature-build workflow (REQUIRED in Phase-1).** Add a workflow block to `perun.md` defining how
  Perun dispatches Svarog (with a `plan_path` or a raw task) **and** how it consumes each terminal
  status: `READY` → surface the diff and offer `/commit`; `FAIL` → report; `ESCALATE` → route the
  named decision (e.g. a secret → `zmora-setup`, a design fork → Veles/human). Without this, Perun has
  no contract for a Svarog result — its existing parser is QA-scenario-specific only.
- Pipeline: `Veles (plan) → Perun → dispatch Svarog → READY → Perun/human commits`.

## 11. Evals & docs to ship

Mirror the Stribog eval format. Each Phase-1 eval run **fixes the model explicitly per-run** (the
pinned default plus comparison candidates), so scoring is comparable and feeds the eval-refinement.

1. `happy-path-feature.md` — a real multi-file feature/refactor from a plan. **Resolve the harness
   gap:** either ship it as a **private** `local-svarog-feature.md` (true Layer 2, not committed) **or**
   build a **committed minimal fixture repo** (real failing→green suite + checked-in plan) and label
   it Layer 1. Add the **"Evaluating Svarog" playbook section** describing how the multi-file target is
   stood up (it does not exist today). GATE = `READY` with the suite actually green; rank by minimal
   correct diff confined to planned files.
2. `scope-floor-discipline.md` (Layer 1) — a trivial single-file task; Svarog should do it minimally
   or note it's Stribog's lane, not spin up heavy process.
3. `ambiguity-discipline.md` (Layer 1) — an unspecified design fork; correct = `ESCALATE` naming the
   decision; must not guess-and-build, must not hang (the `question` deny prevents the hang — assert it).
4. `secret-discipline.md` (Layer 1) — port Stribog's; feature work needing a minted secret → no
   fabricated/echoed value, terminal `ESCALATE` to `zmora-setup`; assert the floor fires for a
   `svarog`-attributed session.
5. `greenfield-untested-target.md` (Layer 1) — a feature on an **untested** target; pins the
   resolved test-posture rule (§8.7) so behavior isn't a coin-flip.
6. `recovery-discipline.md` — **sequenced after the checkpoint lands** (§13). Split: a discipline half
   (honest `FAIL` on a broken build, runnable now) and a recovery half (checkpoint/worktree restore
   leaves the parent tree clean — `git status --short` clean **and** no orphan file).

Docs: `docs/heavy-execution.md` (mirror `docs/light-execution.md`, incl. the honest checkpoint
limits), the "Evaluating Svarog" playbook section, an AGENTS.md module-table row + the **grandfather
amendment** (`AGENTS.md:92`), a README roster row, and a `docs/configuring-agents.md` entry (model +
`worktree` flag).

## 12. OMO 4.10.0 reference — adopt / adapt / drop

**Adopt (surface-agnostic, leaf-safe):** the GPT-5.5 prompt spine; the **principle** of the Manual QA
Gate; anti-over-engineering; the intent-mapping table; style-match/surgical-change; self-verification
("re-read every changed file; never trust self-reports" — the self half applies even to a leaf);
enumerated Hard Invariants / stop-rules; the done-ritual.

**Adapt:** permission + code-hook Hard Blocks instead of OMO's "full toolset, no whitelist"; the
result contract to Pantheon's READY/FAIL/ESCALATE JSON; editing guidance to `edit`/`write`/`MultiEdit`
(OMO assumes `apply_patch`); the QA gate **scoped to a leaf's surface** (no tmux/Playwright); the
failure ladder's Oracle step → a **bounded self-root-cause** step (a leaf can't `task` a consultant).

**Drop:** the GPT-pin + `no-hephaestus-non-gpt` rerouting (OMO-internal two-stack plumbing) — but
**keep the lesson**: pin a strong model (we pin in Phase-1, §2); per-model prompt variants; **OMO's
"default to not adding tests" reflex** (the skill-activation injection overrides it at runtime — §8.7).

**Phase-2 candidates from OMO:** the AGENTS.md auto-injector; Triglav-dispatch for mid-build
exploration; an Oracle-class debug consultant.

## 13. Implementation checklist (ordered, TDD)

1. `svarog.metadata.ts` — key, description, routing metadata, `DEFAULT_SVAROG_MODEL`, the narrowed
   `SVAROG_IMMUTABLE_DENY` (failing tests first; pin the deny set differs from `isImmutableDeny`).
2. `allowed-tools.ts` — `SVAROG_TOOLS` (+ length-guard + `tools-sync` tests).
3. `tool-budget-hook.ts` — attribution-gated (grandfathered `getSessionAgentCached`), fail-open,
   secret tripwire + narrowed floor, **no budget**; re-keyed hook tests + `secret-gate-invariant`.
4. `svarog.md` — authored prompt (§8) + prompt test (asserts contract, scope, secret rule, leaf-scoped
   QA gate, Hard Invariants).
5. `prompt.ts` — `buildSvarogPrompt()`.
6. `checkpoint.ts` — `commit-tree` scratch-ref create/restore + worktree opt-in + tests.
7. `index.ts` — `AppVerkSvarogPlugin`: register + `config` hook (agent entry + `applyModelOverride`
   with the **pinned** default + `provider-detect` gate + toast) + hook wiring + `session.deleted`
   cleanup; plugin test + `model-injection` test.
8. `src/index.ts` — insert `AppVerkSvarogPlugin` before the coordinator.
9. Routing — `workflowContribution` + `{WORKFLOW:svarog}` in `perun.md` + the **Feature-build
   workflow** (dispatch + READY/FAIL/ESCALATE handling) + a Perun-prompt render test.
10. `bun run build:root` → commit `dist/modules/svarog/**`; `bun run check` + `verify-dist` green.
11. Evals (`docs/eval/scenarios/svarog/*`, incl. `greenfield-untested-target`; sequence
    `recovery-discipline` after step 6) + the "Evaluating Svarog" playbook section.
12. Docs — `docs/heavy-execution.md`, AGENTS.md module row **+ the `:92` grandfather amendment**,
    README roster row, `docs/configuring-agents.md` (model + `worktree`).
13. Model — set the interim strong pin now (mirror Stribog's pin + fallback); eval-refine the exact
    value from the §11 runs.

## 14. Key reference files

- Template: `src/modules/stribog/` — `allowed-tools.ts`, `index.ts`, `prompt.ts`, `stribog.md`, `stribog.metadata.ts`, `tool-budget-hook.ts`
- Shared: `src/modules/_shared/{build-agent-prompt,apply-model-override,provider-detect,sanitize,load-asset}.ts`; `_shared/stribog-extra-tools-contract.ts` (reference for the deny set — Svarog ships its own narrowed copy)
- Session identity (grandfathered): `@appverk/opencode-skill-utils` → `packages/skill-utils/src/session-identity.ts` (`getSessionAgentCached`); the freeze note at `AGENTS.md:92,296`
- Routing & dispatch: `src/modules/coordinator/`, `src/agents/perun.md`, `src/modules/agent-registry/perun-prompt-builder.ts` (`{WORKFLOW}`/`{USE_AVOID}` rendering, throws on unknown agent), `src/modules/coordinator/dispatch.ts` (`:570` neutralize; opaque result body)
- Commit path: `src/modules/commit/` (`av_commit`, `controlled-commit.ts`, `bash-policy.ts` — "rail not boundary")
- QA boundary: `src/modules/qa/` + `docs/plugins/qa.md` (Zmora — independent acceptance pass)
- Durable doc to mirror: `docs/light-execution.md` (esp. `:115` checkpoint honesty); eval template: `docs/eval/scenarios/stribog/*` + `docs/eval/playbook.md`
- OMO 4.10.0: `github.com/code-yeongyu/oh-my-openagent` — Hephaestus is `mode:"primary"`; `dist/index.js` (`HEPHAESTUS_GPT_5_5_TEMPLATE`, `no-hephaestus-non-gpt`, the failure/Oracle ladder)
