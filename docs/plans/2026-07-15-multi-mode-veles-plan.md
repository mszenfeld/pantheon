---
spec: 2026-07-15 Veles multi-mode planning spec
source: user request to prepare detailed implementation plan
branch: master
date: 2026-07-15
---

# Implementation Plan: Multi-mode Veles

## Goal

Implement the multi-mode Veles extension. After this plan is executed, Veles will be able to author feature specs, implementation plans, and QA test plans; Perun will triage changes across Stribog, Svarog, and Veles; and headless Perun dispatch will use a structured headless envelope with prompt-level safeguards.

## Spec dependency

This plan is derived from the 2026-07-15 Veles multi-mode planning spec. All behavioral decisions, blockers, and acceptance criteria come from that spec. The durable requirements are inlined here; refer to git history for the original working spec.

## Global constraints

- All code changes are TypeScript or Markdown under `src/` and `packages/`.
- Tests import from `dist/` after `bun run build:root` / per-package builds.
- No new `src/modules/` file may import from `@appverk/opencode-skill-utils` (frozen import direction per `AGENTS.md`).
- `dist/` trees are committed; build must be run before tests.
- `bun` is the only package manager.
- Slash commands are thin markdown wrappers under `src/commands/`; asset copying is handled by the existing `scripts/copy-root-assets.mjs`.

## Dependencies

- `qa-plan-authoring` skill remains unchanged.
- `test-plan-format` skill remains unchanged.
- `packages/skill-registry/src/index.ts` must discover the new `dist/skills/veles/` directory.
- `src/modules/explore/triglav.md` must support the change-manifest mode.
- `src/modules/plan/veles.md` must be updated before Perun can dispatch it safely.

## Phases

| Phase | Focus | Blockers resolved | Deliverable |
|---|---|---|---|
| 1 | Skills + build + Veles prompt + atomic reservation | BLK-01; BLK-02; BLK-04 prompt contract drafted | New skills loadable; `veles.md` supports direct/headless modes; `veles_reserve_planning_path` available |
| 2 | Commands + smoke tests | BLK-05 (decision + implementation) | `/veles:spec`, `/veles:plan`, `/veles:qa-plan` registered |
| 3 | Perun integration | BLK-03; BLK-04 resolved (headless dispatch + integration tests) | Perun Workflow 3 triages via change manifest |
| 4 | Documentation + contract updates | — | README, AGENTS.md, `docs/veles-planning.md`, `docs/agent-contracts.md`, `docs/configuring-agents.md` updated |
| 5 | Integration tests + acceptance | All | `bun run check` passes; manual acceptance criteria met |

## Tasks

### Task 0: Create durable artefact directories (housekeeping)

**Files:**
- `docs/plans/2026-07-15-multi-mode-veles-plan.md` (this file)
- `docs/specs/.gitkeep`

**Interfaces:** filesystem  
**Steps:**
1. Ensure `docs/plans/` exists so durable implementation plans have a canonical home.
2. Create `docs/specs/` and add `docs/specs/.gitkeep` so Git tracks the directory on fresh checkouts.
3. Instruct authoring skills to create the destination directory defensively before writing if it does not exist.
4. Save this plan.

**Tests:** `ls docs/plans/` succeeds and `ls docs/specs/.gitkeep` exists.  
**Commit step:** `chore(docs): add canonical docs/plans and docs/specs directories`

---

### Task 0.5: Absorb coordinator identity primitives into `src/modules/_shared/`

**Files:**
- `packages/skill-utils/src/session-identity.ts` → `src/modules/_shared/session-identity.ts`
- `packages/skill-utils/src/coordinator-bash-policy.ts` → `src/modules/_shared/coordinator-bash-policy.ts`
- `src/modules/coordinator-policy/read-allowlist.ts`
- `src/modules/stribog/` (session-identity consumer)
- `src/modules/svarog/` (session-identity consumer)

**Interfaces:** session identity, coordinator bash policy  
**Steps:**
1. Move `session-identity.ts` and `coordinator-bash-policy.ts` into `src/modules/_shared/`.
2. Update existing consumers inside `src/modules/` to import from the new `_shared/` paths.
3. Keep `packages/skill-utils` re-exporting the moved primitives for backward compatibility until the remaining external consumers are migrated.
4. Update `COORDINATOR_AGENT` / `COORDINATOR_AGENT_NAME` sync tests if needed; the duplicated constant should now have a single source of truth.
5. Use the absorbed `getSessionAgent` / `getSessionAgentCached` in the plan module's tool gates.

**Tests:**
- Existing coordinator-name-sync test passes with the new single source of truth.
- Stribog and Svarog tests pass after updating imports.
- Plan module can resolve the current session agent for tool gates.

**Commit step:** `refactor(_shared): absorb session-identity and coordinator-bash-policy from skill-utils`

---

### Task 1: BLK-01 — Register Veles skill directory and create skills

**Files:**
- `packages/skill-registry/src/index.ts`
- `scripts/copy-root-assets.mjs` (verify)
- `src/skills/veles/feature-spec-authoring/SKILL.md`
- `src/skills/veles/implementation-plan-authoring/SKILL.md`

**Interfaces:** `load_appverk_skill` tool, `build:root` asset pipeline  
**Steps:**
1. Add `path.resolve(moduleDirectory, "../../../dist/skills/veles")` to `skillDirectories` in `packages/skill-registry/src/index.ts:34`.
2. Verify `scripts/copy-root-assets.mjs` already copies `src/skills/veles/**/SKILL.md` to `dist/skills/veles/` (it recursively copies `src/skills/**`). No change needed unless verification fails.
3. Create `src/skills/veles/feature-spec-authoring/SKILL.md` with:
   - Frontmatter `name` and `description`.
   - Purpose and inputs.
   - Step-by-step authoring instructions (goal, background, constraints, requirements, architecture, security, testing, rollout).
   - No-placeholder rule and adversarial self-critique.
   - **Reservation policy:** Before writing, call `veles_reserve_planning_path` with `directory: "docs/specs/"`, `baseName: "YYYY-MM-DD-<topic>-spec"`, `extension: ".md"` to obtain a reserved path. Then call `veles_write_reserved_planning_artifact` with that path and the full markdown content. Do not probe existence, choose suffixes manually, or use direct `Write`.
   - Output contract: `type: "spec"`, `plan_path`, `topic`, `summary`.
   - Frontmatter schema for specs: include `approved: false` initially; `approved_at` and `approved_by_session` omitted until `approve_planning_artifact` is called.
