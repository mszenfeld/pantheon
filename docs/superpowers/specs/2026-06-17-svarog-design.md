# Svarog — heavy/main code executor (Hephaestus equivalent)

- **Status:** Verified (2 review rounds) — ready for implementation planning
- **Date:** 2026-06-17
- **Branch:** `feature/executor`
- **Author:** brainstormed (sequential-thinking + Mixture-of-Agents over OMO 4.10.0 + the Pantheon tree)

> **Revision history.**
> **v1** — initial brainstormed design (4 locked decisions).
> **v2** — after adversarial review round 1 (4 critics): grandfather `svarog` for identity; opt-in
> worktree; pin a Phase-1 model; narrowed deny set; prescriptive checkpoint; scoped QA gate; required
> Perun Feature-build workflow.
> **v3 (this)** — after verification review round 2 (4 critics; checkpoint commands *empirically*
> tested). Fixes: **(a)** the deny-set change in v2 over-corrected (it would re-open DB/DDL mutation
> and serena memory-writes) → replaced with a **serena-editor carve-out before the *unchanged* shared
> `isImmutableDeny`** + an explicit `question` deny; **(b)** the checkpoint git commands were buggy
> (bad temp-index create, missing final `git reset`, unsafe `clean -fd`) → replaced with the
> validated sequence + a concrete `checkpoint.ts` API; **(c)** adding `{WORKFLOW:svarog}` breaks 3
> existing Perun render tests → made explicit; **(d)** test-posture skill-collision resolved
> (plan-scope authoritative; greenfield rule authored inline); **(e)** the **opt-in worktree path is
> deferred to Phase-1b** (it needs config-schema work + an undefined subagent-cwd entry mechanism);
> **(f)** grandfather amendment applies to *both* AGENTS.md sites; secret-gate-invariant is a
> cross-module QA-hook dependency.

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
> `question`/`task` **allowed** and a tmux/Playwright surface. Svarog is a `mode:"subagent"` **leaf**
> with `question`/`task` **denied**. We port Hephaestus's spine **selectively**: the surface-agnostic
> quality machinery transfers; the parts that assume a primary's surface are scoped down or replaced.

This spec defines Svarog. OMO 4.10.0 (`github.com/code-yeongyu/oh-my-openagent`) was read as the
reference; the Pantheon tree (especially Stribog) defines the module contract Svarog mirrors.

> **OMO version note:** always verify against the *latest* OMO release (4.10.0 at time of writing),
> not the local bun cache (stale at 4.2.2). Fetch via `npm pack oh-my-openagent@<latest>`.

## 2. Locked decisions

