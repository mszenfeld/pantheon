# AppVerk OpenCode Plugins — Agent Guide

This is an **OpenCode plugin monorepo** that bundles multiple workspace plugins (a Python `/python` workflow, a TypeScript + React `/frontend` workflow, a Swift `/swift` workflow, a `/review` code review workflow, and shared `skill-utils` helpers), plus absorbed modules under `src/modules/<name>/` (currently: `commit`, `qa` — the `/qa:create-plan` + `/qa:run` workflow with the `zmora` logical agent, `pantheon-config` — the harness configuration library, `coordinator` — the Pantheon `@perun` primary agent with `dispatch_parallel`, `assign_issue_ids`, `compute_waves`, and the background-dispatch tools `dispatch_background` / `poll_background` / `wait_background`, `stribog` — the light-execution actuator subagent, and `svarog` — the heavy/main code-executor subagent) and a Pantheon session-notification hook (`src/hooks/session-notification/`). The root package re-exports all of them and handles plugin merging.

## Monorepo Layout

| Path | Role |
|------|------|
| `src/index.ts` | **Root entrypoint** (TypeScript source) — loads built outputs from all workspace packages plus absorbed modules under `src/modules/`, merges their tools/hooks. Built into `dist/index.js` for runtime. |
| `src/modules/commit/` | Absorbed commit plugin — TS source only. Registers the sanctioned git-mutation surface as three plugin tools: `av_commit` (controlled commit), `create_branch` (convention-validated branch creation + same-commit checkout), and `create_pr` (validated push + `gh`-backed PR creation, with partial-success reporting) — together the executor publish chain. `create_branch`/`create_pr` match the hooks' immutable-deny `create_` verb and are allowed by named, attribution-gated carve-outs; `av_commit` is not floor-denied and is carved out of Stribog's allow-list gate instead. Perun alone gets a narrow, explicitly authorized local-commit exception: the default-disabled `APPVERK_PERUN_COMMIT_CONSENT=enabled` flow binds a displayed Git snapshot and fresh transcript consent to one opaque authorization; disabled mode retains its internal exact-file policy. Identity fails closed, unrelated index entries remain untouched, and merge/cherry-pick commits require authorized/index equality. Git-proven deletions and both rename paths are supported; commit-module code denies Perun branch creation and publication. Bash `git commit`/`git push` stay blocked by `bash-policy.ts`. Specs: `docs/specs/create-branch-tool-2.md`, `docs/specs/create-pr-tool.md`. Asset: `src/commands/commit.md`. Tests: `tests/modules/commit/`. Built into `dist/modules/commit/` and `dist/commands/`. |
| `packages/python-developer` | Python-developer plugin source, tests, skills, build scripts. Output shipped at `packages/python-developer/dist/`. |
| `packages/code-review` | Code-review plugin source, tests, agent prompts, command templates, skill-agents, build scripts. Output shipped at `packages/code-review/dist/`. All agents and commands automatically load the `standards-discovery` skill during pre-analysis to discover project-specific standards before reviewing. |
| `packages/frontend-developer` | Frontend-developer plugin source, tests, skills, build scripts. Output shipped at `packages/frontend-developer/dist/`. |
| `packages/skill-utils` | Shared helpers for creating skill-based plugins (`createSkillPlugin`). Its legacy `session-identity.ts` and `coordinator-bash-policy.ts` exports remain as self-contained compatibility copies for external consumers, kept in sync with the harness-owned canonical implementations in `src/modules/_shared/`. Output shipped at `packages/skill-utils/dist/`. |
| `packages/skill-registry` | Global skill registry — scans skill folders, parses frontmatter, registers unified `load_appverk_skill` tool, injects activation rules into every agent's system prompt. Output shipped at `packages/skill-registry/dist/`. |
| `src/modules/qa/` | Absorbed QA plugin — TS source only. Assets: `src/commands/{create-qa-plan,run-qa}.md`, `src/skills/qa/**`, `src/modules/qa/prompt-sections/{core,overlay-fe,overlay-be,overlay-setup}.md`. Registers three `zmora-{fe,be,setup}` subagent variants composed via `prompt-builder.ts` (overlay-setup.md joins overlay-fe/overlay-be on top of `core.md`); logical agent name `zmora` everywhere user-facing. Also registers the `parse_plan` (Perun-only, populates per-run recipe AST from the plan's `## Setup` → `**Bindings:**` block), `execute_recipe` (zmora-setup only, mints/refreshes bindings), and `record_input` (Perun-only, captures user-pasted `NAME=value` inputs) plugin tools, plus the `shell.env` hook that injects per-parent bindings into child shells, the `BindingsStore` / `scrubSecrets` pipeline, and a periodic TTL sweep that purges expired (non-pinned) entries. Tests: `tests/modules/qa/`. Built into `dist/modules/qa/`, `dist/commands/`, `dist/skills/qa/`. |
| `src/modules/explore/` | Absorbed explore plugin — TS source only. Registers the `triglav` read-only explorer subagent (`mode: "subagent"`) and calls `registerAgentMetadata()` so Perun can route to it. Semantic search is gated on the optional serena MCP; if serena is absent the agent still registers but runs in degraded mode (Grep/Glob) and emits a one-time warning toast on `session.created`. Tests: `tests/modules/explore/`. Built into `dist/modules/explore/`. |
| `src/modules/stribog/` | Absorbed light-executor module — TS source only. Registers the `stribog` actuator subagent (`mode: "subagent"`) and calls `registerAgentMetadata()` so Perun can route to it; pins an eval-picked default (`openai/gpt-5.4`), overridable via `agents.stribog.model`. The pinned default is **provider-gated** (`_shared/provider-detect.ts`): if the `openai` provider the default needs is absent (fresh subscription/Anthropic install), the default is skipped (stribog inherits the session default) and a one-time warning toast fires on `session.created` — user/pantheon overrides are unaffected and still win. Deny-by-default actuator allow-list: Read/Glob/Grep + Edit/Write + Bash for docker / make / package-managers (npm/pnpm/bun/uv) / curl + read-only git (`log`/`blame`/`status`/`diff`) + the sanctioned commit-module publish chain (`av_commit`/`create_branch`/`create_pr` via attribution-gated hook carve-outs — 2026-07-22 executor-chain decision). Intentionally has **no** `execute_recipe`/secret-minting (minter ≠ actuator — that stays with `zmora-setup`), **no** dispatch/`Task` (it is a leaf, never fans out), and **no** `rm`. Asset: `stribog.md`. Tests: `tests/modules/stribog/`. Built into `dist/modules/stribog/`. |
| `src/modules/svarog/` | Absorbed heavy/main executor module — TS source only. Registers the `svarog` code executor subagent (`mode: "subagent"`) and calls `registerAgentMetadata()` so Perun can route to it; pins the strongest OpenAI-subscription GPT tier (`openai/gpt-5.5`), overridable via `agents.svarog.model`. The pinned default is **provider-gated** (`_shared/provider-detect.ts`): if the `openai` provider is absent, the default is skipped (svarog inherits the session default) and a one-time warning toast fires on `session.created` — user/pantheon overrides are unaffected. Allow-by-default hook reusing `isImmutableDeny` floor (no `execute_recipe`, no dispatch, no shell/exec, no serena memory writes) + serena-editor carve-out (allows the refactor editors `replace_content`/`replace_symbol_body`/`rename_symbol`/etc. before the floor would deny them) + bash secret-generation tripwire. In-tree `commit-tree` recovery checkpoint auto-created before the first edit (`refs/svarog/ckpt/<sessionID>`); restore is **manual** (operator/Perun calls `restoreCheckpoint`). Leaf (never dispatches); no `question` (headless → `ESCALATE`); finishes at `READY` — commits only via the sanctioned `av_commit` publish chain (`create_branch` → `av_commit` → `create_pr`; 2026-07-22 executor-chain decision), never bash `git commit`/`push`. Asset: `svarog.md`. Tests: `tests/modules/svarog/`. Built into `dist/modules/svarog/`. |
| `src/modules/plan/` | Absorbed planning module — TS source only. Registers the planning agent under the display/dispatch name `Veles - Planner` (`mode: "all"`, user-switchable AND Perun-dispatchable via `DISPATCHABLE_ALL_AGENTS`; the pantheon-config slug stays `agents.veles`) and calls `registerAgentMetadata()` so Perun can route to it. Veles supports three modes: feature spec (`docs/specs/`), implementation plan (`docs/plans/`), and QA test plan (`docs/testing/plans/`). Asset: `veles.md`. Opt-in dispatch tools via `config.agent.tools` (`dispatch_parallel`/`dispatch_background`/`poll_background`/`wait_background`). Serena-gated: if serena MCP is absent the agent still registers but runs in degraded mode (Grep/Glob) and emits a one-time warning toast on `session.created`. Tests: `tests/modules/plan/`. Built into `dist/modules/plan/`. |
| `packages/swift-developer` | Swift-developer plugin source, tests, skills, build scripts. Output shipped at `packages/swift-developer/dist/`. |
| `src/modules/agent-registry/` | Harness-resident **library** (no plugin export) — process-wide `SpecialistInfo` registry. Exposes `registerAgentMetadata()` (fail-fast on a conflicting duplicate logical name; idempotent on identical re-registration; **fail-fast on a NEW registration after the registry is snapshotted** — enforces the "register before the coordinator" ordering invariant) / `getAgentMetadataRegistry()` (returns a name-sorted copy) / `snapshotAgentMetadataRegistry()` (name-sorted copy **+ freezes** the registry; called once by `coordinator/` when it builds and caches Perun's prompt), and the `buildPerunPrompt` placeholder renderer that fills Perun's prompt template from the registered specialists. Agent-registering modules call `registerAgentMetadata()` in their factory bodies; `coordinator/` consumes the registry via `buildPerunPrompt` when it builds Perun's prompt. Tests: `tests/modules/agent-registry/`. Built into `dist/modules/agent-registry/`. |
| `src/modules/agent-roster/` | Harness-resident roster module — owns the visible agent roster. Exposes `applyRosterPolicy()` (mutates `config.agent` in place: snapshot-diff hides pre-existing user/project agents, the `NATIVE_BUILTINS` backstop hides native visible-primary built-ins via override-by-key, then a `default_agent` guard repoints any hidden/subagent default to a visible session target — preferring `Perun - Coordinator`), the `NATIVE_BUILTINS` constant (`build`, `plan` — re-verify against the actual picker on opencode bumps), and the `getDefaultAgent()` / `setDefaultAgent()` accessors that localize the cast for the v1-SDK-absent `default_agent` field. Also exports `AppVerkAgentRosterPlugin` — a conservative **startup self-check** that, on first `session.created`, enumerates the runtime's actual agent map (`client.app.agents()`) and warns (one-shot toast + stderr, best-effort, never throws/mutates) when a native visible-primary key (`mode!=="subagent" && !hidden`) is NOT covered by `NATIVE_BUILTINS` — the drift alarm for the one manual touchpoint when an opencode bump adds a new native primary. The detection core is the pure `findUncoveredNatives()` (testable without driving the event hook). Consumed by `src/index.ts` (calls `applyRosterPolicy` in its `config` hook AND registers `AppVerkAgentRosterPlugin`) and `coordinator/` (imports `COORDINATOR_AGENT` + the `default_agent` accessors). Tests: `tests/modules/agent-roster/`. Built into `dist/modules/agent-roster/`. |
| `src/modules/coordinator/` | Absorbed coordinator plugin — TS source only. Asset: `src/agents/perun.md`. Registers `dispatch_parallel` (worker pool, concurrency 4, cap 4 — chunk larger workloads), `assign_issue_ids`, and `compute_waves` tools alongside the `@perun` primary agent. Also registers the **background-dispatch** tools `dispatch_background` / `poll_background` / `wait_background` (non-blocking, within-turn overlap; `session.promptAsync` fire-and-forget + a factory-scoped in-memory `BackgroundTaskStore`, per-session cap 4, `session.deleted` cleanup). Perun remains a strict orchestrator except for one explicitly authorized, terminal `av_commit` attempt with confirmed exact files; it is local-only and cannot lead to branching, push, or PR creation. The exported `PERUN_TOOLS` constant lists every coordinator tool, while the cross-module `av_commit` grant is synchronized separately with perun.md's `allowed-tools` frontmatter. Tests: `tests/modules/coordinator/`. Built into `dist/modules/coordinator/` and `dist/agents/`. |
| `src/modules/coordinator-policy/` | Absorbed coordinator-policy plugin — TS source only (no `.md` asset). Registers a `tool.execute.before` **bash gate** (`makeBashGate`) that enforces an allowlist on `bash` calls — but **only** when the session is positively identified as the coordinator (`getSessionAgent(...) === COORDINATOR_AGENT_NAME`). **Fail-OPEN on identity uncertainty:** if the agent can't be resolved the gate does nothing, so non-coordinator sessions are never blocked. The allowlist is read at plugin-init from `src/agents/perun.md` frontmatter (`Bash(<prog>:*)` entries — single source of truth) by `read-allowlist.ts`, with a hardcoded `FALLBACK_ALLOWLIST` (`mkdir`, `ls`) used when the frontmatter can't be read/parsed (the `qa-preflight.sh` grant was intentionally dropped in favor of the `preflight` plugin tool — the coordinator must not get a shell script; guarded against drift by `read-allowlist.test.ts`). Classification logic (`classifyCoordinatorBash` + compound-shell rejection) and the rejection error (`buildViolationError`) live in `src/modules/_shared/coordinator-bash-policy.ts`. Tests: `tests/modules/coordinator-policy/`. Built into `dist/modules/coordinator-policy/`. |
| `src/modules/pantheon-config/` | Harness-resident **library** (no plugin export) — reads `pantheon.json` (user-global + per-project walk-up, closest-wins merge) and exposes `loadPantheonConfig()` / `getLoadErrors()` / `pantheonConfigEmpty()`. Consumed by `coordinator/` and `qa/` in their `config` hooks. Tests: `tests/modules/pantheon-config/`. Built into `dist/modules/pantheon-config/`. |
| `src/modules/_shared/` | Cross-module helpers (non-exhaustive): `loadModuleAsset` (sibling markdown loading under tsup's `bundle: false` layout), `buildAgentPrompt` (`build-agent-prompt.ts` — the shared subagent-prompt builder used by `stribog`/`explore`/`plan`), `neutralizeUntrustedOutput` + `deriveReportPath` (`sanitize.ts` — the untrusted-output sanitizer SSOT), `SessionAgentRegistry` (childSessionID → agentName), `register/getDispatchExtensions` (QA publishes scrubberFactory + registry that coordinator reads at dispatch time), and `serena-detect` (`isSerenaAvailable` — the optional-serena gate shared by `explore` + `plan`). Consumed by `coordinator/`, `qa/`, `explore/`, and `plan/`. |
| `src/hooks/session-notification/` | **Harness-resident plugin** (not a workspace package) — Pantheon session-notification hook that triggers macOS desktop notifications on OpenCode session events. Source `.ts` and built `.js`/`.d.ts` are colocated and shipped together as part of the root `src/` tree. |

**Important:** `dist/` is usually ignored, but the **root `dist/`** and **`packages/*/dist/`** are committed and published (see `.gitignore`). Do not delete those `dist/` trees.

## Prerequisites

**Required:** Bun >= 1.3.13. Install:

```bash
curl -fsSL https://bun.sh/install | bash
```

This project uses Bun exclusively for installation and script execution. Do NOT use `npm`, `yarn`, or other package managers — a `preinstall` guard in root `package.json` (`scripts/check-package-manager.mjs`) rejects non-bun runners. The guard is a UX hint, not a security control (`npm_config_user_agent` is spoofable); real enforcement is via the `packageManager` field and these docs.

`.bun-version` pins the toolchain version for version managers (mise/asdf/proto auto-switch to 1.3.13 when entering the repo).

## Pantheon harness configuration

Per-agent model selection lives in `pantheon.json`. See [`docs/configuring-agents.md`](docs/configuring-agents.md) for the user-facing reference.

## Commands

```bash
# Full validation (run this before pushing)
bun run check          # typecheck + test + build

# Individual steps
bun run typecheck      # tsc --noEmit at root + each workspace
bun run test           # vitest at root + each workspace
bun run build          # tsup ESM + DTS for all packages
```

### Per-package commands

Each workspace package has its own `typecheck`, `test`, and `build` scripts. Tests import from `dist/` (not `src/`), so **build is required before test**:

```bash
bun --filter @appverk/opencode-python-developer build
bun --filter @appverk/opencode-python-developer test
```

**Note:** bun's `--filter` takes the script name directly (e.g., `bun --filter X build`). The form `bun --filter X run build` returns `No packages matched the filter` because bun parses `run` as the script target. The alternate form `bun run --filter X build` (run BEFORE filter) is also documented-valid; we use the canonical `bun --filter X SCRIPT` form throughout this project.

Note: absorbed modules (e.g. `src/modules/commit/`) build and test via the **root** `bun run build:root` / `bun run test` — they no longer have a per-workspace script.

### skill-utils build dependency (intentional)

Root `typecheck`, `test`, and `build` all invoke `bun run build:skill-utils` early in their chains. This is because other workspace packages typecheck and import against `packages/skill-utils/dist/*.d.ts` — so skill-utils must be built first, BEFORE other workspaces can typecheck.

The `build:skill-utils` script is exposed as a named root script (not inlined) so this side-effect is intentional and discoverable, not hidden chain magic. When adding a new workspace that imports from skill-utils, no script changes are needed — the dependency is already encoded.

### skill-utils package boundary

`packages/skill-utils` contains the packaged `createSkillPlugin` helper used by the three developer plugins. Its legacy `session-identity.ts` and `coordinator-bash-policy.ts` exports remain as self-contained compatibility copies for external package consumers (kept in sync with the canonical implementations in `src/modules/_shared/` — duplication is deliberate, because the import boundary is frozen in both directions), but new harness code must use the canonical implementations in `src/modules/_shared/`.

`COORDINATOR_AGENT` is re-exported from the canonical `COORDINATOR_AGENT_NAME` binding in `src/modules/_shared/session-identity.ts`; the sync test protects that alias.

**Import direction is FROZEN:** no `src/modules/` file may import from `@appverk/opencode-skill-utils`. New harness modules needing coordinator identity or bash policy must import from `src/modules/_shared/`.

## Build & Packaging Details

- **Module system:** ESM only (`"type": "module"`, NodeNext resolution).
- **Package builds:** `tsup src/index.ts --format esm --dts --clean`. The `--clean` flag (tsup defaults to `clean: false` on the CLI) wipes each package's `dist/` before emitting, so renamed/deleted source files cannot leave orphaned `.js`/`.d.ts` artifacts. This mirrors the root config's `clean: true`. **Keep `--clean` on every package build** — without it `verify-dist-sync` structurally cannot detect orphans (it diffs `git status` after a rebuild, which only fires when a build *changes/removes* a tracked file; a stale asset whose source was deleted stays untouched and ships forever).
- **Post-build asset copying:** Each package runs a Node script to copy markdown templates/skills into `dist/` (e.g., `dist/commands/commit.md`, `dist/skills/*.md`) via the shared `scripts/copy-assets.mjs`. For `dir`/`glob` manifest entries the helper removes the destination dir before copying (belt-and-braces orphan-proofing for renamed/deleted skill `.md` files when the copy script runs without a preceding `tsup --clean`).
- **Root entrypoint:** `src/index.ts` is the typed source. The root build (`bun run build:root`) compiles it (and everything under `src/`) to `dist/` via `tsup --bundle=false`. OpenCode loads `./dist/index.js` (the `main` field in root `package.json`). There is no longer a hand-edited `src/index.js`.
- **Published files:** The root `dist/` tree (compiled `.js`/`.d.ts` + copied `.md` assets — this is where every absorbed module under `src/modules/` lands) plus the remaining `packages/*/dist/` directories for each workspace plugin — see root `package.json` `files` for the canonical list.

### Tracked dist paths in CI

`scripts/verify-dist-sync.mjs` is the **source of truth** for which `dist/` trees are checked for drift after `bun run build`. The `trackedDistPaths` array in that script must stay in sync with:

- The `files` array in the root `package.json` (everything published must be verified).
- The `.gitignore` carve-outs for each `packages/<name>/dist/` (everything verified must be committed).
- The per-workspace `build` invocations in the root `build` script (everything verified must actually be built).
- The `git diff --exit-code` path list in the **"Assert no dist drift"** step of `.github/workflows/ci.yml` (the belt-and-braces backstop must cover the same trees).

When adding a new workspace plugin, update **all five** locations together. If any are out of sync, CI will either silently pass on dist drift (path missing from the script/workflow) or fail permanently (path tracked but never built/committed).

### Continuous integration

CI lives in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and is the layer the dist-sync and version-tag guards plug into:

- **`check` job** (on every push and pull request to `master`): pins Bun via `.bun-version`, runs `bun install --frozen-lockfile` → `bun run check` (typecheck + test + build) → `bun run verify-dist`, then a `git diff --exit-code` backstop on the tracked dist paths. This is what makes "CI silently pass / fail permanently" (above) describe a real workflow rather than an aspiration.
- **`version-tag` job** (only on pushed `v*` tags): runs `bun run verify-version-tag` (root `package.json` version ↔ reachable git tag) and `bun run verify-versions` (`scripts/verify-workspace-versions.mjs` — all workspace `package.json` versions plus every documented install pin must equal `v<root-version>`). See [Versioning & Git Installation](#versioning--git-installation).

The release-time canonical-remote check (`verify-version-tag --remote=<name>`) is intentionally **not** wired into the workflow because the canonical install remote is unsettled (origin redirect trap, see [Versioning & Git Installation](#versioning--git-installation)). Add `--remote=<name>` to the `version-tag` job only after that decision is made.

### QA preflight tool

QA preflight is a **plugin tool**, not a shell script. `@perun` declares `preflight` in its `allowed-tools` (see `src/agents/perun.md:5`) and invokes it at Step 3.5 via `preflight({ env: [...] })`; the handler lives in `src/modules/qa/preflight.ts`. There is intentionally no `scripts/qa-preflight.sh` — the coordinator's `Bash` allowlist is `mkdir`/`ls` only and cannot run the piped probe the old script required (see `src/agents/perun.md:522`: "Preflight is the `preflight` tool, not a shell script").

The tool checks only env-var **presence**: a name is "resolvable" if it is bound in the run's `BindingsStore` (user-pasted via `record_input`, or minted) or set to a non-empty value in the OpenCode process env. It returns `{status:"ok"}` or `{status:"missing", missing:[...]}` and never echoes variable values, keeping secrets out of the session transcript. Service / database *liveness* is deliberately NOT probed here — that is left to the per-scenario `NEED_INFO` backstop at dispatch time (see `src/agents/perun.md:100`).

Because preflight is now a tool rather than a CWD-relative script path, there is no working-directory assumption tied to it.

## TypeScript Configuration

- `tsconfig.base.json` sets `target: ES2022`, `module: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`.
- Each package extends the base and includes `src/**/*.ts`, `tests/**/*.ts`, `vitest.config.ts`.
- Vitest uses globals mode (`types: ["vitest/globals"]`).

## Testing Conventions

- **Root tests:** `tests/root-plugin.test.ts` validates plugin merging and packaging via `bun pm pack`.
- **Package tests:** Located in `packages/*/tests/**/*.test.ts`.
- **Integration tests:** `tests/modules/commit/controlled-commit.integration.test.ts` exercises real git operations.
- All workspace vitest configs use `include: ["tests/**/*.test.ts"]`.

## Root Entrypoint Registration

Every new plugin must be imported and registered in `src/index.ts`. The build (`bun run build:root`) produces `dist/index.js` from it; nothing is hand-edited under `dist/`.

### Workspace plugin import

```typescript
import { AppVerkNewPlugin } from "../packages/<name>/dist/index.js"

const defaultPluginFactories: Plugin[] = [
  AppVerkPythonDeveloperPlugin,
  AppVerkCodeReviewPlugin,
  AppVerkNewPlugin,  // <-- add here
]
```

### Absorbed module import

For plugins absorbed into `src/modules/<name>/`:

```typescript
import { AppVerkCommitPlugin } from "./modules/commit/index.js"
```

### Harness-resident hook import

For hooks under `src/hooks/<name>/`:

```typescript
import { AppVerkPantheonPlugin } from "./hooks/session-notification/plugin.js"
```

All three patterns import a built `.js` file at runtime (Node ESM resolution). For workspace plugins, the built file lives in `packages/<name>/dist/`. For absorbed modules and hooks, the build emits to `dist/modules/<name>/` and `dist/hooks/<name>/` — referenced via the source-side `.js` extension which Node resolves at runtime.

## Agent Visibility (`mode` + roster policy)

Picker visibility is governed by two layers: the per-agent `mode` property and
the harness-owned roster policy (see [Roster policy](#roster-policy--the-harness-owns-the-picker)
below). Start with `mode`:

- **`mode: "primary"`** — User-facing agent. Appears in tab-completion and is
  intended for direct user interaction. Use this for agents that users invoke
  directly, such as `python-developer`.
- **`mode: "subagent"`** — Hidden agent. Excluded from tab-completion;
  intended to be invoked programmatically by commands or other agents. Use this
  for skill-agents and background workers, such as `fix-auto` or
  `security-auditor`.

If `mode` is omitted, OpenCode defaults to `"all"` (visible everywhere). Always
set an explicit `mode` when registering an agent to avoid unnecessary
tab-completion noise or accidentally hiding user-facing agents.

### Roster policy — the harness owns the picker

`mode` is **not** the only thing that governs picker visibility. The picker
filter is `mode !== "subagent" && !hidden`, so a `hidden: true` flag removes an
agent from the picker **regardless of its `mode`** — a user's `mode: "primary"`
agent no longer appears once it is hidden. The harness sets that flag on every
key it did not register itself, so the displayed roster is exactly the harness's
agents and nothing else.

- **What gets hidden.** Every `config.agent` key the harness did not register
  (i.e. user/project agents discovered from `.opencode/agent/*.md`), plus the
  native visible-primary built-ins `build` and `plan`.
- **Mechanism.** `applyRosterPolicy(config, preExisting)`
  (`src/modules/agent-roster/index.ts`) is invoked from the **merged `config`
  hook** in `src/index.ts`, **after** the per-module config loop has run.
  `preExisting` is a snapshot of `config.agent` keys taken **before** the loop —
  the user/project agents. Anything the harness modules add during the loop is,
  by construction, absent from that snapshot and therefore kept visible. The
  policy (1) hides every pre-existing key via a snapshot-diff, (2) hides
  `build`/`plan` via an override-by-key backstop, and (3) repoints
  `default_agent` to a visible primary so the runtime does not throw.
- **Why `hidden` and not `mode: "subagent"`.** Flipping `build`/`plan` to
  `subagent` would make them dispatchable (the dispatch preflight rejects
  `primary` targets but accepts `subagent`), and the backstop writes them
  model-less. `hidden: true` removes them from the picker without touching their
  `mode`, so they stay non-dispatchable.
- **`NATIVE_BUILTINS` is the one manual touchpoint.** `NATIVE_BUILTINS =
  ["build", "plan"]` is the hardcoded list of visible-primary natives. Native
  built-ins live in the runtime's **internal** agent map and are never present
  in `config.agent`, so the snapshot-diff cannot reach them — only the
  override-by-key backstop can. This list is verified against opencode 1.15.10's
  actual picker (not the SDK type enum); **re-verify it on every opencode bump.**
- **Drift self-check guards that touchpoint.** `AppVerkAgentRosterPlugin`
  (`src/modules/agent-roster/index.ts`, registered in `src/index.ts`) runs a
  one-shot check on first `session.created`: it enumerates the runtime's actual
  agent map via `client.app.agents()` and warns (toast + stderr) when a native
  whose `mode!=="subagent" && !hidden` is NOT in `NATIVE_BUILTINS` — i.e. a new
  native primary (e.g. `chat`) that would leak into the picker after an opencode
  bump. It is **conservative**: warn only, never mutates the roster or throws, so
  a stale list surfaces loudly without breaking startup. The pure detector is
  `findUncoveredNatives()`. This does not remove the manual re-verify duty above
  — it turns a silent regression into an audible one.
- **Load-path invariant.** Harness agents become visible by registering in the
  config-hook loop (added during the loop ⇒ absent from `preExisting` ⇒ kept).
  They are **not** surfaced through `.opencode/agent/*.md` auto-discovery — any
  agent that arrives via that path is treated as a user/project agent and
  hidden.

See [`docs/configuring-agents.md`](docs/configuring-agents.md) for the
user-facing view of which agents reach the picker.

---

## Documentation Checklist

When adding a new plugin, you MUST update both top-level and per-plugin documentation. An undocumented plugin is an unpublished plugin.

### `README.md` (root)

The README is harness-first (Pantheon agents + configuration). When you add a new piece:

1. **If it is user-facing in the harness** (a new primary agent, a new subagent surfaced through Perun, or a new configuration surface), add a short entry under "What you get today" and link to its detailed reference under `docs/`.
2. **If it is plumbing** (a new library module like `pantheon-config`, a new dispatch primitive, a hook), update `AGENTS.md`'s monorepo-layout table — do not add to the README. The README is not a system-architecture diagram.
3. **Durable planning artefacts** (feature specs, implementation plans, and their approved revisions) must be saved as versioned Markdown files under `docs/specs/` and `docs/plans/` respectively. Link to them from the agent/workflow documentation and from any implementation plan's `spec_path` field. Do not leave planning artefacts in temporary `docs/superpowers/` or uncommitted working files.

Do **not** maintain a plugin badge, a comprehensive command/agent table, or per-plugin marketing copy. Those constructs were retired with the harness pivot.

### `docs/<topic>.md` (harness reference)

For user-facing harness concerns (e.g. configuration, agent reference, workflow guides), write a dedicated topic doc directly under `docs/`. `docs/configuring-agents.md` is the first of these.

> Do **not** add new files under `docs/plugins/`. That tree is legacy and will be removed once the harness migration completes.

---

## Adding a New Plugin Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, and `tests/`.
2. Add the workspace name to root `package.json` `workspaces` (already `packages/*`).
3. **Import and register the new plugin factory in `src/index.ts`.** See [Root Entrypoint Registration](#root-entrypoint-registration) above.
4. Add the new `packages/<name>/dist/` path to root `package.json` `files`.
5. Update root `bun run build` / `bun run test` / `bun run typecheck` scripts to include the new workspace.
6. Add a smoke/packaging test in `tests/` or `packages/<name>/tests/`.
7. **Update `README.md` and contributor docs** following the [Documentation Checklist](#documentation-checklist). New user-facing harness surfaces get a topic doc under `docs/` (e.g. `docs/configuring-agents.md`); do **not** add new files under `docs/plugins/` (that tree is legacy).
8. **Update this `AGENTS.md`** — add a row to the monorepo-layout table; update published files count.
9. **Add a `.gitignore` exception** for the new package's `dist/` directory:
    ```gitignore
    !packages/<name>/dist/
    !packages/<name>/dist/**
    ```
    Then run `git add packages/<name>/dist/` so the built output is committed. Without this, installing the plugin from git will fail with `Cannot find module` because the consumer has no built files.

---

## Adding a New Absorbed Module

For small absorbed modules (no separate workspace), follow this pattern instead:

> **Design constraints carried over from the original src/ absorption program:**
> - **`bundle: false`** in `tsup.root.config.ts` — each module is compiled standalone so relative imports between modules keep working at runtime.
> - **Build-order matters:** the root build (`bun run build:root`) emits `dist/` from `src/` first; workspace package builds run afterwards. Modules that read assets from `dist/` (via `import.meta.url` resolution) rely on this ordering.
> - **The config filename is `tsup.root.config.ts`** (not the default `tsup.config.ts`) — this is intentional so workspace `tsup.config.ts` files are not picked up by the root build.
> - **FROZEN — no `src/modules/` file may import from `packages/skill-utils`.** Coordinator identity and coordinator bash-policy primitives live in `src/modules/_shared/`; import them from there. The legacy package exports remain only for backward compatibility with external package consumers.

1. Create `src/modules/<name>/` with `index.ts` and supporting `.ts` modules.
2. Place `.md` assets under `src/commands/`, `src/agents/`, or `src/skills/` (the layout `scripts/copy-root-assets.mjs` knows about).
3. Place tests under `tests/modules/<name>/`. Import sources via `from "../../../src/modules/<name>/<file>.js"`.
4. Import and register the plugin factory in `src/index.ts` (see [Root Entrypoint Registration](#root-entrypoint-registration)).
5. **If the module registers an agent Perun should route to**, call `registerAgentMetadata()` (from `src/modules/agent-registry/`) with the agent's `SpecialistInfo` in the module's factory body — otherwise the agent is invocable but invisible to Perun's routing (it never renders into Perun's prompt). **Ordering matters:** every agent must register *before* the coordinator builds Perun's prompt. `getPerunPrompt()` calls `snapshotAgentMetadataRegistry()` on its first call, which **freezes** the registry and caches the result, so any agent-registering module must appear *before* `AppVerkCoordinatorPlugin` in the `defaultPluginFactories` array in `src/index.ts`. This is now **enforced, not just documented**: a `registerAgentMetadata()` of a *new* agent after the snapshot throws (`Late agent registration after Perun prompt snapshot: <name>`), so a mis-ordered `defaultPluginFactories` crashes loud at startup instead of silently dropping the agent from Perun's view (idempotent re-registration of identical metadata is still allowed). The coordinator is registered after every agent-registering module precisely to satisfy this (non-agent plugins like `coordinator-policy` may follow it); place a new agent-registering module ahead of it (e.g. as `src/modules/explore/` does with `triglav`).
   - **If the agent is registered with `mode: "all"`** (user-switchable in the picker *and* Perun-dispatchable, like `Veles - Planner`), add its registered agent key to `DISPATCHABLE_ALL_AGENTS` in `src/modules/coordinator/dispatch.ts`. The dispatch preflight rejects `mode: "primary"` targets and accepts `subagent`s, but an `all` agent is dispatchable **only** if it is in that allowlist — omit this and Perun cannot route to it. (`subagent`-mode agents need no entry; they are dispatchable by default.)
6. **Wire the agent's model** in the module's `config` hook via the shared helper `src/modules/_shared/apply-model-override.ts` — do **not** hand-roll the `loadPantheonConfig().agents.<slug>?.model` block (that pattern was duplicated five times before the helper centralized it). At the top of the hook, snapshot any user `opencode.json` model with `captureUserModels(config, <agentKey(s)>)` **before** you wholesale-replace `config.agent[key]`; after registering the agent, call `applyModelOverride(config, "<slug>", <agentKey(s)>, <defaultModel?>, userModels)`. The `<slug>` is the `pantheon.json` `agents.<slug>` key (it may differ from the agent key — `plan`'s slug is `veles` but its key is `Veles - Planner`; `qa`'s `zmora` slug fans out to three `zmora-{fe,be,setup}` keys). Calling `applyModelOverride` also registers the slug as "known" so a typo in `pantheon.json` surfaces a diagnostic instead of silently doing nothing. Pass a `defaultModel` only to pin a tier (Stribog does); omit it to inherit the session default.
7. Build and test via root `bun run build:root` and `bun run check` — no per-package scripts.
8. Update `README.md` and this `AGENTS.md` per the [Documentation Checklist](#documentation-checklist). **If the agent is model-configurable** (any agent wired via step 6), also add a row to the "Available agents" table in [`docs/configuring-agents.md`](docs/configuring-agents.md) (Pantheon key → registered-as → description → model-configurable), and update the intro sentence and any agent-list copy there.

> **No `tests/root-plugin.test.ts` edit is needed for the packed-file assertions.** That test derives the expected packed file set from root `package.json` `files[]` plus a recursive directory walk, and `files[]` already lists the top-level `dist` tree — so a new module's `dist/modules/<name>/*` and `dist/commands/<file>.md` outputs are picked up automatically once `bun run build:root` emits them. (Adding `stribog` required no edit there.) Touch that test only if you add a brand-new top-level published path to `files[]` — see [Tracked dist paths in CI](#tracked-dist-paths-in-ci).

## Versioning & Git Installation

When installing from git, OpenCode (via Bun) caches the repository and **does not automatically pull updates** when the branch moves. To ensure users receive the latest commands and agents:

1. **Bump the version** in **all** `package.json` files (root + every workspace) when adding new commands, agents, or built assets.
2. **Create a git tag** matching the version (e.g. `v0.4.0`) after the bump commit, and **push it to the canonical install remote** (see below). A tag that exists only locally is invisible to git-installs.
3. **Update installation examples** in `README.md`, `AGENTS.md`, and `docs/plugins/commit.md` to reference the new tag instead of a branch name like `#master`. Keep every example on the **same tag as the current `package.json` version** — the `verify-version-tag` guard (`bun scripts/verify-version-tag.mjs`) fails CI when `package.json.version` has no matching reachable git tag.

> **Canonical install remote (split-brain warning).** The README install URL points at `github.com/AppVerk/av-opencode-plugins`. That is the *documented* install source, but personal merges land on the `mszenfeld/pantheon` fork (the project memory's "origin redirect trap"), and the AppVerk upstream has at times diverged (e.g. it reverted the Stribog executor in PR #3 / `a938c9a` while this tree ships Stribog). **Before tagging a release, decide which remote is canonical and ensure the tag is reachable from the commit on *that* remote** — otherwise the documented install command resolves to a tree that does not match these docs. Re-land or document any upstream divergence before pointing users at it.

Example config (keep the tag in lockstep with `package.json` version):
```json
{
  "plugin": [
    "av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.4.0"
  ]
}
```

If a user reports missing commands after an update, instruct them to either:
- Re-install with `opencode plugin -f av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.4.0`, or
- Remove the old cache directory manually:
  ```bash
  rm -rf ~/.cache/opencode/packages/av-opencode-plugins*
  ```

## Superpowers Artefacts

**Never link to anything under `docs/superpowers/` from source, tests, or any other documentation file.** That tree (`docs/superpowers/specs/*.md`, `docs/superpowers/plans/*.md`) holds *temporary working artefacts* produced by the brainstorming / writing-plans skills. Specs and plans get archived or deleted once their work has shipped — every link to them becomes a broken reference the moment that happens.

If a design decision needs to stay reachable after the spec is gone:

- **Inline the decision and its rationale** in the permanent doc that needs it (e.g. `AGENTS.md` for contributor patterns, `docs/<topic>.md` for user-facing reference). The *why* should live in the doc that survives.
- **Use git history** for the audit trail — `git log --follow <file>` and `git blame` are the durable record of when and why a decision was made.

Exceptions: cross-references *within* `docs/superpowers/` (a plan linking to its spec, etc.) are fine — those files are temporary together.

## Code Review Artefacts

**Never write code-review issue IDs into source or test files.** IDs like `SEC-001`, `MAINT-006`, `PERF-001`, `ARCH-002`, `COMPOSITE-3` are generated per-review by the `/review` workflow and live in `docs/reviews/*.md`. They are context-bound to a single report and become noise the moment that report is archived, regenerated, or deleted.

When applying a fix from a review:

- **Keep the technical rationale** ("treat specialist output as untrusted, then truncate by UTF-8 byte length…"). The *why* belongs in the code.
- **Drop the issue ID** ("SEC-001 / MAINT-006"). The *which-report* belongs in git history, not in the comment.
- **Keep standardised external identifiers** like `CWE-117`, `CVE-2023-…`, `OWASP A03:2025` — those are stable, cross-project references, not per-review labels.

Exceptions (these IDs are *system documentation*, not review residue, and may stay):

- `docs/plugins/code-review.md`, `README.md` — describe the ID format the plugin emits.
- `tests/modules/coordinator/assign-issue-ids.test.ts` — fixtures for the function that *generates* these IDs.
- `src/skills/qa/report-format/SKILL.md` — illustrative examples for `/fix` routing.

When in doubt: if removing the ID would make the comment less useful, the ID was load-bearing and the comment is wrong; rewrite the prose to stand on its own.

### Where review reports live

Code-review reports are **permanent artefacts** that get committed to the repo. They live under `docs/reviews/` and follow the naming convention `YYYY-MM-DD-<branch-slug>.md`, with a `-N` suffix on collisions when the same branch is re-reviewed on the same day (e.g. `2026-05-27-feature-explore.md`, `2026-05-27-feature-explore-2.md`).

Conventions:

- **Commit the report** as soon as the review run produces it. An untracked report file under `docs/reviews/` is ambiguous (forgotten? leftover? local-only?) and should never linger across sessions.
- **Keep "Fixed" status in the report**, not in commit messages — the report itself is the audit trail for which findings shipped on which branch.
- **Do not link to `docs/reviews/*.md` from source or other docs.** Like superpowers artefacts, individual reports are point-in-time records; references to them rot once the branch is merged or the file is archived. Inline anything load-bearing into the permanent doc that needs it.

## Plugin-tool enforcement model

Per-agent `config.agent[<name>].tools` has TWO distinct meanings; do not conflate them:

- **Plugin tools** (registered by a plugin's `tool: {...}`, e.g. `execute_recipe`,
  `load_appverk_skill`): the `config.agent[].tools` deny-map is **declarative-only /
  INERT** on opencode 1.15.10 — a 2026-06-10 live probe found a denied plugin tool
  still executes. The markdown frontmatter `allowed-tools` *allowlist* direction was
  **not** probed and must be treated as asserted-not-enforced for plugin tools.
- **Native tools** (e.g. `skill`): `config.agent[].tools` DOES enforce, via opencode's
  string-keyed PermissionV2 engine. The coordinator's `skill: false`
  (`src/modules/coordinator/index.ts:447`) is a real backstop on this path.

**Load-bearing enforcement for plugin tools is in code, not the map:**
- QA's four tools are gated by `src/modules/qa/caller-gate.ts` at each tool's
  `execute()` (registry-only: `execute_recipe` → `zmora-setup`;
  `record_input`/`parse_plan`/`preflight` → the coordinator via registry-negative).
- stribog's tool allow-list + edit budget are enforced by a `tool.execute.before`
  hook (`src/modules/stribog/tool-budget-hook.ts`).
- Perun's local `av_commit` exception is enforced in the commit module: runtime caller
  classification fails closed when unavailable, exact changed-file authorization is internal
  rather than caller-selectable, and `create_branch` / `create_pr` reject **every non-executor
  identity** (Perun included) before any Git or provider call. Perun's `av_commit: true` and
  publication-denial tool-map entries are declarative defense in depth only.

Keep the (inert) maps in place as declarative defense-in-depth — they become free
enforcement if a future opencode honors them. **On every opencode bump, re-verify
BOTH the plugin deny-map AND the markdown allowlist behavior for plugin tools**
(alongside the `NATIVE_BUILTINS` re-verify note).

Publish-chain artifacts that humans read — branch descriptions, commit subjects,
and PR titles — are always written in English, regardless of the conversation
language; commit and PR bodies may quote non-English source material verbatim, and
ticket identifiers are never translated.

### Residual gaps (tracked)

- Background-dispatched subagents ARE now registered and gated: the background path
  registers the child (childSessionID → agent name) in `SessionAgentRegistry`
  (`src/modules/coordinator/background.ts:79`), fed by `sessionAgentRegistry:
  ext.sessionAgentRegistry` at `src/modules/coordinator/index.ts:342`, with the
  registry populated in production by the QA plugin
  (`src/modules/qa/index.ts:132-133`, wired at `src/index.ts:29`). Registration flips
  the child OUT of the caller gate's registry-negative "is the coordinator" bucket, so
  it is denied the coordinator-only QA tools like the foreground `dispatch_parallel`
  path. The remaining residual gap is **non-dispatched custom agents** (never routed
  through `dispatch`, so never registered). Accepted: the coordinator-only QA tools are
  in no agent's frontmatter except Perun's, and `triglav` is read-only. The minter
  (`execute_recipe`) is unaffected — it requires a positive `zmora-setup`.
- `load_appverk_skill: false` on the coordinator is plugin-map-only (inert). Truly
  preventing Perun from loading skills needs a handler/hook gate in `skill-registry`
  — tracked follow-up, not done here.

## Common Pitfalls

- Do not run `git commit` or `git push` via the bash tool in this repo — the commit plugin blocks direct commits and pushes at runtime (`tool.execute.before` hook). Use `/commit` (or the `av_commit` tool) to commit. **Publishing is executor-only:** `create_pr` / `create_branch` accept the canonical `svarog` / `stribog` identities and refuse every other caller with `caller is not authorized`, so a branch/push/PR happens through a dispatched executor, not from an operator or Perun session (`PUBLICATION_AGENT_IDENTITIES` in `src/modules/commit/perun-commit-policy.ts`; see [`docs/commit-workflow.md`](docs/commit-workflow.md)). For Perun, `/commit` is one explicitly authorized, local-only attempt with user-confirmed individual current-change paths; it never authorizes a branch, push, or PR. This bash gate (`classifyBashCommand` in `src/modules/commit/bash-policy.ts`) is **defense-in-depth / a workflow rail, not a security boundary** — it keeps the `/commit` workflow consistent but is bypassable by shapes the literal `git` token-match misses (`/usr/bin/git …`, `bash -c "git …"`, `hub commit`, `command git …`, alias indirection, `$(echo git) commit`, plumbing subcommands like `commit-tree` / `fast-import` / `update-ref`). Per project doctrine ([`docs/plugins/coordinator.md`](docs/plugins/coordinator.md): *"Treat code-enforced rules as the security boundary. The LLM-requested rules are defense in depth — they raise the cost of a successful prompt-injection escalation but are not the last line of defense."*), real shell-execution boundaries live outside this plugin. See [`docs/plugins/commit.md`](docs/plugins/commit.md#classifybashcommand-is-defense-in-depth-not-a-security-boundary) for the full bypass list.
- After changing anything under `src/`, run `bun run build:root` to regenerate `dist/` — published consumers and OpenCode load from `dist/`, not `src/`.
- Removing a workspace `packages/<name>/dist/` will break the root entrypoint and packaging tests. (The root `dist/` is also committed — do not delete it manually; let `bun run build:root` regenerate it.)
- **Forgetting to add a `.gitignore` exception and commit `packages/<name>/dist/`** will cause `Cannot find module` errors for consumers installing from git, because Bun (like npm) does not run the build step on git dependencies.