4. Create `src/skills/veles/implementation-plan-authoring/SKILL.md` with:
   - Frontmatter `name` and `description`.
   - Purpose and inputs (`spec_path` required in headless mode).
   - Step-by-step decomposition into tasks with `Files/Interfaces/Steps/Tests/Commit step`.
   - Verification plan and risk register.
   - **Reservation policy:** Before writing, call `veles_reserve_planning_path` with `directory: "docs/plans/"`, `baseName: "YYYY-MM-DD-<topic>-plan"`, `extension: ".md"` to obtain a reserved path. Then call `veles_write_reserved_planning_artifact` with that path and the full markdown content. Do not probe existence, choose suffixes manually, or use direct `Write`.
   - Frontmatter schema for implementation plans:
     - `artifact_type: "implementation-plan"`
     - `spec_path`: normalized repo-relative path to the approved spec used as input (required in headless mode; optional in direct-user mode)
     - `spec_digest`: canonical digest of the approved spec (required in headless mode)
     - `approved: false` initially; `approved_at` and `approved_by_session` omitted until `approve_planning_artifact` is called
   - Output contract: `type: "implementation-plan"`.
5. Run `bun run build:root` and confirm `dist/skills/veles/` contains both `SKILL.md` files.

**Tests:**
- Extend `packages/skill-registry/tests/plugin.test.ts` or add a new test to assert that `dist/skills/veles` is registered in the config hook's `skills.paths`.
- Extend `packages/skill-registry/tests/load-skill.test.ts` to assert both skills load without error when the Veles directory is included in the catalog.
- Shell check: `ls dist/skills/veles/feature-spec-authoring/SKILL.md` and `ls dist/skills/veles/implementation-plan-authoring/SKILL.md`.

**Commit step:** `feat(skill-registry,veles): discover veles skills and add feature-spec/implementation-plan skills`

---

### Task 1.5: Atomic planning path reservation

**Files:** `src/modules/plan/artifact-path.ts`, `src/modules/plan/index.ts`, `tests/modules/plan/artifact-path.test.ts`  
**Interfaces:** `veles_reserve_planning_path` tool  
**Steps:**
1. Create `src/modules/plan/artifact-path.ts` implementing two Veles-only tools:
   - `veles_reserve_planning_path({ directory, baseName, extension })`:
     - Validation: `baseName` must be a single filename segment (no path separators, no `..`, no leading `.`); `extension` must be `.md`; the resolved candidate must remain canonically under the allowed directory.
     - Behavior: attempt exclusive file creation with `fs.openSync(path, "wx")` for `<directory>/<baseName><extension>`; on `EEXIST`, try `<baseName>-2`, `<baseName>-3`, etc. up to a limit (e.g. 1000). On success, record the reservation in an in-process map keyed by session ID and path, close the descriptor, and return the reserved `path`; on failure, return an error.
     - Reject callers whose session agent is not `Veles - Planner`.
   - `veles_write_reserved_planning_artifact({ path, content })`:
     - Verify the `path` was reserved by the same Veles session and is still empty (size 0).
     - Verify the resolved path remains canonically under `docs/specs/` or `docs/plans/`.
     - Atomically write `content` to `path` and remove the reservation.
     - Reject unreserved paths, out-of-directory paths, writes to non-empty files, and non-Veles callers.
2. Register both tools in `src/modules/plan/index.ts` under the Veles agent plugin (not globally).
3. Keep a fallback `tool.execute.before` write gate that applies only when the calling session agent is `Veles - Planner` and rejects any direct `Write` under `docs/specs/`, `docs/plans/`, or `docs/.veles-approvals/` that is not routed through `veles_write_reserved_planning_artifact`. This gate is defense-in-depth for the inert plugin-tool map.

**Tests:**
- Unit test `veles_reserve_planning_path` returns the base path when free, returns `<base>-2` on collision, and rejects non-allowed directories / traversal / invalid baseName / non-Veles callers.
- Parallel test: two concurrent reservations for the same base name return distinct suffixed paths.
- Integration test: a Veles session can reserve a path and then call `veles_write_reserved_planning_artifact` to write it.
- Integration test: a second attempt to write the same non-empty path is rejected.
- Integration test: a Veles session cannot write to an unreserved path.
- Integration test: a Veles session cannot write to a path reserved by another session.
- Integration test: the fallback write gate rejects direct `Write` calls under `docs/specs/` / `docs/plans/`.

**Commit step:** `feat(veles): atomic planning path reservation`

---

### Task 2: BLK-02 + BLK-04 — Update `src/modules/plan/veles.md`

**Files:** `src/modules/plan/veles.md`, `src/modules/plan/allowed-tools.ts`, `tests/modules/plan/veles-prompt.test.ts`  
**Interfaces:** `Veles - Planner` prompt, unified output contract  
**Steps:**
1. Keep the existing opening identity and "write only plan markdown" rule.
2. Add `## Execution context` section distinguishing direct-user session from headless Perun dispatch:
   - Direct-user: may use `question` for clarification; must classify intent from natural language if no `Mode:` is given.
   - Headless: marked by `Execution context: perun-headless` + `Mode: <spec|implementation-plan|qa>`; must NOT call `question`; must return JSON contract.
   - **Important:** the envelope is a prompt-level convention, not a cryptographic guarantee. The real enforcement is the combination of (a) prompt-level invariant in `veles.md`, (b) Perun never emitting `question` in the headless task prompt, and (c) integration tests that verify the headless child returns JSON without calling `question`. Document this limitation explicitly.
3. Replace `## Interview mode` with a version that allows `question` only in direct-user sessions and mandates `status: "needs_clarification"` in headless mode.
4. Extend `## Modes` with:
   - `Mode: Feature spec` → load `feature-spec-authoring` skill, save to `docs/specs/`, return `type: "spec"`.
   - `Mode: Implementation plan` → validate `spec_path` in headless mode, load `implementation-plan-authoring` skill, save to `docs/plans/`, return `type: "implementation-plan"`.
   - Keep existing `Mode: QA test plan` with legacy fields preserved.