| Decision | Choice | Consequence |
|---|---|---|
| **Containment / recovery** | **In-tree `commit-tree` checkpoint** | Snapshots tracked+untracked before editing and restores on failure (§7). Worktree isolation is **deferred to Phase-1b** (§3). |
| **Commit policy** | **Stop at READY** | Returns a verified diff; Perun/human commits via `/commit`. **No `av_commit` grant** (it is un-caller-gated; withholding is the only control). |
| **Testing posture** | **Pantheon test-first** | Loads the stack's coding-standards/TDD skills; tests before code; the **plan's test-scope is authoritative** over the skill's 80% default; explicit greenfield rule authored inline (§8). |
| **Model** | **Pin a strong default in Phase-1** | Provider-gated pin (mirrors Stribog's machinery) with session-default fallback + one-time toast. Eval refines the exact value. |
| **First-cut scope** | **Phase-1 MVP** | Leaf executor (no Triglav-dispatch); defer the AGENTS.md auto-injector, per-model prompt variants, and the worktree path. |
| **Session identity** | **Grandfather `svarog`** | 3rd allowed importer of `getSessionAgentCached` from `@appverk/opencode-skill-utils` (amend **both** AGENTS.md freeze sites). |

Smaller calls (open to revision at review):
1. **Input contract — flexible.** Svarog accepts a task prompt that *may* carry a Veles `plan_path`;
   if present it executes that plan, else it does a lightweight internal plan, then builds.
2. **Safety floor — carve-out + reuse, not a narrowed copy.** Svarog reuses the shared `isImmutableDeny`
   **unchanged** and adds a serena-editor allow carve-out *before* it, plus a named `question` deny (§7).

## 3. Goals / non-goals

**Goals (Phase-1):**
- A `svarog` subagent that implements multi-file features from a plan or task, test-first, verifies
  with the full suite/build, and returns a structured READY/FAIL/ESCALATE result.
- A **prescriptive, recoverable** in-tree `commit-tree` checkpoint.
- A **pinned, provider-gated strong model** with session-default fallback.
- A **Perun Feature-build workflow** that dispatches Svarog and consumes its result.
- Mirror the Stribog module contract (files, registration, tests, dist) and the harness safety floor.
- Eval scenarios + a durable `docs/heavy-execution.md`.

**Non-goals (deferred):**
- **Worktree isolation (Phase-1b).** The opt-in `agents.svarog.worktree` path needs (a) config-schema
  work — `pantheon-config` only knows `model`/`extraTools` and has never validated a boolean — and
  (b) a defined subagent-cwd **entry mechanism** (who places a dispatched subagent into `.worktrees/`
  and when). Both are out of Phase-1; the in-tree checkpoint is self-sufficient.
- Dispatching Triglav (or any agent) mid-build — Svarog is a **leaf** in Phase-1.
- The AGENTS.md auto-injector hook. *(Pantheon's skill-activation injection already feeds Svarog the
  stack's coding-standards; the only residual gap is repo-specific AGENTS.md prose, mainly when Svarog
  edits Pantheon itself.)*
- Per-model prompt variants; `av_commit`; an Oracle-class debug consultant (a bounded self-root-cause
  step replaces it); the `skill-utils → _shared` identity absorption (grandfather `svarog` for now).

## 4. Architecture & placement

- **Key/mode:** `svarog`, `mode:"subagent"` (lowercase bare key like `triglav`/`stribog`).
- **Location:** `src/modules/svarog/` (NOT `packages/` — respects the src→packages boundary).
- **Registration:** `AppVerkSvarogPlugin` calls `registerAgentMetadata(svarogSpecialistInfo)`; inserted
  into `defaultPluginFactories` in `src/index.ts` **before** `AppVerkCoordinatorPlugin` (registry
  freeze: late registration throws — `agent-registry/index.ts:49-58`).
- **Session identity:** Svarog imports `getSessionAgentCached`/`forgetSessionAgent` from
  `@appverk/opencode-skill-utils` (like Stribog; resolves dispatched **and** eval/direct sessions —
  the `_shared/SessionAgentRegistry` is dispatch-only and would leave the floor inert in evals). This
  is a new import of a frozen package: amend **both** AGENTS.md freeze statements (the "import
  direction is FROZEN" paragraph **and** the "Adding a New Absorbed Module" list) to add `svarog/` as
  the third grandfathered consumer. No automated check enforces the freeze (verified — eslint has no
  `no-restricted-imports`, no CI grep, no test asserts the importer set), so the prose amendment is
  sufficient.

## 5. Module file blueprint (mirror Stribog)

| File | Responsibility |
|---|---|
| `src/modules/svarog/svarog.metadata.ts` | `SVAROG_AGENT_KEY="svarog"`, `SVAROG_DESCRIPTION`, `svarogSpecialistInfo` (routing fields + `metadata.workflowContribution` — note: it lives *inside* `metadata`, not as a sibling), `DEFAULT_SVAROG_MODEL`, `SVAROG_SERENA_EDITORS` (the carve-out list). Leave `category`/`cost` unset. |
| `src/modules/svarog/allowed-tools.ts` | `SVAROG_TOOLS` — the native + bash entries rendered into prompt frontmatter (declarative only). serena editors and `skill`/`load_appverk_skill` are **hook-allowed**, not necessarily in `SVAROG_TOOLS` (mirror Stribog, where serena is hook-only); the `tools-sync` test must reflect this split. |
| `src/modules/svarog/prompt.ts` | memoized `buildSvarogPrompt()` → `buildAgentPrompt(svarogSpecialistInfo, SVAROG_TOOLS, import.meta.url, "svarog.md")`. |
| `src/modules/svarog/svarog.md` | the authored system prompt (§8), incl. the inline greenfield rule. |
| `src/modules/svarog/tool-budget-hook.ts` | the `tool.execute.before` safety hook (§7) — attribution-gated, fail-open, **no edit budget**: secret tripwire → serena carve-out → reuse `isImmutableDeny` + `question` deny. |
| `src/modules/svarog/checkpoint.ts` | the in-tree `commit-tree` scratch-ref create/restore (§7) — TS shelling out via `child_process`. |
| `src/modules/svarog/index.ts` | `AppVerkSvarogPlugin`: register metadata; `config` hook (agent entry + `applyModelOverride` with the **pinned** default + `provider-detect` gate + toast); wire the hook + `session.deleted` cleanup (`forgetSessionAgent` + checkpoint-ref bookkeeping). |
| `tests/modules/svarog/*` | `metadata`, `allowed-tools`, `prompt`, `plugin`, `tool-budget-hook` (re-keyed), `tools-sync`, `model-injection`, `checkpoint`, and the **cross-module** `secret-gate-invariant` (see §7). |
| `dist/modules/svarog/**` | rebuilt via `bun run build:root` and **committed** (CI `verify-dist` enforces no drift). |

Reuses `_shared/`: `build-agent-prompt`, `load-asset`, `apply-model-override`, `provider-detect`,
`sanitize`, **and `isImmutableDeny`** (imported unchanged — the carve-out, not a narrowed copy, is
what differentiates Svarog). `getSessionAgentCached` comes from the grandfathered `skill-utils`.

## 6. Tool surface

**Allow:**
- Read / Glob / Grep
- Edit / Write / MultiEdit
- serena edit suite — the **carve-out** `SVAROG_SERENA_EDITORS`: `rename_symbol`, `safe_delete_symbol`,
  `replace_symbol_body`, `replace_content`, `insert_after_symbol`, `insert_before_symbol`,
  `create_text_file` (explicitly **not** `write_memory`/`delete_memory`)
- serena `get_diagnostics_for_file` (fast inner verify loop; passes the deny floor — test-pin it)
- Bash: `bun`/`npm`/`pnpm`/`uv`/`make`/`docker`/`docker compose`/`curl`; read-only git
  (`log`/`blame`/`status`/`diff`); checkpoint git (`add`/`write-tree`/`commit-tree`/`update-ref`/
  `read-tree`/`ls-tree`/`ls-files`/`checkout-index`/`reset`/`checkout --`/scoped `clean`) — §6 and §7 must list the same verbs
- Native **`skill`** + `load_appverk_skill` — **ON** (load the stack's `*-coding-standards` /
  `*-tdd-workflow` before the first edit; opposite of Perun and Stribog)

**Deny (code-enforced in the hook — config maps are default-allow, so an allow-list omission alone
does not gate a plugin/native tool):**
- `question` — Svarog runs headless; ambiguity → `ESCALATE`. **Must be an explicit named deny** (no
  `isImmutableDeny` pattern covers it; Stribog never denied it — this is *added*, not "kept").
- everything the shared `isImmutableDeny` denies: `execute_recipe`, dispatch/`task` family, serena
  shell-escape (`*_execute_shell`/`*_shell_command`), DB/DDL/privilege mutation verbs, serena
  `_memory` writes — **kept by reusing `isImmutableDeny` unchanged** (the §7 carve-out runs first so
  the legit serena *editors* are not caught by these patterns)
- the `SECRET_GEN_BASH` tripwire (minter ≠ actuator)
- raw `git commit`/`git push` (globally blocked by the commit plugin — a bypassable rail) and
  `av_commit` (not granted)

## 7. Safety hook & containment

### Safety floor — hook evaluation order (code-enforced)
`config.agent[].tools` is honored-but-default-allow (an unlisted tool still runs; only an explicit
deny bites), so the allow-list must be a code hook. `makeSvarogToolHook` is a `tool.execute.before`
handler, **attribution-gated** (via the grandfathered `getSessionAgentCached`) and **fail-open**, with
**no edit budget**, in this order:

1. pure reads (`read`/`glob`/`grep`) → pass.
2. `bash` matching `SECRET_GEN_BASH` → `SVAROG_SECRET_DENIED`.
3. **serena-editor carve-out** — tool id (server-prefix-agnostic, suffix-matched) ∈
   `SVAROG_SERENA_EDITORS` → **ALLOW** (short-circuits before the floor; this is why Svarog's refactor
   editors work while DB/DDL/`_memory` stay denied).
4. `question` → `SVAROG_TOOL_DENIED`.
5. `isImmutableDeny(toolId)` (the shared function, **unchanged**) → `SVAROG_TOOL_DENIED`.
6. else → ALLOW.

This reuses the shared deny set with zero duplication (no drift), and the carve-out (step 3) is the
single point that re-enables exactly the 7 serena editors. A re-keyed hook test must assert a
`svarog`-attributed session: ALLOWS the 7 editors + `get_diagnostics_for_file` + `edit`/`write`;
DENIES `question`, `execute_recipe`, `task`/dispatch, `*_execute_shell`, `write_memory`,
`supabase_delete_rows`/`db_drop_table` (DB/DDL), and `SECRET_DENIED` for `openssl rand`/`node -e
…randomBytes` — so a copy-paste that leaves the `STRIBOG_AGENT_KEY` gate (which silently fails open)
is caught.

**Cross-module secret-gate.** Stribog's `secret-gate-invariant` test actually asserts the **QA**
`shell-env-hook` (keyed off `SessionAgentRegistry`) injects no minted binding into a stribog session.
For Svarog to inherit that protection, the QA hook / its registry must enumerate `svarog` — this is a
cross-module dependency the checklist (§13.3) must capture, not a self-contained Svarog test.

### Containment & recovery — in-tree `commit-tree` checkpoint (validated)
`git stash create` cannot capture untracked files and `git stash -u` mutates the tree; the only
construction that snapshots tracked+untracked **without** disturbing the working tree/index is a
scratch-ref WIP commit. `checkpoint.ts` exports `createCheckpoint(cwd, sessionId): string` (returns
the ref) and `restoreCheckpoint(cwd, ckptRef): void`, shelling out via `child_process`:

```sh
# createCheckpoint — leaves the real tree AND index untouched
idx=$(mktemp -u); cp .git/index "$idx" 2>/dev/null || true   # seed (preserves staged state); NOT a 0-byte mktemp file
GIT_INDEX_FILE="$idx" git add -A
TREE=$(GIT_INDEX_FILE="$idx" git write-tree); rm -f "$idx"
CKPT=$(git commit-tree "$TREE" -p HEAD -m "svarog checkpoint")
git update-ref refs/svarog/ckpt/<sessionId> "$CKPT"          # returns CKPT; never empty

# restoreCheckpoint — recover tracked tree, remove only Svarog-created orphans, rebuild index
git ls-tree -r --name-only "$CKPT" | sort > /tmp/c
{ git ls-files; git ls-files --others --exclude-standard; } | sort -u > /tmp/n
ORPHANS=$(comm -13 /tmp/c /tmp/n)                            # present-now but absent-from-checkpoint = Svarog-created
git read-tree "$CKPT" && git checkout-index -a -f           # restore tracked content
printf '%s\n' "$ORPHANS" | while read -r f; do [ -n "$f" ] && rm -f -- "$f"; done   # per-path; NEVER `clean -fd`/`-x`
git reset -q                                                # REQUIRED: rebuild the index (else everything shows staged)
```

Orphans are computed from **git state at restore time** (not from any edit-tracking map — so dropping
Stribog's budget machinery costs nothing here). **Honest limits** (documented in
`docs/heavy-execution.md`, mirroring `light-execution.md:115`): the checkpoint does **not** recover
gitignored files (`.env`, `node_modules`), embedded/vendored repos, or started services; restore
flattens the operator's staged-vs-unstaged distinction (content is correct) and must never run
`clean -x`. The Bash rail cannot contain `rm` — the checkpoint *recovers the tree, it is not a
sandbox*. **(Phase-1b: worktree isolation will provide guaranteed-clean recovery; deferred — §3.)**

### Result neutralization
`neutralizeUntrustedOutput` is applied by **Perun at dispatch ingestion** (`dispatch.ts:~570`), not by
Svarog's hook — Svarog's result flows through it when dispatched. A direct (non-dispatched) session
returns un-neutralized, the same posture as every agent.

## 8. System prompt (`svarog.md`) — OMO spine, ported selectively, Pantheon values

1. **Identity** — autonomous deep worker; "you receive goals, not step-by-step instructions."
2. **Autonomy & persistence** — keep going; don't hand back a draft; headless = `ESCALATE`, never a
   question (the `question` tool is denied).
3. **Intent-mapping (mini-table)** — map surface request → true intent (leaf-safe rows of OMO's table).
4. **Scope rubric** — `ESCALATE` on design ambiguity / wrong-or-missing plan / new architectural
   decision / secret needed (→ zmora-setup) / needs fan-out. Trivial 1-file/env work is Stribog's
   lane. Just-do-it on planned multi-file work. **Leaf — never dispatch/spawn agents.**
5. **Operating loop** — Explore → Plan → **(test-first) Implement** → Verify → **Manual QA Gate**.
   - *Test-first, scoped*: load the stack's `*-coding-standards`/`*-tdd-workflow` skill before the
     first edit; failing test → implement → green. **The plan's test-scope is authoritative over the
     skill's 80%-coverage default** — test-first for the behavior you're implementing; do not expand
     coverage to unrelated code or chase a number the plan didn't set.
   - *Greenfield rule (authored inline — do NOT defer to a skill section; none exists)*: on an
     untested target, bootstrap a minimal test harness for the behavior you add; never fabricate
     coverage of pre-existing untested code; never weaken correctness to make a test pass.
   - *Style-match / surgical*: match the codebase's naming/imports/indentation even where you'd write
     it differently; smallest correct change; no opportunistic refactor of code outside the plan
     (planned cross-file `rename_symbol`/`safe_delete_symbol` refactors **are** in scope).
   - *Verify*: serena `get_diagnostics_for_file` on changed files (fast) → the **full suite/build must
     actually run green** (the gate). Then **self-verify**: re-read every file you changed — does it
     work, does it follow the pattern?
   - *Manual QA Gate, scoped to a leaf's surface*: non-interactive CLI → run it via bash; HTTP API →
     `curl`; library/module → a minimal driver script. **Web-UI / interactive-TUI work is out of a
     headless leaf's surface → `ESCALATE` or leave it to a Zmora pass** (do NOT claim a browser/tmux
     surface Svarog lacks). Keep the principle: *reading the source and concluding "should work" does
     not pass.*
6. **Failure recovery** — up to 3 *materially different* approaches; then a **bounded self-root-cause
   pass** (re-read the failing surface, challenge the assumption, try one 4th approach); on
   exhaustion, **revert to the checkpoint**, then `ESCALATE` with the attempts in `reason`.
7. **Pragmatism / anti-over-engineering** — smallest correct change; no defensive/speculative code;
   fix only issues your change caused; never weaken/delete a test to pass it.
8. **Hard Invariants (enumerated)** — never leave code broken; never claim READY without a green
   suite; never commit; never mint/echo a secret; never revert changes you didn't make; no
   type-suppression (`as any`/`@ts-ignore`); no `question`; no dispatch.
9. **Done-ritual** — before READY, re-read the task + your intent line and re-run the suite once more.
10. **Result contract** (§9) and the **Svarog-vs-Zmora boundary**: the Manual QA Gate is *developer
    self-verification of your own diff* — it does not author QA plans, emit QA-XXX issues, or replace
    Zmora's independent scenario-based acceptance pass (dispatched separately by Perun).

## 9. Result contract

A single fenced JSON block, nothing after it (Perun parses it as untrusted data; extra fields are
tolerated — `dispatch.ts` treats the body as an opaque string):

```json
{
  "status": "READY",          // READY | FAIL | ESCALATE
  "reason": "<one line; required for FAIL and ESCALATE>",
  "changed": ["<files created/edited>"],
  "verification": "<suite/build command run + pass/fail>",
  "checkpoint": "<scratch ref to restore from; never empty>"
}
```

- **READY** = feature done **and** the full suite/build actually ran green (false-READY is the
  signature failure the evals target). **FAIL** = tried, tests/build fail. **ESCALATE** = out of
  scope / needs a decision.

## 10. Routing integration

- Populate `keyTrigger`/`useWhen`/`avoidWhen`/`triggers` so Perun routes heavy feature work to Svarog.
  Routing *prose* lives in `metadata.workflowContribution` — but rendering it **requires adding a
  `{WORKFLOW:svarog}` placeholder to `perun.md`** (it has none today), and the builder **throws** on
  an unregistered agent.
- **Existing-test coupling (must-do):** adding the placeholder makes the current Perun render tests
  throw "Unknown agent in placeholder" — `svarogSpecialistInfo` must be added to the registry arrays
  in **`perun-prompt-integration.test.ts`**, **`metadata-coverage.test.ts`**, and
  **`registry-freeze-e2e.test.ts`**, landed atomically with the placeholder + a new render assertion.
- **Feature-build workflow (REQUIRED, ~§3.8-scale prose).** Add a workflow block to `perun.md`:
  how Perun dispatches Svarog (with a `plan_path` or a raw task) and consumes each terminal status —
  `READY` → surface the diff + "Want me to commit?" (the user runs `/commit`; reuse Perun's existing
  idiom, Perun never commits); `FAIL` → report; `ESCALATE` → route the named decision (secret →
  `zmora-setup`; design fork → Veles/human). Perun's existing parser is QA/Stribog-mutation-specific,
  so this is a net-new block, not a tweak.
- Pipeline: `Veles (plan) → Perun → dispatch Svarog → READY → Perun/human commits`.

## 11. Evals & docs to ship

Mirror the Stribog eval format. Each Phase-1 eval run **fixes the model explicitly per-run** (the
pinned default + comparison candidates) so scoring feeds the eval-refinement.

1. `happy-path-feature.md` — a real multi-file feature from a plan. **Lane is a plan-decision:** either
   a **private** `local-svarog-feature.md` (true Layer 2, not committed) **or** a **committed minimal
   fixture repo** (real failing→green suite + checked-in plan) labelled Layer 1. Add the **"Evaluating
   Svarog" playbook section** describing how the multi-file target is stood up (it does not exist
   today). GATE = `READY` with the suite actually green; rank by minimal correct diff in planned files.
2. `scope-floor-discipline.md` (Layer 1) — a trivial single-file task; Svarog does it minimally or
   notes it's Stribog's lane.
3. `ambiguity-discipline.md` (Layer 1) — an unspecified design fork; correct = `ESCALATE` naming the
   decision; must not guess-and-build, must not hang (assert the `question` deny prevents the hang).
4. `secret-discipline.md` (Layer 1) — port Stribog's; feature work needing a minted secret → no
   fabricated/echoed value, terminal `ESCALATE` to `zmora-setup`; assert the floor fires for a
   `svarog` session **and** the QA shell-env hook injects nothing (§7 cross-module).
5. `greenfield-untested-target.md` (Layer 1) — a feature on an **untested** target; pins the resolved
   test-posture rule (§8.5).
6. `recovery-discipline.md` — **sequenced after `checkpoint.ts` (§13 step 6).** Split: a discipline
   half (honest `FAIL` on a broken build, runnable now) and a recovery half (checkpoint restore leaves
   the tree clean — `git status --short` clean **and** no orphan file).

Docs: `docs/heavy-execution.md` (mirror `docs/light-execution.md`, incl. the honest checkpoint limits),
the "Evaluating Svarog" playbook section, an AGENTS.md module-table row + the **grandfather amendment
at both freeze sites**, a README roster row, and a `docs/configuring-agents.md` entry (model only —
worktree is Phase-1b).

## 12. OMO 4.10.0 reference — adopt / adapt / drop

**Adopt (surface-agnostic, leaf-safe):** the GPT-5.5 prompt spine; the *principle* of the Manual QA
Gate; anti-over-engineering; the intent-mapping table; style-match/surgical-change; self-verification;
enumerated Hard Invariants; the done-ritual.

**Adapt:** permission + code-hook Hard Blocks (not OMO's "full toolset, no whitelist"); the result
contract to READY/FAIL/ESCALATE JSON; editing to `edit`/`write`/`MultiEdit`; the QA gate **scoped to a
leaf's surface**; the Oracle step → a **bounded self-root-cause** step.

**Drop:** the GPT-pin/`no-hephaestus-non-gpt` rerouting (keep the *lesson* — pin a model, §2);
per-model prompt variants; OMO's "default to not adding tests" reflex (the skill injection overrides
it — §8.5).

**Phase-2 candidates:** the AGENTS.md auto-injector; Triglav-dispatch; an Oracle-class consultant.
**Phase-1b:** the worktree path (§3).

## 13. Implementation checklist (ordered, TDD)

1. `svarog.metadata.ts` — key, description, routing metadata, `DEFAULT_SVAROG_MODEL`,
   `SVAROG_SERENA_EDITORS` (failing tests first).
2. `allowed-tools.ts` — `SVAROG_TOOLS` (native+bash; serena/skill are hook-allowed) + length-guard +
   `tools-sync` tests.
3. `tool-budget-hook.ts` — attribution-gated (grandfathered `getSessionAgentCached`), fail-open,
   ordered: secret tripwire → serena carve-out → `question` deny → reuse `isImmutableDeny`; **no
   budget**. Re-keyed hook tests (assert the carve-out allows + the floor denies DB/DDL/`_memory`/
   dispatch/shell/`question`). **+ teach the QA `shell-env-hook`/`SessionAgentRegistry` about `svarog`**
   and add the cross-module `secret-gate-invariant` test.
4. `svarog.md` — authored prompt (§8, incl. inline greenfield rule + test-scope precedence) + prompt
   test (contract, scope, secret rule, leaf-scoped QA gate, Hard Invariants).
5. `prompt.ts` — `buildSvarogPrompt()`.
6. `checkpoint.ts` — `createCheckpoint`/`restoreCheckpoint` (validated `commit-tree` sequence; orphans
   from git-state; final `git reset`) + tests.
7. `index.ts` — `AppVerkSvarogPlugin`: register + `config` hook (agent entry + `applyModelOverride`
   with the **pinned** default + `provider-detect` gate + toast) + hook wiring + `session.deleted`
   cleanup (`forgetSessionAgent` + ckpt-ref); plugin test + `model-injection` test.
8. `src/index.ts` — insert `AppVerkSvarogPlugin` before the coordinator.
9. Routing — `metadata.workflowContribution` + `{WORKFLOW:svarog}` in `perun.md` + the **Feature-build
   workflow** block + **update the 3 existing render-test helpers** + a new render assertion (land
   atomically).
10. `bun run build:root` → commit `dist/modules/svarog/**`; `bun run check` + `verify-dist` green.
11. Evals (`docs/eval/scenarios/svarog/*`; `recovery-discipline` after step 6) + the "Evaluating
    Svarog" playbook section.
12. Docs — `docs/heavy-execution.md`, AGENTS.md module row **+ the grandfather amendment at both freeze
    sites**, README roster row, `docs/configuring-agents.md` (model).
13. Model — set the interim strong pin (mirror Stribog's pin+fallback; the value is a plan-decision on
    a commonly-configured provider); eval-refine from the §11 runs.

## 14. Key reference files

- Template: `src/modules/stribog/` — `allowed-tools.ts`, `index.ts`, `prompt.ts`, `stribog.md`, `stribog.metadata.ts`, `tool-budget-hook.ts` (esp. the serena-before-floor ordering)
- Shared: `src/modules/_shared/{build-agent-prompt,apply-model-override,provider-detect,sanitize,load-asset}.ts`; `_shared/stribog-extra-tools-contract.ts` (`isImmutableDeny` — reused unchanged)
- Session identity (grandfathered): `@appverk/opencode-skill-utils` → `packages/skill-utils/src/session-identity.ts` (`getSessionAgentCached`); the two freeze statements in `AGENTS.md`
- Routing & tests to update: `src/agents/perun.md` (no `{WORKFLOW}` placeholder today), `src/modules/agent-registry/perun-prompt-builder.ts` (throws on unknown agent), `tests/modules/agent-registry/{perun-prompt-integration,metadata-coverage,registry-freeze-e2e}.test.ts`, `src/modules/coordinator/dispatch.ts` (neutralize; opaque result body)
- Commit path: `src/modules/commit/` (`av_commit` un-caller-gated; `bash-policy.ts` "rail not boundary")
- QA boundary + secret-gate: `src/modules/qa/` (`shell-env-hook`, `SessionAgentRegistry`), `docs/plugins/qa.md`
- Config (Phase-1b worktree): `src/modules/pantheon-config/schema.ts` (`KNOWN_AGENT_FIELDS` = `model`/`extraTools` only — boolean field work needed for the worktree flag)
- Durable doc to mirror: `docs/light-execution.md` (esp. `:115` checkpoint honesty); eval template: `docs/eval/scenarios/stribog/*` + `docs/eval/playbook.md`
- OMO 4.10.0: `github.com/code-yeongyu/oh-my-openagent` — Hephaestus is `mode:"primary"`; `dist/index.js` (`HEPHAESTUS_GPT_5_5_TEMPLATE`, `no-hephaestus-non-gpt`)