5. Replace `## Output contract` with the discriminated union from the parent spec:
   - `ok` + `type` + `plan_path` + `topic` + `summary`
   - `needs_clarification` + `topic` + `message` + `suggested_modes`
   - `error` + `topic` + `reason`
   - `timeout` + `topic`
   - Define `summary` as a one-sentence human-readable artefact summary (e.g. "Feature spec for multi-mode Veles planning").
   - **For QA mode only (`type === "qa"):** also include legacy fields `fe_count`, `be_count`, `setup_prereqs`.
   - Use `plan_path` as the canonical path field for all artefact types (specs, plans, QA test plans). Do not introduce `artifact_path` unless the parent spec is changed.
   - For implementation plans produced in headless mode, require `spec_path` and validate that the referenced spec exists and has `approved: true` in its frontmatter. If not, return `status: "error"`.
   - The implementation-plan result JSON must include `spec_path` (the approved spec used as input) so Perun can verify the chain.
   - For direct-user sessions, if no prior spec exists, allow Veles to produce a lightweight inline spec first, mark it clearly as unapproved, and recommend reviewing it before coding.
6. Add `## Collision policy` section:
   - Before writing any spec or implementation plan, call `veles_reserve_planning_path` to obtain a reserved path, then call `veles_write_reserved_planning_artifact` with that path. Use exactly the path returned by the reservation tool.
   - Never overwrite an existing durable artefact. There is no safe automatic update path; to revise an artefact, produce a new suffixed version and update references.
7. Add `veles_reserve_planning_path` and `veles_write_reserved_planning_artifact` to the set of tools Veles may invoke for spec/plan output. Keep them out of coordinator-only tools.
8. Update `src/modules/plan/allowed-tools.ts` if `question` is still needed for direct-user mode; ensure no new prohibited tools are added. The rendered `veles.md` frontmatter reflects this file.
9. Extend `src/modules/_shared/session-agent-registry.ts` without breaking existing consumers:
   - Keep `lookup(sessionID): string | undefined` returning the agent name.
   - Add `registerWithMetadata(sessionID, agent, metadata)` and `lookupMetadata(sessionID): { headless?: boolean } | undefined`.
   - Update all existing callers of `register` to continue working unchanged.
10. Extend `src/modules/coordinator/index.ts` `dispatch_parallel` tool schema and `src/modules/coordinator/dispatch.ts` `DispatchTask` type:
    - Add an optional `executionContext?: "perun-headless"` field to the task schema.
    - Forward `executionContext` through foreground and background dispatch plumbing.
    - In the foreground dispatch path, when a child session is created, replace the existing `registry.register(createdId, task.name)` call with `registerWithMetadata(createdId, task.name, { headless: executionContext === "perun-headless" })`.
    - In the background dispatch path, the specialist is started asynchronously. Extend the background specialist API with an `onSessionCreated` callback that fires before the first `promptAsync` and call `registerWithMetadata(createdId, task.name, { headless: executionContext === "perun-headless" })` there. Add a background-specific gate integration test.
    - Keep `register()` compatible and ensure `unregister()` removes metadata too.
    - Do not infer headless state from prompt text scanning.
11. Ensure the plan module receives the same registry instance via dispatch extensions (as QA does) so its hook can query child-session metadata.
12. Add a `tool.execute.before` hook in `src/modules/plan/index.ts` that rejects `question` calls when the calling session resolves to `Veles - Planner` and its metadata has `headless: true`. Use the shared `getSessionAgent` / session-agent registry to resolve the caller; fail-open if identity cannot be determined.
13. Add/extend `tests/modules/plan/veles-prompt.test.ts`:
    - Static tests that the rendered prompt contains the headless envelope rules and the `question` prohibition.
    - Integration test that the headless question gate rejects `question` for a headless Veles session.
    - Integration test that dispatching Veles with `executionContext: "perun-headless"` registers the child session with `headless: true` and that the metadata reaches the plan module's hook.
    - Note: prompt tests alone do not prove runtime behavior; the tool gate and integration tests cover runtime enforcement.

**Tests:**
- Static prompt-contract test: the rendered `veles.md` contains explicit instructions to classify direct-user messages into `spec`, `implementation-plan`, or `qa`.
- Static prompt-contract test: the rendered `veles.md` contains the headless envelope marker `Execution context: perun-headless` and the prohibition on `question` in headless mode.
- Eval/manual test: direct-user message *"design multi-mode Veles"* produces a spec (`status: "ok"`, `type: "spec"`).
- Eval/manual test: direct-user message *"plan implementation"* produces an implementation plan (`status: "ok"`, `type: "implementation-plan"`).
- Eval/manual test: direct-user message *"create QA plan"* produces a QA plan (`status: "ok"`, `type: "qa"`).
- Eval/manual test: headless prompt without `Mode:` → `status: "needs_clarification"` with `message` and `suggested_modes`.
- Eval/manual test: headless prompt with `Mode: spec` and `Execution context: perun-headless` → `status: "ok"`, `type: "spec"`, no `question`.
- Eval/manual test: direct-user request for an implementation plan without a prior spec → produce an unapproved inline spec and recommend review.

**Commit step:** `feat(veles): direct-user intent classification, headless envelope, and unified output contract`

---

### Task 2.5: BLK-05 — Decide slash command routing model (pre-spike)

**Files:** OpenCode SDK documentation, `src/modules/plan/index.ts` (for Option A feasibility)  
**Interfaces:** command dispatch API  
**Steps:**
1. Build a small runtime prototype against the installed OpenCode version that registers a test command and verifies the command dispatch model, including whether a command can dispatch `Veles - Planner` from a Perun/default session.
2. Evaluate three options for the new `/veles:*` commands:
   - **Option A:** command handler dispatches `Veles - Planner` from any session.
   - **Option B:** commands are attached to the Veles agent and only work when the user has switched to Veles.
   - **Option C:** slash commands work only in direct Veles sessions; in Perun sessions users use natural language requests.
3. Select the feasible option for `/veles:*`:
   - **Option A (preferred):** `/veles:*` commands are registered globally and dispatch Veles from any session; `/qa:create-plan` becomes an alias that dispatches Veles with `Mode: qa`. Implement this if the spike proves cross-agent command dispatch works.
   - **Option C (fallback):** OpenCode does not support cross-agent command dispatch. Slash commands are documented as direct-Veles-session-only; Perun sessions route planning requests through natural language. `/qa:create-plan` keeps its standalone QA behavior. Do not attempt to enforce session-only access in a markdown command template—rely on the spike to prove the fallback is acceptable.
   - Record the decision. If Option A is infeasible, Phase 2 is reduced to documentation only (no new `/veles:*` commands are registered globally).
4. Record the decision in this plan and create a minimal `docs/veles-planning.md` stub (routing decision only) before Phase 2 starts. Task 5 will expand the stub into the full user reference.

**Tests:**
- Prototype result documented in this plan (e.g. “Option A feasible; command handler lives in `src/modules/plan/index.ts`” or “Option C fallback selected”).
- Regression test if Option A is chosen.

**Commit step:** `docs(veles): record slash command routing decision`

---

### Task 3: BLK-05 — Add slash commands

**Files:**
- `src/commands/veles-spec.md`
- `src/commands/veles-plan.md`
- `src/commands/veles-qa-plan.md`
- `src/commands/create-qa-plan.md` (alias update)
- `src/modules/plan/index.ts` (command registration + Option A handler if chosen)
- `src/modules/plan/allowed-tools.ts` (update if command permissions change)

**Interfaces:** `/veles:spec`, `/veles:plan`, `/veles:qa-plan`, `/qa:create-plan`  
**Steps:**
  1. **If Option A is selected:** implement global command handlers that dispatch Veles from any session.
     - **If Option C is selected:** skip global command registration. Update `docs/veles-planning.md` to document that `/veles:*` commands are direct-Veles-session-only and that Perun sessions use natural language. Do not register unreliable session-checking commands.
  2. **Option A only:** register the commands in `src/modules/plan/index.ts` (similar to `src/modules/qa/index.ts:40-69`):
     - `veles:spec`
     - `veles:plan`
     - `veles:qa-plan`
  3. **Option A only:** update the existing `qa:create-plan` command registration in `src/modules/qa/index.ts`:
     - Keep it globally available (backward compatibility).
     - Its handler normalizes the request into a Veles prompt with `Mode: qa` and dispatches `Veles - Planner` directly. Ensure both `/qa:create-plan` and `/veles:qa-plan` use the same dispatch path.
     - Do not register `qa:create-plan` in the plan module.
     - **Option C:** preserve the existing standalone QA plan command behavior; do not modify `src/modules/qa/index.ts`.
  4. **Option A only:** update `src/modules/plan/allowed-tools.ts` if the command handler needs tools beyond Veles’s default set.
  5. **Option A only:** create `src/commands/veles-spec.md`:
     - Frontmatter: `description`, `argument-hint`, `allowed-tools` including `todowrite` and `dispatch_parallel`.
     - Body: normalize `$ARGUMENTS` into a Veles prompt with `Mode: spec` and `Topic: $ARGUMENTS` and dispatch `Veles - Planner` with `Execution context: perun-headless` and `Mode: spec`. Do not load the skill inside the command.
  6. **Option A only:** create `src/commands/veles-plan.md` analogously with `Mode: implementation-plan`.
  7. **Option A only:** create `src/commands/veles-qa-plan.md` analogously with `Mode: qa`.
  8. **Option A only:** update `src/commands/create-qa-plan.md` to state it is an alias for `/veles:qa-plan` and redirect to the same normalized prompt.
  9. **Option A only:** run `bun run build:root` and confirm `dist/commands/veles-*.md` exist.

**Tests:**
- **Option A only:** add a config-hook test asserting `veles:spec`, `veles:plan`, `veles:qa-plan` are registered by the plan module.
- Add a config-hook test asserting `qa:create-plan` remains registered by the QA module.
- Manual: `/qa:create-plan` from a Perun session continues to produce a QA plan (Option A: via Veles; Option C: standalone).
- **Option A only:** root plugin test `tests/root-plugin.test.ts` already derives packed files from `package.json` `files[]`; add `src/commands/veles-*.md` to root `files` if not already covered by `dist/commands/` glob.
- Manual: `/veles:spec test-feature` in a Veles session produces a spec.

**Commit step:** `feat(commands): add veles spec, plan, and qa-plan commands`

---

### Task 4: BLK-03 — Perun Workflow 3 + Triglav change manifest

**Files:**
- `src/modules/explore/triglav.md`
- `src/agents/perun.md`
- `src/modules/coordinator/feature-manifest.ts` (new pure classifier/validator + tool)
- `src/modules/coordinator/index.ts` (tool registration)
- `src/modules/coordinator/artifact-approval.ts` (new pure approval writer + tool)
- `src/modules/coordinator/artifact-digest.ts` (new digest helper + tool)
- `tests/modules/coordinator/` or `docs/eval/scenarios/veles/` (new eval scenarios)

**Interfaces:** Perun prompt, `triglav` change-manifest mode, `dispatch_parallel` routing  
**Steps:**
  1. Add `## Change manifest mode` to `src/modules/explore/triglav.md`:
   - Define JSON schema wrapped in `{ "manifest": { ... } }`:
     - `files_changed`
     - `modules_affected`
     - `new_surface_types`
     - `risk_flags`
     - `estimated_complexity`
   - Risk flags: `auth`, `egress`, `agent_contract`, `public_api`, `cross_module`, `data_migration`.
   - Complexity values: `mechanical`, `simple`, `complex`.
    - Instruct triglav to output the manifest inside the `<results>` block (for example after `<next_steps>`) as a single fenced JSON block preceded by the sanitizer-stable marker `CHANGE_MANIFEST_V1:` (no HTML characters). Perun will extract the first fenced JSON block after that marker.
  2. Create `src/modules/coordinator/feature-manifest.ts` (pure module + Perun-only tool):
     - Define `FeatureManifest` interface matching the triglav schema.
     - Implement `parseManifest(text: string): FeatureManifest | undefined` that extracts the `CHANGE_MANIFEST_V1:` marker and the following fenced JSON block.
      - Implement `classifyManifest(manifest: FeatureManifest, changedFiles?: string[]): "stribog" | "svarog" | "veles"` that applies the deterministic routing table, sensitive path globs, and validation rules. If a trusted `changedFiles` list is supplied, validate it against `manifest.files_changed`; otherwise fail closed to Veles when the manifest is uncertain.
      - Define a `GitRunner` interface with methods: `revParse(ref: string): Promise<string>`, `mergeBase(base: string, head: string): Promise<string>`, `diffNameOnly(base: string): Promise<string[]>`. Implement a production `execFileGitRunner` using `node:child_process` `execFile` with `-z` NUL-delimited output.
      - Export `validateAndClassify(text: string, options?: { gitRunner: GitRunner; base?: string; userRequestedPlanning?: boolean }): Promise<{ executor: "stribog" | "svarog" | "veles"; reason: string } | { error: string }>`.
      - Register a coordinator-only tool `classify_feature_manifest` in `src/modules/coordinator/index.ts` that wraps `validateAndClassify`. Add it to `PERUN_TOOLS` and `src/agents/perun.md` frontmatter.
      - **Caller gate:** the tool handler must reject any caller whose `context.agent` is not `COORDINATOR_AGENT` (from `src/modules/agent-roster/index.ts`). Return `forbidden` otherwise.
      - **Trusted file list:** The tool handler obtains the changed-file list via the injected `GitRunner`. It accepts a caller-supplied `base` (branch name or SHA), validates it with `revParse`, computes the merge-base with `mergeBase(base, "HEAD")`, then runs `diffNameOnly(mergeBase)`. If no `base` is provided, resolve the repository default branch (`revParse("origin/HEAD")` or fall back to `master`/`main`) and use that. On any git failure, return `veles`. This list is the trusted source. Perun passes only Triglav's result; the tool ignores any file list embedded in that result.
      - Perun Workflow 3 calls `classify_feature_manifest({ result: <triglav output>, base?: <branch/SHA>, userRequestedPlanning: <boolean> })` before dispatching any executor.
     - **Conservative routing rule:** If `userRequestedPlanning` is true, return `veles` unconditionally.
     - **No-diff/new-feature rule:** If the git-derived changed-file list is empty (e.g. new feature on a clean tree), return `veles`.
     - **Trusted file list rule:** For Stribog/Svarog routes, require the git-derived changed-file list to be non-empty and verify the manifest's `files_changed` exactly matches it. If empty or mismatch, return `veles`.
     - Unit-test the pure module with parsed JSON objects; integration-test the tool with full Triglav-like result strings and mocked git output.
  3. Replace `### Workflow 3: Feature build` in `src/agents/perun.md` with the full triage workflow:
    - Step 0: dispatch `triglav` to produce a change manifest.
    - Step 0.5: call the coordinator-only tool `classify_feature_manifest({ result: <triglav output>, base: <resolved base branch/SHA>, userRequestedPlanning: <true if user explicitly asked for spec/plan> })`. The tool internally obtains the trusted changed-file list from git. Apply conservative validation:
     - Missing marker or malformed JSON → default to `complex` → Veles.
     - Unknown risk flags → default to `complex` → Veles.
     - Inconsistent data (e.g. risk flags present but complexity is `mechanical`) → default to `complex` → Veles.
     - Files touching sensitive paths (auth, egress, agent registry, coordinator policy) → route to Veles regardless of declared complexity.
    - Step 1: classify via manifest table only after validation passes:

      | Condition | Executor |
      |---|---|
      | `estimated_complexity === "mechanical"` AND `files_changed.length` is 1–2 AND `risk_flags` empty AND `new_surface_types` empty AND no sensitive paths AND trustedChangedFiles is non-empty | Stribog |
      | `estimated_complexity === "simple"` AND `files_changed.length` is 1–3 AND `modules_affected.length < 3` AND `risk_flags` empty AND no sensitive paths AND `new_surface_types` empty AND trustedChangedFiles is non-empty | Svarog |
      | `estimated_complexity === "complex"` OR any risk flag OR sensitive path OR `new_surface_types` non-empty OR `modules_affected.length >= 3` OR empty `files_changed` OR empty `trustedChangedFiles` | Veles |
      | manifest missing/malformed/unwrapped/unknown flags | Veles |

      Sensitive path globs (always route to Veles regardless of declared flags):
      - `src/modules/agent-registry/**`
      - `src/modules/agent-roster/**`
      - `src/modules/coordinator/**`
      - `src/modules/coordinator-policy/**`
      - `src/modules/plan/**`
      - `src/modules/qa/**`
      - `src/modules/commit/**`
      - `src/agents/**`
      - `src/commands/**`
      - `packages/skill-utils/src/session-identity.ts`
      - `packages/skill-utils/src/coordinator-bash-policy.ts`
      - `docs/agent-contracts.md`
      - `docs/configuring-agents.md`
      - Any file matching `*auth*`, `*egress*`, `*secret*`, `*credential*`

    - Step 2: route to Stribog, Svarog, or Veles based on the table above.
    - Step 3: complex/safety-sensitive route: spec → approval → implementation-plan → approval → Svarog.
      1. Dispatch Veles with `Mode: spec` to produce a spec.
      2. Validate the returned JSON contract: `status === "ok"`, `type === "spec"`, `plan_path` under `docs/specs/`, normalized repo-relative path, no traversal.
      3. Call `get_planning_artifact_digest({ path: <spec path> })` to obtain the canonical digest of the spec file at the moment of review (`pre_approval_digest`).
      4. Ask user for approval via `question`.
      5. On approval, call the coordinator-only tool `approve_planning_artifact({ path: <spec path>, preApprovalDigest: <pre_approval_digest> })`. The tool verifies the supplied digest matches the canonical digest, then atomically updates the spec frontmatter with `approved: true`, `approved_at`, `approved_by_session` (derived from the tool context/session ID) and persists an immutable sidecar record containing the approved canonical digest. Reject non-`docs/specs/` targets and traversal.
      6. Dispatch Veles with `Mode: implementation-plan`, `spec_path: <approved spec>`, and `spec_digest: <canonical digest from spec sidecar>` in the headless envelope.
      7. Validate the returned contract: `status === "ok"`, `type === "implementation-plan"`, `plan_path` under `docs/plans/`, `spec_path` equals the previously approved spec, and the plan frontmatter contains `spec_digest` matching the spec's sidecar canonical digest. Also verify the referenced spec still has `approved: true`.
      8. Re-verify the spec: call `get_planning_artifact_digest({ path: <spec path> })` and confirm it matches the canonical digest stored in the spec's sidecar record. Reject if changed or if the sidecar is missing.
      9. Call `get_planning_artifact_digest({ path: <implementation plan path> })` to obtain the canonical digest at the moment of review (`pre_approval_digest`).
      10. Ask user for approval of the implementation plan.
      11. On approval, call `approve_planning_artifact({ path: <implementation plan path>, preApprovalDigest: <pre_approval_digest> })` to mark the plan approved and persist its sidecar record.
      12. Before dispatching Svarog, call `read_verified_planning_artifact({ path: <implementation plan path> })`. The coordinator-only tool reads the file once, computes its canonical digest, compares it to the sidecar record, and returns `{ status: "ok", content: <full file contents> }` only if they match. Reject mismatches or missing sidecar.
      13. On approval, dispatch Svarog with both the `plan_path` and the verified `content_snapshot` returned by `read_verified_planning_artifact`. This closes the TOCTOU window between verification and execution.
      14. On decline, stop.
    - Step 4: break-glass approval gate (non-sensitive changes only).
      - For non-sensitive changes, if the user explicitly requests an override of the table’s executor choice, surface the original classification, require explicit confirmation, log the override, and proceed only on explicit confirmation.
      - Sensitive changes (risk flags or sensitive paths) are non-overridable and must always route through Veles.
    - Step 5: approval gates before dispatching Svarog or Stribog after any Veles artefact, and before dispatching Svarog for simple changes that carry a non-sensitive but notable risk.
  5. Add `### Headless Veles dispatch` subsection to `src/agents/perun.md`:
     - Include `Execution context: perun-headless` and `Mode:` in the prompt text so the child can follow the contract.
     - Pass `executionContext: "perun-headless"` to `dispatch_parallel` so the coordinator registry records the session as headless.
     - On `needs_clarification`: surface message, ask user, re-dispatch with explicit mode.
  6. Add `### Re-dispatch after clarification` if needed.
  7. Create `src/modules/coordinator/artifact-digest.ts`:
     - Define and export a canonical digest function for planning artifacts: it reads the file, parses frontmatter, blanks/removes the `approved_file_digest` field, serializes frontmatter deterministically (fixed key order, newline style), appends the body, and computes SHA-256.
     - Implement `getPlanningArtifactDigest(path: string): { status: "ok", digest: string } | { status: "error", reason: string }` that validates the path (under `docs/specs/` or `docs/plans/`), resolves it with `realpath`, rejects symlinks and non-regular files, verifies canonical containment, and returns the canonical digest.
     - Register a coordinator-only tool `get_planning_artifact_digest` in `src/modules/coordinator/index.ts`. Add it to `PERUN_TOOLS` and `src/agents/perun.md` frontmatter.
     - **Caller gate:** the tool handler must reject any caller whose `context.agent` is not `COORDINATOR_AGENT` (from `src/modules/agent-roster/index.ts`). Return `forbidden` otherwise.
     - Test: successful digest, traversal rejection, symlink escape rejection, canonicalization with `approved_file_digest` ignored, direct Veles caller denial.
      8. Create `src/modules/coordinator/artifact-approval.ts`:
     - Implement a shared strict frontmatter parser/canonical serializer in `src/modules/coordinator/artifact-digest.ts` that: parses YAML frontmatter bounded by `---`, rejects duplicate keys, rejects unknown/malformed delimiters, sorts keys deterministically, emits fixed newline style, and excludes mutable approval fields (`approved`, `approved_at`, `approved_by_session`) from the canonical digest. Both the digest tool and the approval tool must use this exact routine.
     - Implement `approvePlanningArtifact(path: string, preApprovalDigest: string, sessionId: string): { status: "ok", approvedFileDigest: string } | { status: "error", reason: string }` that validates the path (same rules as digest tool) and then, under a per-artifact exclusive lock:
       - Re-reads the file using the shared strict parser and recomputes the canonical digest.
       - Verifies the provided `preApprovalDigest` matches the freshly computed canonical digest.
       - Checks that no sidecar record already exists for the path; if it does, reject.
       - Adds/updates `approved: true`, `approved_at`, `approved_by_session` in frontmatter.
       - Writes the file back using the shared canonical serializer.
       - Persists an immutable sidecar record at `docs/.veles-approvals/<sha256-of-canonical-path>.json` containing `approvedAt`, `approvedBySession`, `canonicalDigest`, and `path`. The sidecar is the source of truth for re-verification. Create the sidecar with `fs.openSync(..., "wx")` and reject if it already exists.
       - Protect the `.veles-approvals/` directory with the same Veles write gate used for specs/plans so Veles cannot modify approval records.
       - Returns the post-write canonical digest.
      - Register a coordinator-only tool `approve_planning_artifact` in `src/modules/coordinator/index.ts`. Add it to `PERUN_TOOLS` and `src/agents/perun.md` frontmatter.
     - **Caller gate:** same coordinator-only rule as `get_planning_artifact_digest`.
     - Test: traversal rejection, non-allowed-directory rejection, symlink escape rejection, digest mismatch rejection, malformed/duplicate frontmatter rejection, successful approval metadata write and sidecar creation, tampered artifact frontmatter still fails re-verification against sidecar, concurrent duplicate approval returns exactly one success and one rejection, direct Veles caller denial.
   9. Create `src/modules/coordinator/artifact-read.ts`:
     - Implement `readVerifiedPlanningArtifact(path: string): { status: "ok", content: string } | { status: "error", reason: string }` that validates the path (same rules as digest tool), reads the file once, computes its canonical digest, loads the corresponding sidecar record, and returns the content only if the computed digest matches the sidecar's `canonicalDigest`.
     - Register a coordinator-only tool `read_verified_planning_artifact` in `src/modules/coordinator/index.ts`. Add it to `PERUN_TOOLS` and `src/agents/perun.md` frontmatter.
     - **Caller gate:** same coordinator-only rule.
     - Test: successful verified read, digest mismatch rejection, missing sidecar rejection, traversal rejection.
   10. Update `src/modules/plan/veles.md` if needed to consume the same envelope format.

**Tests:**
- Unit test `parseManifest()` with full Triglav-like strings containing `CHANGE_MANIFEST_V1:` and fenced JSON.
- Unit test `classifyManifest()` with parsed JSON objects for all routing cases.
- Integration test the `classify_feature_manifest` tool returns correct executor for each fixture.
- Integration test `approve_planning_artifact` accepts only allowed paths and rejects traversal/digest mismatch.
- Integration test `get_planning_artifact_digest` returns correct digest and rejects traversal/symlinks.
- Eval scenario: manifest with `agent_contract` → dispatch Veles.
- Eval scenario: manifest `mechanical`, 1 file, no risk → dispatch Stribog.
- Eval scenario: manifest `simple`, no risk → dispatch Svarog.
- Eval scenario: missing manifest → default to Veles.
- Eval scenario: Veles returns `needs_clarification` → Perun asks user, re-dispatches.

**Commit step:** `feat(perun): complexity triage with triglav change manifest and headless veles dispatch`

---

### Task 5: Documentation and contract updates

**Files:**
- `README.md`
- `AGENTS.md`
- `docs/veles-planning.md` (new)
- `docs/agent-contracts.md`
- `docs/configuring-agents.md`

**Interfaces:** User-facing documentation, agent contract registry  
**Steps:**
1. Update `README.md`: add Veles to the agent overview and mention the new spec/plan commands.
2. Update `AGENTS.md`: add `src/modules/plan/` row details and update the Documentation Checklist to include durable planning artefacts in `docs/specs/` and `docs/plans/`.
3. Create/update `docs/veles-planning.md`:
   - Task 2.5 creates the file with the routing decision stub.
   - Task 5 expands it into the complete user-facing reference describing the three modes, natural-language invocation, slash commands, output directories, and approval flow.
4. Update `docs/agent-contracts.md`: document the new Veles contract shape (`ok` variants, `needs_clarification`, `error`, `timeout`) and the headless envelope.
5. Update `docs/configuring-agents.md`: update the Veles row in the “Available agents” table to list all three modes and link to `docs/veles-planning.md`.
6. Update `src/modules/plan/veles.metadata.ts` (or equivalent metadata file): update the Perun-facing description and triggers to include feature specs and implementation plans, not only QA plans.
7. Ensure no links to `docs/superpowers/` remain in the updated docs.

**Tests:**
- `grep -r "docs/superpowers" README.md AGENTS.md docs/veles-planning.md docs/agent-contracts.md docs/configuring-agents.md` returns nothing.
- Manual review of `docs/veles-planning.md` for clarity.
- Verify `docs/configuring-agents.md` Veles row mentions `spec`, `implementation-plan`, and `qa` modes.
- Verify `src/modules/plan/veles.metadata.ts` description/triggers mention feature specs and implementation plans.

**Commit step:** `docs(veles,perun): user-facing reference and agent contract updates`

---

### Task 6: Integration tests, build, and acceptance

**Files:**
- `packages/skill-registry/tests/plugin.test.ts` (extended)
- `packages/skill-registry/tests/load-skill.test.ts` (extended)
- `tests/modules/plan/veles-prompt.test.ts` (extended)
- `tests/modules/coordinator/perun-veles-flow.test.ts` (updated for new contract)
- `tests/modules/coordinator/perun-routing.test.ts` (new)
- `tests/modules/coordinator/fixtures/` (new manifest fixtures)
- `docs/eval/scenarios/veles/` (new eval scenarios for direct planner behavior)
- `docs/eval/scenarios/perun/` (new eval scenarios for Perun routing)

**Interfaces:** full harness  
**Steps:**
1. Build the skill-registry workspace before running its tests: `bun --filter @appverk/opencode-skill-registry build`.
2. Extend `packages/skill-registry/tests/plugin.test.ts` to assert `dist/skills/veles` is registered in the config hook.
3. Extend `packages/skill-registry/tests/load-skill.test.ts` to assert both new skills load via `load_appverk_skill`.
  4. Extend `tests/modules/plan/veles-prompt.test.ts`:
   - Assert the rendered prompt contains the headless envelope instruction and the `question` prohibition.
   - Assert the output contract schema is documented with all four status variants.
    - Assert the `tool.execute.before` gate rejects `question` for a session whose registry entry is `Veles - Planner` with `headless: true`, and allows it for a direct Veles session.
  5. Update `tests/modules/coordinator/perun-veles-flow.test.ts`:
   - Replace the flat six-field assertion with discriminated-union cases:
     - `ok` + `type: "spec"` → validate `plan_path` under `docs/specs/`, `topic`, `summary`.
     - `ok` + `type: "implementation-plan"` → validate `plan_path` under `docs/plans/`, `topic`, `summary`.
     - `ok` + `type: "qa"` → validate `plan_path` under `docs/testing/plans/`, `topic`, `summary`, plus `fe_count`, `be_count`, `setup_prereqs`.
     - `needs_clarification` → validate `topic`, `message`, `suggested_modes`.
     - `error` → validate `topic`, `reason`.
     - `timeout` → validate `topic`.
   - Add traversal/out-of-directory rejection tests.
6. Create `tests/modules/coordinator/perun-routing.test.ts`:
    - Define fixture manifests in `tests/modules/coordinator/fixtures/` as full Triglav-like result strings containing `CHANGE_MANIFEST_V1:` followed by a fenced JSON block with wrapped `{ "manifest": { ... } }`.
    - Inject a mockable git runner seam into `classify_feature_manifest` so tests can supply deterministic git output without relying on the real repo state. Each fixture specifies:
      - `triglavResult`: the Triglav-like result string.
      - `gitDiffNames`: array of changed-file paths returned by the mocked git diff.
      - `base`: optional base branch/SHA supplied to the tool.
      - `expectedExecutor`: `stribog` | `svarog` | `veles`.
    - Fixture cases:
      - `mechanical.json` — 1 file, no risk flags, `estimated_complexity: "mechanical"`, `gitDiffNames` matches manifest files → Stribog.
      - `simple.json` — ≤3 files, `<3` modules, no risk flags, `estimated_complexity: "simple"`, `gitDiffNames` matches manifest files → Svarog.
      - `complex-agent-contract.json` — risk flag `agent_contract`, `estimated_complexity: "complex"` → Veles.
      - `missing-manifest.json` — empty → Veles default.
      - `malformed-manifest.json` — invalid JSON → Veles default.
      - `unwrapped-manifest.json` — valid inner object but missing `{ "manifest": ... }` wrapper → Veles default.
      - `unknown-flag-manifest.json` — contains an unrecognized risk flag → Veles default.
      - `sensitive-path-empty-flags.json` — touches `src/modules/coordinator/index.ts` but declares no risk flags → Veles default.
      - `mismatched-files.json` — manifest lists files not present in `gitDiffNames` → Veles default.
      - `no-trusted-files.json` — valid mechanical manifest but `gitDiffNames` is empty → Veles default.
    - Assert that Perun's Workflow 3 classification logic selects the correct executor for each fixture.
    - Note: this tests the prompt-level classification rule, not live `dispatch_parallel`.
  7. Add eval scenarios to `docs/eval/scenarios/veles/` with expected outputs for manual runs.
  8. Add eval scenarios to `docs/eval/scenarios/perun/` for headless dispatch and routing behavior.
  9. Verify `scripts/verify-dist-sync.mjs` already tracks root `dist/` (which covers `dist/skills/veles/` and `dist/commands/veles-*.md`). No edit needed unless a new top-level path is added.
  10. Verify root `package.json` `files[]` includes `dist/` (covers new assets). No edit expected.
  11. Run `bun run build:root` and per-package builds.
  12. Run `bun run check` (typecheck + test + build).
  13. Run `bun run verify-dist`.
  14. Run manual acceptance checks from the Acceptance criteria section.

**Tests:**
- `bun run test` passes.
- `bun run typecheck` passes.
- `bun run build` passes.
- `bun run verify-dist` passes.
- All acceptance criteria from the Acceptance criteria section above are met.

**Commit step:** `test(veles,perun): integration tests and acceptance for multi-mode veles`

---

## Acceptance criteria

- [ ] Direct-user natural message *“design multi-mode Veles”* produces a spec in `docs/specs/` with `status: "ok"`, `type: "spec"`, and `plan_path` populated.
- [ ] Direct-user natural message *“plan the implementation of multi-mode Veles”* produces an implementation plan in `docs/plans/` with `status: "ok"`, `type: "implementation-plan"`, and `plan_path` populated.
- [ ] Direct-user natural message *“create a QA plan for PR #123”* produces a test plan in `docs/testing/plans/` with `status: "ok"`, `type: "qa"`, and `fe_count`/`be_count`/`setup_prereqs` populated.
- [ ] Direct-user ambiguous message triggers at most one clarifying question.
- [ ] `/veles:spec <topic>`, `/veles:plan <topic>`, and `/veles:qa-plan [source]` work as explicit shortcuts (in direct Veles session or via Perun routing, depending on Task 2.5 decision).
- [ ] `/qa:create-plan` continues to work and produces a QA plan (globally available; behaves as a standalone QA command if cross-agent dispatch is not feasible).
- [ ] Headless Perun dispatch with explicit `Mode:` and structured envelope never calls `question` and returns a complete JSON contract.
- [ ] Headless Perun dispatch without an explicit mode returns `status: "needs_clarification"`.
- [ ] `src/modules/plan/veles.md` contains direct-user intent classification, headless envelope handling, and the full output schema.
- [ ] `packages/skill-registry/src/index.ts` includes `dist/skills/veles` and both new skills load successfully at runtime after build.
- [ ] Perun Workflow 3 dispatches `triglav` to produce a change manifest before triage.
- [ ] Perun Workflow 3 routes mechanical changes to Stribog, simple implementation changes to Svarog, and complex/safety-sensitive changes through Veles.
- [ ] Security-sensitive requests (auth/egress/new agent/public contract) always route through Veles; break-glass override is unavailable for these categories.
- [ ] A second run of the same spec/plan topic produces a suffixed path (`-2`) instead of overwriting, enforced by an atomic path reservation tool.
- [ ] Existing tests pass; new tests for skill loading, prompt contract, manifest routing, and collision handling pass.
- [ ] `bun run check` passes.
- [ ] `bun run verify-dist` passes and new `dist/skills/veles/` + `dist/commands/veles-*.md` paths are committed.

---

## Verification plan

1. **Build verification:** `bun run build:root` emits `dist/skills/veles/**` and `dist/commands/veles-*.md`.
2. **Skill loading:** `load_appverk_skill("feature-spec-authoring")` and `load_appverk_skill("implementation-plan-authoring")` return markdown without error.
3. **Prompt behavior:** Headless Veles dispatch with explicit `Mode:` returns valid JSON; ambiguous headless prompt returns `needs_clarification`; direct-user classification works for natural messages.
4. **Command registration:** `/veles:spec`, `/veles:plan`, `/veles:qa-plan` are visible and produce the expected artefacts.
5. **Perun triage:** Mechanical → Stribog, simple → Svarog, complex/safety-sensitive → Veles.
6. **Full acceptance:** All criteria from the Acceptance criteria section are checked.
7. **CI health:** `bun run check` and `bun run verify-dist` pass.

## Risk register

| Risk | Severity | Owner/phase | Mitigation |
|---|---|---|---|
| OpenCode command SDK does not support cross-agent dispatch (Option A for BLK-05) | HIGH | Task 2.5 | Run feasibility spike before Phase 2; default to Option C (direct-session-only) if Option A is unavailable |
| Skill registry still misses `dist/skills/veles/` after build | MEDIUM | Task 1 | Verify `scripts/copy-root-assets.mjs` handles `src/skills/**`; add explicit glob only if verification fails |
| Perun JSON parsing breaks on old QA-only contract | HIGH | Task 2 | Keep legacy QA fields (`plan_path`, `fe_count`, `be_count`, `setup_prereqs`) alongside new `type`/`summary`; update `perun-veles-flow.test.ts` |
| Headless Veles hangs on `question` | HIGH | Task 2 | Prompt-level prohibition in `veles.md` plus a `tool.execute.before` gate in `src/modules/plan/index.ts` that rejects `question` for headless Veles sessions |
| Triglav change manifest is unreliable | MEDIUM | Task 4 | Require deterministic manifest marker; default to `complex` on missing/malformed manifest; add fixture tests |
| Output directory collisions | MEDIUM | Task 1 + Task 3 | Enforce via atomic `veles_reserve_planning_path` tool; add parallel collision test |
| Documentation becomes inconsistent with implementation | MEDIUM | Task 5 | Update README, AGENTS.md, `docs/veles-planning.md`, `docs/agent-contracts.md`; grep for stale `docs/superpowers/` links |

## Rollout

1. Merge Phase 1 commit when skills load and `veles.md` is updated.
2. Merge Phase 2 commit when the command routing decision is recorded and commands are registered.
3. Merge Phase 3 commit when Perun triage and headless dispatch are wired.
4. Merge Phase 4 commit when user-facing documentation and agent contracts are updated.
5. Merge Phase 5 commit when all integration tests and acceptance criteria pass.

## Open follow-ups

- Run Task 2.5 spike to decide BLK-05 Option A, B, or C before Phase 2.
- Build eval corpus for direct-user intent classification if accuracy is poor.
- Tune triage thresholds after real usage.
- Migrate Perun Workflow 1 to the unified `plan_path`/`topic`/`summary` fields and drop legacy QA-only fields in a future refactor.
