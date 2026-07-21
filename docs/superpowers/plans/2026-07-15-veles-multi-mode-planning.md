# Plan: Multi-mode planning for Veles

**Status:** draft  
**Date:** 2026-07-15  
**Topic:** `veles-multi-mode-planning`  
**Source:** Internal audit of `src/modules/plan/` + research into [`obra/superpowers`](https://github.com/obra/superpowers), [`alvinunreal/oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim) and [`code-yeongyu/oh-my-openagent`](https://github.com/code-yeongyu/oh-my-openagent).

---

## 1. Objective

Extend Veles from a single-purpose QA-test-plan author into a general Pantheon planning specialist that can produce three durable planning artefacts:

1. **Feature specification** (`spec`) — a design document that answers *what* and *why* before any code is written.
2. **Implementation plan** (`plan`) — a task-by-task execution document that answers *how*, including files, interfaces, tests and commit steps.
3. **QA test plan** (`qa`) — the existing manual-test plan format (preserved unchanged).

Veles must remain dispatchable by Perun, usable directly by the user via slash commands, and aligned with the existing skill/registry/build pipeline. Perun must triage mechanical changes to Stribog, simple implementation changes to Svarog, and route only complex or safety-sensitive changes through Veles, so planning does not become a bureaucratic overhead.

---

## 2. Background & research synthesis

### 2.1. Current Pantheon baseline

- `src/modules/plan/veles.md` declares only one active mode: **QA test plan** (`skill(name: "qa-plan-authoring")`).
- The output contract is hard-coded to QA metrics: `{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`.
- Perun’s Workflow 1 (`src/agents/perun.md:112-124`) dispatches Veles only for QA plans and expects the QA-specific JSON.
- Workflow 3 (`src/agents/perun.md:590-599`) mentions Veles for feature-build planning but provides no mode or skill for it.
- Veles is `mode: "all"` and registered in `DISPATCHABLE_ALL_AGENTS` (`src/modules/coordinator/dispatch.ts:105-107`), so Perun can already route to it.

### 2.2. Superpowers (`obra/superpowers`)

- Pipeline: `brainstorming` → `writing-plans` → `subagent-driven-development`/`executing-plans`.
- **Specs** live in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
- **Plans** live in `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`.
- Strong patterns:
  - Hard gate: no implementation without an approved design.
  - Section-by-section spec review with user approval.
  - Plans written for a “junior worker without context” — no placeholders.
  - Each task lists `Files`, `Interfaces`, concrete steps, tests, and a commit step.
  - Task-brief extraction and per-task review to limit context bloat.

### 2.3. oh-my-openagent (`code-yeongyu/oh-my-openagent`)

- Command-driven entry points: `/start-work` (Prometheus planner), `/ultrawork`, `/init-deep`.
- Planner agent **Prometheus** interviews the user, identifies scope and ambiguities, and builds a verified plan before any code is touched.
- **Hyperplan** — a Team Mode skill that runs 5 hostile critics in parallel to tear apart a plan from orthogonal angles before implementation.
- **Team Mode** — lead agent + up to 8 parallel members with dedicated `team_*` tools, real-time tmux visualization, and category-based model routing.
- Strong patterns:
  - Interview-mode planning: ask clarifying questions one-by-one, then lock the plan.
  - Adversarial plan review as a first-class phase, not an afterthought.
  - Category-based delegation (`visual-engineering`, `deep`, `quick`, `ultrabrain`) rather than hard-coded model names.
  - Durable state files (`.omo/ulw-loop/`) for multi-goal orchestration.

### 2.4. oh-my-opencode-slim (`alvinunreal/oh-my-opencode-slim`)

- Command-driven entry points: `/interview`, `/deepwork <task>`.
- Artefacts:
  - `interview/<slug>.md` — structured spec + Q&A history.
  - `.slim/deepwork/<slug>.md` — persistent phased execution state.
  - `.slim/codemap.json` / per-folder `codemap.md` — durable repo atlas.
- Strong patterns:
  - `verification-planning` skill builds an *evidence path* before implementation.
  - Scheduler-first orchestration with dependency graphs, background lanes and file ownership.
  - Explicit agent roles: `@explorer`, `@oracle`, `@fixer`, etc.

### 2.5. What we will adopt

| Pattern | Source | How we adapt it |
|---|---|---|
| Separate skills per artefact type | Superpowers | `feature-spec-authoring`, `implementation-plan-authoring`, keep `qa-plan-authoring` |
| No-placeholder plan rule | Superpowers | Mandatory `Files`, `Interfaces`, `Tests`, `Commit` per task |
| Hard spec → plan → code gate | Superpowers | Veles emits specs; Perun asks for approval before dispatching Svarog; mandatory plan for complex changes |
| Three-lane executor routing | Pantheon existing | Mechanical → Stribog, simple implementation → Svarog, complex → Veles → Svarog |
| Trusted headless envelope | Internal | Perun dispatches Veles with `Execution context: perun-headless` to prevent headless hangs |
| Section-by-section validation | Superpowers | Self-review checklist inside each skill; user consent gate in Perun |
| IntentGate / intent classification | oh-my-openagent | In direct-user sessions Veles infers `spec`/`plan`/`qa` from the user message; slash commands are optional shortcuts; Perun-dispatched sessions use explicit modes |
| Adversarial plan review | oh-my-openagent | `momus` reserved helper becomes a critique phase inside each skill |
| Evidence path / verification plan | OMO slim | Optional future `verification-plan-authoring` skill |
| Durable artefact paths | All three | `docs/specs/` for specs, `docs/plans/` for implementation plans, `docs/testing/plans/` for QA |
| Slash-command UX | OMO slim / oh-my-openagent | `/veles:spec`, `/veles:plan`, `/veles:qa-plan` |
| Category-based delegation | oh-my-openagent | Veles may dispatch `triglav`/`oracle`/`momus` by role, not model name |

We intentionally **defer** to a later phase:
- scheduler-first background orchestration (OMO slim),
- durable codemap / repo atlas (OMO slim),
- per-task subagent handoff with task-brief scripts (Superpowers),
- Team Mode / multi-agent hostile review (oh-my-openagent).

These are valuable but out of scope for the MVP.

---

## 3. Proposed architecture

### 3.1. Intent classification and mode detection

Veles is a **planning executor**, not a workflow router. The orchestrator (Perun) decides *when* to plan; Veles decides *how* to plan once the mode is known. This keeps a single source of truth for workflow routing.

**Two distinct contexts:**

| Context | Who classifies | How mode is provided to Veles | Can Veles ask clarifying questions? |
|---|---|---|---|
| **Direct user session** (Veles picked in the agent picker) | Veles | Inferred from natural message; explicit slash command overrides | Yes — one question at a time |
| **Perun-dispatched session** | Perun | Explicit `Mode: ...` prefix in the prompt | **No** — headless dispatch must not block on `question` |

**Classification inputs (direct-user context only):**

1. **Slash command** — `/veles:spec`, `/veles:plan`, `/veles:qa-plan` — maps directly to a mode.
2. **Explicit mode prefix** — e.g. `Mode: spec` — overrides any inference.
3. **Intent classification from message text** — the default path.

**Intent classes (for direct-user inference):**

| Mode | Typical user message signals |
|---|---|
| `spec` | “design …”, “spec out …”, “how should we build …”, “what are the requirements for …”, “write a spec for …”, “define the feature …” |
| `implementation-plan` | “plan the implementation of …”, “break … into tasks”, “how do we implement …”, “create a plan for …”, “task list for …” |
| `qa` | “test plan for …”, “how do we QA …”, “manual test scenarios for …”, “qa plan for PR #123” |

**Classification mechanism (direct-user):**

- Primary: lightweight LLM-based classification performed inside Veles before loading any skill.
- Fallback: keyword/heuristic rules (the table above) when the classifier is uncertain.
- Tie-breaker: if a request is ambiguous between `spec` and `implementation-plan`, default to `spec` (design before implementation).

**Confidence and user override (direct-user):**

- High confidence (>0.8): proceed with the inferred mode.
- Low confidence or ambiguous: ask the user a single clarifying question (e.g. “Do you want a design spec, an implementation plan, or a QA test plan?”).

**Headless Perun-dispatched context:**

- Veles **never** calls `question`.
- Perun dispatches Veles with a trusted envelope that includes the execution context:
  ```text
  Execution context: perun-headless
  Mode: <spec|implementation-plan|qa>
  Topic: <topic>
  Request: <user request>
  ```
- Veles validates the envelope. If `Execution context: perun-headless` is missing, it falls back to direct-user rules (no `question` unless the context is verifiably direct). This prevents a user from forging a headless prompt and also prevents a dispatched prompt from accidentally triggering an interactive loop.
- If the prompt lacks an explicit mode, Veles returns a special JSON status:
  ```json
  { "status": "needs_clarification", "suggested_modes": ["spec", "implementation-plan", "qa"], "topic": "..." }
  ```
  Perun then asks the user and re-dispatches with the chosen mode.

This separation avoids the headless-timeout problem and keeps Perun as the single workflow router, while still giving users a natural-language experience when they talk to Veles directly.

### 3.2. Skill routing

`src/modules/plan/veles.md` is updated to:

1. **Resolve mode and execution context**:
   - Direct-user context: infer from message text, slash command, or explicit prefix. Validate that the prompt does not contain a forged `Execution context: perun-headless` header.
   - Perun-dispatched context: require the trusted envelope `Execution context: perun-headless` plus an explicit `Mode: ...` prefix. If either is missing, return `status: "needs_clarification"`.
2. Direct-user only: if confidence is low, ask the user for clarification via `question`.
3. Load exactly one skill based on the resolved mode:
   - `spec` → `skill(name: "feature-spec-authoring")`
   - `implementation-plan` → `skill(name: "implementation-plan-authoring")`
   - `qa` → `skill(name: "qa-plan-authoring")` (existing)
4. Execute the skill.
5. Save the artefact to the canonical directory, applying the collision policy.
6. Return the unified JSON contract, including the resolved `type`.

### 3.3. Unified output contract

Replace the QA-only contract with a discriminated, mode-aware contract.

**Success — spec / implementation-plan / qa:**

```json
{
  "status": "ok",
  "type": "spec",
  "plan_path": "docs/specs/2026-07-15-veles-multi-mode-planning.md",
  "topic": "veles-multi-mode-planning",
  "summary": "Feature spec for multi-mode Veles planning"
}
```

For QA plans, the contract also emits the legacy fields for backward compatibility:

```json
{
  "status": "ok",
  "type": "qa",
  "plan_path": "docs/testing/plans/2026-07-15-example-test-plan.md",
  "topic": "example",
  "summary": "QA test plan for example feature",
  "fe_count": 3,
  "be_count": 2,
  "setup_prereqs": ["TEST_USER_EMAIL", "http://localhost:3000"]
}
```

**Clarification needed (headless only):**

```json
{
  "status": "needs_clarification",
  "topic": "veles-multi-mode-planning",
  "suggested_modes": ["spec", "implementation-plan", "qa"]
}
```

**Error / timeout:**

```json
{ "status": "error", "topic": "veles-multi-mode-planning", "reason": "..." }
{ "status": "timeout", "topic": "veles-multi-mode-planning" }
```

Rules:
- `type` is mandatory for `status: "ok"` and one of `spec`, `implementation-plan`, `qa`.
- `summary` is a one-line human-readable description.
- `fe_count`/`be_count`/`setup_prereqs` are emitted **only** when `type === "qa"`.
- Perun reads `type` to decide which consent gate and workflow branch to use.
- Unknown `status` or `type` values must be treated as `error` by Perun.
- Update `docs/agent-contracts.md` and `tests/modules/coordinator/perun-veles-flow.test.ts` to reflect the new schema.

### 3.4. Collision policy for durable artefacts

Specs and plans are durable records. The save logic is deterministic and never silently overwrites:

- If the canonical path does not exist, write to it.
- If the canonical path exists, write to a suffixed path (`-2`, `-3`, …) and mention both paths in the summary.
- The only exception is an explicit user instruction to update an existing artefact (e.g. "update docs/specs/2026-07-15-foo-spec.md"), in which case Veles overwrites that exact path.
- Approval state is stored in the artefact frontmatter (`approved: true`, `approved_at`, `approved_by_session`) by Perun after the approval gate. Veles does not itself mark artefacts as approved.
- QA test plans follow the same rule: existing plans are never overwritten; new runs get suffixed paths. This preserves the existing QA naming convention while avoiding accidental data loss.

This policy avoids the need for a separate durable approval store and keeps the artefact file as the single source of truth.

---

## 4. New skills

### 4.1. `feature-spec-authoring`

**Location:** `src/skills/veles/feature-spec-authoring/SKILL.md`

**Purpose:** Produce a design spec before implementation. Used by Perun for complex or safety-sensitive changes.

**Steps (high-level):**

1. **Interview** — in direct-user context, ask the user clarifying questions one at a time until scope, success criteria and constraints are locked (Prometheus-style). Stop early if the request is already precise. In headless Perun-dispatched context, skip the interview and use only the provided request text plus repo context.
2. **Scope and context** — read the request, recent commits, relevant code, `AGENTS.md`, `docs/configuring-agents.md`.
3. **Draft sections**:
   - Goal
   - Background / motivation
   - Constraints (invariants from existing architecture)
   - User stories / requirements
   - Proposed architecture
   - Data model / state changes
   - API / command surface changes
   - Security / auth considerations
   - Testing strategy
   - Rollout / migration
   - Open questions
4. **Self-review** — refute each requirement against the codebase; check for contradictions with `AGENTS.md`.
5. **Adversarial self-critique** — an internal prompt pass that attacks ambiguities, hidden assumptions, and untestable requirements. This is **not** a subagent dispatch; `momus` is still reserved and unavailable.
6. **Save** to `docs/specs/YYYY-MM-DD-<topic>-spec.md`.

**Output contract fields:** `type: "spec"`.

### 4.2. `implementation-plan-authoring`

**Location:** `src/skills/veles/implementation-plan-authoring/SKILL.md`

**Purpose:** Convert an approved spec (or user request) into an executable implementation plan. Used by Perun for complex changes; simple changes may bypass this step and go directly to Svarog.

**Inputs:**
- A path to an existing spec (`spec_path`) OR a user request that will be turned into a lightweight inline spec.

**Hard gate rule:**
- In Perun-driven workflow, an implementation plan MUST be produced from an approved spec saved to `docs/specs/`.
- In direct-user sessions, if the user asks for an implementation plan without a prior spec, Veles may produce a lightweight inline spec first, but it must clearly mark it as unapproved and recommend reviewing it before coding.

**Steps:**

1. **Validate inputs** — in Perun-driven workflow, require a `spec_path` to an approved spec. If it is missing, return `status: "error"`.
2. **Load context** — read the spec, explore affected code with `triglav`.
3. **Decompose into tasks** — each task must be independently implementable.
4. **For each task emit:**
   - `### Task N: <title>`
   - `Files:` — files to create/modify/delete
   - `Interfaces:` — public APIs, agent keys, commands, hooks affected
   - `Steps:` — concrete implementation steps
   - `Tests:` — how to verify the task (unit, integration, eval scenario)
   - `Commit step:` — a Conventional Commit message and the staged file set
5. **No-placeholder rule** — every task must have all five fields; no “TBD”.
6. **Verification plan** — how the whole feature will be verified after all tasks.
7. **Risk register** — what could go wrong and mitigations.
8. **Adversarial self-critique** — internal prompt pass that checks for missing tasks, ordering hazards, and under-specified interfaces. No subagent dispatch; `momus` remains reserved.
9. **Save** to `docs/plans/YYYY-MM-DD-<topic>-plan.md`.

**Output contract fields:** `type: "implementation-plan"`.

### 4.3. `verification-plan-authoring` (Phase 4)

**Location:** `src/skills/veles/verification-plan-authoring/SKILL.md`

**Purpose:** Produce an evidence path for a change before implementation, similar to OMO slim’s `verification-planning`.

This skill is optional for the MVP and can be added after `spec` and `plan` are stable.

---

## 5. User entry points (slash commands + natural language)

Veles is invoked in two ways:

1. **Direct user session** — natural-language messages are classified by Veles itself.
2. **Slash commands** — explicit shortcuts that resolve to a prompt with a `Mode: ...` prefix.

| Entry point | File | Explicit mode | Output directory |
|---|---|---|---|
| Natural message in direct Veles session, e.g. *“design multi-mode Veles”* | n/a | inferred `spec` | `docs/specs/` |
| Natural message in direct Veles session, e.g. *“plan the implementation of multi-mode Veles”* | n/a | inferred `implementation-plan` | `docs/plans/` |
| `/veles:spec <topic>` | `src/commands/veles-spec.md` | `spec` | `docs/specs/` |
| `/veles:plan <topic>` | `src/commands/veles-plan.md` | `implementation-plan` | `docs/plans/` |
| `/veles:qa-plan [source]` | `src/commands/veles-qa-plan.md` | `qa` | `docs/testing/plans/` |

**Command routing:**

- In a **direct Veles session**, the command is interpreted by Veles itself.
- In a **default Perun session**, the command is interpreted by Perun, which dispatches Veles with the appropriate `Mode:` prefix and trusted envelope.
- The command markdown files do not load skills themselves; they only produce a normalized prompt. Skill loading and execution always happen inside Veles.

**Command migration decision:** `/qa:create-plan` becomes a backward-compatible alias for `/veles:qa-plan`. It is not deprecated in Phase 1; deprecation policy is deferred to Phase 4.

### 5.1. Command prompt shape

`src/commands/veles-spec.md`:

```markdown
---
name: veles-spec
description: Ask Veles to author a feature specification.
---

# /veles:spec

Forward to Veles with the explicit mode prefix.

In a **direct Veles session**:
```text
Mode: spec
Topic: <topic>
Request: <user request>
```

In a **Perun session**, Perun appends the trusted envelope before dispatching:
```text
Execution context: perun-headless
Mode: spec
Topic: <topic>
Request: <user request>
```

Veles loads `feature-spec-authoring`, saves the artefact, and returns the JSON contract.
```

`src/commands/veles-plan.md` mirrors this for `implementation-plan`.

`src/commands/veles-qa-plan.md` mirrors this for `qa` and preserves the existing diff-source resolution rules.

---

## 6. Perun integration

### 6.0. Complexity triage

Perun must decide whether a request needs full planning or can go straight to implementation. Requiring a written spec for every change creates unnecessary overhead; skipping planning for complex or security-sensitive changes creates rework and risk.

**Three executor lanes:**

| Lane | Executor | Typical change |
|---|---|---|
| **Mechanical** | Stribog | Trivial, safe, 1–2 file changes (typos, formatting, renames, dead-code removal) |
| **Implementation without written plan** | Svarog | Small, well-bounded changes (≤3 files, local logic, no new agents/commands/security/contract changes) |
| **Complex / design-sensitive** | Veles → Svarog | New agents/commands/skills/MCPs, auth/authz/security/egress changes, public contract changes, cross-module changes, or user explicitly asks for a spec/plan |

**Hard safety rules — never bypass Veles:**

Perun **must** route through Veles when ANY of the following hold:
- The change creates a new agent, command, MCP, skill, or module.
- It changes auth/authz, rate-limiting, security headers, secrets handling, or external egress.
- It introduces a new public API, agent output contract, or configuration surface.
- It requires cross-module coordination.
- The user explicitly asks for a spec or implementation plan.

These safety rules are **not** overridable by `/svarog` or any other user shortcut. The user can override only the *mechanical* vs *implementation* lane for changes that do not trigger the safety rules.

**Triage source of truth:**

Perun does **not** run `git` commands directly (the coordinator bash allowlist is limited). Instead it uses:

1. A **change manifest** produced by `triglav` when a diff/PR/branch is available. The manifest includes:
   - touched files,
   - affected modules/packages,
   - whether any file touches security, auth, contracts, or agent registry,
   - whether any new agent/command/skill/MCP is introduced.
2. The user request text when no diff is available.
3. A fallback to **complex** when the manifest is ambiguous or missing.

Perun may ask the user one clarifying question before triage if the request is ambiguous.

### 6.1. Workflow 3 update

Update `src/agents/perun.md` Workflow 3 (Feature build):

```text
1. Triage the request.
   a. If the user provided a PR/branch, dispatch triglav to produce a change
      manifest (files, modules, security/contract/agent flags).
   b. If the change is mechanical (§6.0), dispatch Stribog.
   c. If the change is simple implementation without written plan (§6.0), dispatch
      Svarog directly. Optionally instruct Svarog to produce a lightweight
      inline plan scratch.
   d. If the change is complex or safety-sensitive (§6.0), continue.
2. Plan if needed.
   a. If a spec already exists at docs/specs/YYYY-MM-DD-<topic>-spec.md, use it
      (subject to collision policy §3.4).
   b. Else dispatch Veles with the trusted envelope:
      Execution context: perun-headless
      Mode: spec
      Topic: <topic>
      Request: <user request>
   c. Parse the JSON contract. If status === "ok" and type === "spec", show a
      planning-consent gate:
      "Veles authored a feature spec. Review and approve before implementation?"
   d. On approval, dispatch Veles with the trusted envelope:
      Execution context: perun-headless
      Mode: implementation-plan
      Spec path: <path>
      to produce docs/plans/YYYY-MM-DD-<topic>-plan.md.
   e. On rejection, stop; the spec is saved.
3. If an implementation plan exists and the user approved it, dispatch Svarog
   with the plan path.
```

For complex changes the implementation plan is **mandatory**, not optional. The spec approval alone does not authorize code changes.

Perun is the single source of truth for workflow routing; it always provides Veles with an explicit mode. If Perun cannot decide which mode is appropriate, it asks the user before dispatching Veles.

### 6.2. Consent gates

Add two new consent gate templates after the existing QA-planning gate (`src/agents/perun.md:563-586`):

- **Spec approval gate** — for `type === "spec"`. Must surface the artefact path and the fact that the next step will be an implementation plan.
- **Implementation plan approval gate** — for `type === "implementation-plan"`. Must surface the artefact path and the source spec path.

Both gates must require explicit user approval before proceeding. For complex / safety-sensitive changes, the implementation plan gate is mandatory and Svarog cannot be dispatched without it. The gate must not claim inference was performed by Veles unless the user was talking directly to Veles.

### 6.3. JSON parsing and routing

After complexity triage (§6.0), Perun routes to one of three executor lanes. For Veles responses, Perun validates the full schema from §3.3 and branches:

- `status: "ok"` + `type: "qa"` → existing QA loop.
- `status: "ok"` + `type: "spec"` → spec approval gate, then mandatory implementation-plan dispatch.
- `status: "ok"` + `type: "implementation-plan"` → plan approval gate, then dispatch Svarog.
- `status: "needs_clarification"` → ask the user and re-dispatch with the chosen explicit mode.
- `status: "error"` or `status: "timeout"` → surface to the user; do not proceed.
- Missing/unknown `status` or `type` → treat as `error` and stop.

Perun must also validate that every `plan_path` returned by Veles is inside one of the canonical directories (`docs/specs/`, `docs/plans/`, `docs/testing/plans/`).

---

## 7. File-level change list

### 7.1. Source files to modify

| File | Change |
|---|---|
| `src/modules/plan/veles.md` | Add intent classification (direct-user only), mode detection, skill routing, unified output contract, new mode instructions |
| `src/modules/plan/index.ts` | No structural change required; model slug remains `veles` |
| `src/modules/plan/allowed-tools.ts` | Consider adding `webfetch` for external research (optional) |
| `packages/skill-registry/src/index.ts` | Add `dist/skills/veles` to `skillDirectories` so new skills are discoverable |
| `src/agents/perun.md` | Update Workflow 3 with triage + triglav manifest, add spec/plan consent gates, parse full schema |
| `src/index.ts` | No change unless skill discovery path needs registration |
| `scripts/copy-root-assets.mjs` | Ensure new `src/skills/veles/` and `src/commands/veles-*.md` are copied to `dist/` |
| `scripts/verify-dist-sync.mjs` | Verify new paths if they change the published surface |

### 7.2. New files to create

| File | Purpose |
|---|---|
| `src/skills/veles/feature-spec-authoring/SKILL.md` | Spec-authoring skill |
| `src/skills/veles/implementation-plan-authoring/SKILL.md` | Implementation-plan skill |
| `src/commands/veles-spec.md` | `/veles:spec` command |
| `src/commands/veles-plan.md` | `/veles:plan` command |
| `src/commands/veles-qa-plan.md` | `/veles:qa-plan` command (or update `create-qa-plan.md`) |
| `tests/modules/plan/veles-multi-mode.test.ts` | Tests for mode routing and output contract |
| `docs/specs/` and `docs/plans/` directories | Canonical output locations |

### 7.3. Documentation updates

| File | Update |
|---|---|
| `README.md` | Update the Veles entry in the agent overview table; add slash commands and a link to `docs/veles-planning.md` |
| `AGENTS.md` | Update the `src/modules/plan/` row in the monorepo-layout table; add to the Documentation Checklist that durable planning artefacts live in `docs/specs/` and `docs/plans/` |
| `docs/veles-planning.md` | **New user-facing reference** describing the three modes, natural-language invocation, slash commands, output directories, and approval flow |
| `docs/agent-contracts.md` | Update Veles contract description with the new `type`/`summary` shape and the `needs_clarification` status |
| `docs/configuring-agents.md` | No change unless new model config is added (Veles slug stays `veles`) |

---

## 8. Output directory conventions

```text
docs/specs/YYYY-MM-DD-<topic>-spec.md
docs/plans/YYYY-MM-DD-<topic>-plan.md
docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md   (existing)
```

The directories `docs/specs/` and `docs/plans/` become canonical, permanent locations. They are **not** under `docs/superpowers/` because the specs and plans produced for real features are durable design records, not temporary brainstorming artefacts.

See §3.4 for the collision policy that prevents accidental overwrites of any durable artefact.

---

## 9. Testing strategy

### 9.1. Unit / prompt tests

- Extend `tests/modules/plan/veles-prompt.test.ts` to assert:
  - Intent-classification instructions are present.
  - Headless trusted-envelope instructions are present.
  - Mode-detection instructions are present.
  - Unified output contract schema is documented.
  - Each mode maps to the correct skill.
- Add `tests/modules/plan/veles-multi-mode.test.ts` with fixture prompts and expected JSON outputs, including:
  - natural-language prompts classified without explicit mode prefixes,
  - headless prompts with and without trusted envelope,
  - `needs_clarification` responses.
- Add behavioral / integration tests:
  - runtime skill loading after build,
  - Perun → Veles → Svarog handoff with mocked approval,
  - collision policy: second run produces suffixed path,
  - security-sensitive request cannot be triaged to Svarog/Stribog.

### 9.2. Integration / eval scenarios

Add eval scenarios under `docs/eval/scenarios/veles/`:

- `veles-spec-from-request.md` — Veles produces a spec from a natural user request (no slash command, no mode prefix).
- `veles-plan-from-request.md` — Veles produces an implementation plan from a natural user request.
- `veles-qa-plan-from-request.md` — Veles produces a QA plan from a natural user request.
- `veles-plan-from-spec.md` — Veles produces an implementation plan from an existing spec.
- `veles-mode-routing.md` — Veles returns the correct `type` for each explicit mode prefix.
- `veles-intent-ambiguity.md` — Veles asks a clarifying question when intent is ambiguous.
- `veles-headless-envelope.md` — Veles never calls `question` and respects the trusted headless envelope.
- `veles-collision-policy.md` — Second run produces a suffixed path.
- `perun-triage-security.md` — Perun routes a security-sensitive request through Veles despite a small file count.

### 9.3. Build verification

- Run `bun run build:root` and `bun run verify-dist` after adding skills/commands.
- Ensure `dist/skills/veles/` and `dist/commands/veles-*.md` are emitted and tracked.
- Verify `packages/skill-registry/src/index.ts` includes `dist/skills/veles` and that `load_appverk_skill` can load the new skills.

---

## 10. Phases

### Phase 0 — Skill discovery

- Update `packages/skill-registry/src/index.ts` to add `dist/skills/veles` to `skillDirectories`.
- Verify `scripts/copy-root-assets.mjs` copies `src/skills/veles/**/SKILL.md` to `dist/skills/veles/`.
- Run `bun run build:root` and confirm the new skills are loadable via `load_appverk_skill`.

### Phase 1 — Core skills and Veles prompt

- Create `src/skills/veles/feature-spec-authoring/SKILL.md`.
- Create `src/skills/veles/implementation-plan-authoring/SKILL.md`.
- Update `src/modules/plan/veles.md` with:
  - direct-user intent classification,
  - headless-safe mode resolution,
  - skill routing,
  - unified output contract,
  - collision policy.
- Create `docs/specs/` and `docs/plans/` directories.
- Add prompt tests.

### Phase 2 — Commands and user-facing docs

- Create `src/commands/veles-spec.md` and `src/commands/veles-plan.md`.
- Alias `src/commands/create-qa-plan.md` to `/veles:qa-plan`.
- Create `docs/veles-planning.md`.
- Update `README.md`, `AGENTS.md`, and `docs/agent-contracts.md`.
- Add command / intent eval scenarios.

### Phase 3 — Perun integration

- Update `src/agents/perun.md` Workflow 3 with complexity triage (§6.0).
- Dispatch mechanical changes to Stribog.
- Dispatch simple implementation changes to Svarog directly.
- Dispatch complex / safety-sensitive changes to Veles with explicit modes and trusted envelope.
- Add spec and implementation-plan consent gates.
- Update JSON parsing to validate the full schema and handle `needs_clarification`.
- Add eval scenarios for Perun → Veles → Svarog handoff, mechanical → Stribog, and simple → Svarog direct dispatch.

### Phase 4 — Verification plan (optional)

- Add `src/skills/veles/verification-plan-authoring/SKILL.md`.
- Add `/veles:verify-plan` command.
- Update Perun to use verification plans for risky changes.

### Phase 5 — Advanced orchestration (future)

- Durable repo atlas / codemap (OMO slim pattern).
- Scheduler-first dependency dispatch (OMO slim pattern).
- Task-brief extraction and per-task review (Superpowers pattern).
- Team Mode / parallel hostile review (oh-my-openagent `hyperplan` pattern) — when Pantheon adds background-team tooling, Veles can run `momus` × N critics in parallel before approving a plan.

---

## 11. Blockers / Findings

### BLK-01: New Veles skills are not discoverable by the skill registry

- **Location:** `packages/skill-registry/src/index.ts:30-36`
- **Impact:** `load_appverk_skill("feature-spec-authoring")` and `load_appverk_skill("implementation-plan-authoring")` will fail at runtime because `skillDirectories` is a hardcoded list that includes only `dist/skills/qa`, not `dist/skills/veles`.
- **Remediation:** Add `path.resolve(moduleDirectory, "../../../dist/skills/veles")` to `skillDirectories` in Phase 0, before any skill is used.
- **Blocks:** Phase 1 skill execution, Phase 3 Perun integration, and Phase 4 verification-plan skill.

### BLK-02: Direct-user `question` tool cannot be used in headless Perun dispatch

- **Location:** plan §3.1, §3.2
- **Impact:** If Veles calls `question` when dispatched by Perun, the child session will hang on the headless prompt and eventually timeout.
- **Remediation:** Veles must return `status: "needs_clarification"` in headless mode. Perun must ask the user and re-dispatch with an explicit mode.
- **Blocks:** Phase 3 Perun integration until the headless contract is explicit.

### BLK-03: Triage depends on a change manifest Perun cannot produce itself

- **Location:** plan §6.0
- **Impact:** Perun’s bash allowlist does not include `git`, so it cannot generate the changed-file list itself. Triage based on file count or PR metadata alone is unreliable.
- **Remediation:** Perun must dispatch `triglav` to produce a change manifest before triage. The manifest must flag security-sensitive, contract-affecting, and new-agent/command/skill/MCP changes.
- **Blocks:** Phase 3 Perun integration until the manifest contract is defined and triglav can produce it.

### BLK-04: Trusted execution context is not yet enforced

- **Location:** plan §3.1, §3.2, §6.1
- **Impact:** Without a verifiable envelope, Veles cannot safely distinguish direct-user sessions from headless Perun dispatches.
- **Remediation:** Define the exact envelope format (`Execution context: perun-headless`) and add a prompt-level invariant plus an integration test that verifies `question` is never called in headless mode.
- **Blocks:** Phase 3 Perun integration.

### BLK-05: Slash command routing to Veles is unspecified

- **Location:** plan §5
- **Impact:** It is not clear how `/veles:spec` executed in a default Perun session reaches Veles rather than the active agent.
- **Remediation:** Before Phase 2, confirm the OpenCode command dispatch mechanism. If a command cannot target a specific agent, limit slash commands to direct Veles sessions or implement a plugin-level command handler that dispatches Veles.
- **Blocks:** Phase 2 command implementation.

### Open design questions (not blockers)

1. **Web research tools.** Veles currently lacks `webfetch` / `google_search` in its allowed-tools. If specs require external research, add them to `src/modules/plan/allowed-tools.ts` and `veles.md`.
2. **Intent classifier accuracy.** Build a versioned eval corpus for direct-user intent classification. If accuracy is poor, add an explicit confirmation sub-step before saving.
3. **False positives on ambiguous requests.** A message such as “plan the QA for this feature” could map to either `qa` or `implementation-plan`. The classifier should surface low-confidence cases to the user rather than guessing.
4. **Complexity triage thresholds.** The manifest-based rules in §6.0 are a starting point. Tune them based on real usage and project-specific risk appetite.

---

## 12. Acceptance criteria

- [ ] Direct-user natural message *“design multi-mode Veles”* produces a spec in `docs/specs/` with `type: "spec"`.
- [ ] Direct-user natural message *“plan the implementation of multi-mode Veles”* produces an implementation plan in `docs/plans/` with `type: "implementation-plan"`.
- [ ] Direct-user natural message *“create a QA plan for PR #123”* produces a test plan in `docs/testing/plans/` with `type: "qa"`.
- [ ] Direct-user ambiguous message triggers at most one clarifying question.
- [ ] `/veles:spec <topic>`, `/veles:plan <topic>` and `/veles:qa-plan [source]` work as explicit shortcuts (in direct Veles session or via Perun routing).
- [ ] `/qa:create-plan` continues to work as an alias for `/veles:qa-plan`.
- [ ] Headless Perun dispatch with explicit `Mode:` and trusted envelope never calls `question` and returns a complete JSON contract.
- [ ] Headless Perun dispatch without an explicit mode returns `status: "needs_clarification"`.
- [ ] `src/modules/plan/veles.md` contains direct-user intent classification, headless trusted-envelope handling, and the full output schema.
- [ ] `packages/skill-registry/src/index.ts` includes `dist/skills/veles` and both new skills load successfully at runtime after build.
- [ ] Perun Workflow 3 dispatches `triglav` to produce a change manifest before triage.
- [ ] Perun Workflow 3 routes mechanical changes to Stribog, simple implementation changes to Svarog, and complex/safety-sensitive changes through Veles.
- [ ] Security-sensitive requests (auth/egress/new agent/public contract) cannot be triaged to Stribog or Svarog without explicit break-glass approval.
- [ ] A second run of the same spec/plan topic produces a suffixed path (`-2`) instead of overwriting.
- [ ] Existing tests pass; new behavioral tests for routing, schema validation, skill loading, and collision handling pass.
- [ ] `bun run check` passes.
- [ ] `bun run verify-dist` passes and new `dist/skills/veles/` + `dist/commands/veles-*.md` paths are committed.

---

## 13. Detailed Blocker Resolutions

This section records the concrete implementation approach for each blocker identified in §11.

### 13.1. BLK-01 — Skill registry discovery

**Root cause:** `packages/skill-registry/src/index.ts:30-36` hardcodes five skill directories and does not scan `dist/skills/veles/`.

**Files to change:**

1. `packages/skill-registry/src/index.ts:34` — add `dist/skills/veles`:
   ```typescript
   const skillDirectories = [
     path.resolve(moduleDirectory, "../../python-developer/dist/skills"),
     path.resolve(moduleDirectory, "../../frontend-developer/dist/skills"),
     path.resolve(moduleDirectory, "../../code-review/dist/skills"),
     path.resolve(moduleDirectory, "../../../dist/skills/qa"),
     path.resolve(moduleDirectory, "../../../dist/skills/veles"),
     path.resolve(moduleDirectory, "../../swift-developer/dist/skills"),
   ]
   ```

2. `scripts/copy-root-assets.mjs` — ensure `src/skills/veles/**/SKILL.md` is copied to `dist/skills/veles/`. If the manifest is glob-based, add:
   ```javascript
   { from: "src/skills/veles", to: "dist/skills/veles" }
   ```

3. Create `src/skills/veles/feature-spec-authoring/SKILL.md` and `src/skills/veles/implementation-plan-authoring/SKILL.md`.

**Verification:**
```bash
bun run build:root
ls dist/skills/veles/
# expected: feature-spec-authoring/SKILL.md, implementation-plan-authoring/SKILL.md
```

**Test:** Add a skill-registry smoke test that calls `load_appverk_skill("feature-spec-authoring")` and `load_appverk_skill("implementation-plan-authoring")` without throwing.

---

### 13.2. BLK-02 — `question` in headless dispatch

**Root cause:** `veles.md` currently allows `question` in interview mode without distinguishing direct-user vs headless contexts.

**Files to change:**

1. `src/modules/plan/veles.md` — replace the `## Interview mode` section with:
   ```markdown
   ## Interview mode

   For ambiguous, custom planning requests, use `question` to clarify scope **only in direct-user sessions** (no `Execution context: perun-headless` envelope).

   In headless mode (`Execution context: perun-headless`), you MUST NOT call `question`. Instead, return:

   ```json
   {
     "status": "needs_clarification",
     "message": "<one-sentence description of what is missing>",
     "suggested_modes": ["spec", "implementation-plan", "qa"]
   }
   ```
   ```

2. `src/modules/plan/veles.md` — expand `## Output contract` to a discriminated union:
   ```markdown
   ## Output contract (REQUIRED)

   End your turn with a single JSON object as your final message — nothing after it.

   When `status` is `"ok"`, include the plan type:

   ```json
   {
     "status": "ok",
     "type": "spec",
     "artifact_path": "docs/specs/2026-07-15-example-spec.md",
     "topic": "example"
   }
   ```

   Allowed `type` values: `"spec"`, `"implementation-plan"`, `"qa"`.

   Other statuses:

   ```json
   { "status": "needs_clarification", "message": "...", "suggested_modes": ["spec", "implementation-plan", "qa"] }
   { "status": "error", "message": "...", "artifact_path": null }
   { "status": "timeout" }
   ```

   Return ONLY this JSON.
   ```

3. `src/agents/perun.md` — add after Workflow 3:
   ```markdown
   ### Headless Veles dispatch

   When dispatching `Veles - Planner` from a headless context, prepend to the prompt:

   ```text
   Execution context: perun-headless
   Mode: <spec|implementation-plan|qa>
   ```

   If Veles returns `status: "needs_clarification"`:
   1. Surface the `message` to the user.
   2. Ask the user to clarify or pick a mode.
   3. Re-dispatch Veles with the chosen mode.

   Do NOT re-dispatch with the same ambiguous prompt.
   ```

**Verification:**
- Eval test: prompt with `Execution context: perun-headless` and no `Mode:` → expect `status: "needs_clarification"`.
- Eval test: prompt with `Execution context: perun-headless` and `Mode: spec` → expect `status: "ok"`, `type: "spec"`.

---

### 13.3. BLK-03 — Change manifest for triage

**Root cause:** Perun cannot run `git` (bash allowlist), so it cannot produce the changed-file list needed for complexity triage.

**Files to change:**

1. `src/modules/explore/triglav.md` — add a change-manifest mode at the end:
   ```markdown
   ## Change manifest mode

   When the caller asks for a **change manifest**, produce a machine-readable JSON block after the normal `<results>` block:

   ```json
   {
     "manifest": {
       "files_changed": ["src/modules/plan/veles.md", "src/agents/perun.md"],
       "modules_affected": ["src/modules/plan", "src/agents"],
       "new_surface_types": [],
       "risk_flags": ["agent_contract", "public_api"],
       "estimated_complexity": "complex"
     }
   }
   ```

   Risk flags must include any of:
   - `auth` — auth/authz changes
   - `egress` — new external network calls
   - `agent_contract` — new/changed agent key, command, skill, MCP
   - `public_api` — user-facing API/contract change
   - `cross_module` — touches ≥2 modules
   - `data_migration` — schema/DB migration

   Complexity is one of: `mechanical`, `simple`, `complex`. Default to `complex` if uncertain.
   ```

2. `src/agents/perun.md` — replace `### Workflow 3: Feature build` with:
   ```markdown
   ### Workflow 3: Feature build / change implementation

   **Trigger:** User asks to implement, change, refactor, fix, or "do X".

   **Step 0 — Produce change manifest (read-only).**
   Dispatch `triglav` to map the change:

   ```javascript
   dispatch_parallel({
     agent: "triglav",
     summary: "change manifest for feature build",
     tasks: [{
       name: "triglav",
       prompt: "Produce a change manifest for the current branch diff vs main. Include: files_changed, modules_affected, new_surface_types, risk_flags (auth, egress, agent_contract, public_api, cross_module, data_migration), estimated_complexity (mechanical/simple/complex). READ-ONLY."
     }]
   })
   ```

   **Step 1 — Classify via manifest.**

   | Manifest condition | Route |
   |---|---|
   | `risk_flags` contains `auth`, `egress`, `agent_contract`, `public_api`, or `data_migration` | **Veles mandatory** → spec → approval → implementation plan → approval → Svarog |
   | `estimated_complexity === "mechanical"` AND ≤2 files AND no risk flags | **Stribog** |
   | `estimated_complexity === "simple"` AND no risk flags | **Svarog** |
   | `estimated_complexity === "complex"` OR ≥3 modules OR risk flags present | **Veles** → spec → plan → Svarog |
   | manifest missing or uncertain | default to **Veles** |

   **Step 2 — Execute.**
   - Stribog: one-shot light task.
   - Svarog: include `plan_path` if exists.
   - Veles: dispatch with `Execution context: perun-headless` and explicit `Mode:`.

   **Step 3 — User approval gates.**
   Before dispatching Svarog after Veles:
   1. Surface the spec/implementation plan path.
   2. Ask user for approval via `question`.
   3. On approval, continue. On decline, stop.
   ```

**Verification:**
- Eval test: manifest with `agent_contract` flag → dispatch Veles.
- Eval test: manifest `mechanical`, 1 file, no flags → dispatch Stribog.
- Eval test: missing manifest → default to Veles.

---

### 13.4. BLK-04 — Trusted execution context

**Root cause:** There is no reliable way for Veles to know whether it is talking to a user directly or executing headless for Perun.

**Files to change:**

1. `src/modules/plan/veles.md` — add after `## What you may write`:
   ```markdown
   ## Execution context

   Every prompt you receive has ONE of two contexts:

   1. **Direct-user session** — the user is talking to you directly. You MAY use `question` for clarification. You MUST classify intent from natural language if no explicit `Mode:` is given.

   2. **Headless Perun dispatch** — marked by a leading envelope:
      ```text
      Execution context: perun-headless
      Mode: <spec|implementation-plan|qa>
      ```
      In this context:
      - You MUST NOT use `question`.
      - You MUST trust the `Mode:` value.
      - If `Mode:` is missing or unknown, return `status: "needs_clarification"`.
      - You MUST return a complete JSON contract.
   ```

2. `src/modules/plan/veles.md` — extend `## Modes`:
   ```markdown
   ### Mode: Feature spec

   Trigger: `Mode: spec` in the prompt or a direct user request to design/spec a feature.

   1. Load and follow `skill(name: "feature-spec-authoring")`.
   2. Save to `docs/specs/YYYY-MM-DD-<topic>-spec.md`.
   3. Return JSON with `"type": "spec"`.

   ### Mode: Implementation plan

   Trigger: `Mode: implementation-plan` in the prompt or a direct user request to plan implementation.

   In headless mode, require an approved spec path (`spec_path`). If missing, return `status: "error"`.

   1. Validate `spec_path` points to an existing file.
   2. Load `skill(name: "implementation-plan-authoring")`.
   3. Save to `docs/plans/YYYY-MM-DD-<topic>-plan.md`.
   4. Return JSON with `"type": "implementation-plan"`.
   ```

**Verification:**
- Integration test: headless prompt without envelope and ambiguous request → direct-user behavior allowed.
- Integration test: headless prompt with `Execution context: perun-headless` and `Mode: spec` → complete JSON, no `question`.

---

### 13.5. BLK-05 — Slash command routing

**Root cause:** It is unclear whether OpenCode allows a slash command executed in a Perun session to dispatch `Veles - Planner`.

**Decision required before Phase 2:** verify the OpenCode SDK command model.

#### Option A — plugin-level command handler (preferred)
Register `/veles:spec`, `/veles:plan`, `/veles:qa-plan` in `src/modules/plan/index.ts` (or a dedicated command module). The handler:
1. Detects whether the current session agent is Perun or Veles.
2. If Perun: calls `dispatch_parallel({ agent: "Veles - Planner", ... })` with `Execution context: perun-headless` and `Mode:`.
3. If Veles: loads the appropriate skill directly.

#### Option B — agent-attached commands
If OpenCode routes commands only to the active agent, register commands under `Veles - Planner`. Users must switch to Veles (`@Veles - Planner /veles:spec ...`).

#### Option C — direct-session-only fallback
If commands cannot dispatch across agents, slash commands work only in direct Veles sessions. In Perun sessions users say: `@perun zaplanuj spec dla X`.

**Files to change regardless of option:**

1. `src/commands/veles-spec.md`:
   ```markdown
   ---
   allowed-tools: skill, question, todowrite
   argument-hint: [topic or natural language feature description]
   description: Author a feature specification.
   ---

   # Feature Spec Generator

   **Input:** `$ARGUMENTS`

   ## Workflow

   1. If this is a Perun session, dispatch `Veles - Planner` with:
      ```text
      Execution context: perun-headless
      Mode: spec
      User request: $ARGUMENTS
      ```
   2. If this is a Veles session, load `skill(name: "feature-spec-authoring")`.
   ```

2. `src/commands/veles-plan.md` (analogous, `Mode: implementation-plan`).

3. `src/commands/veles-qa-plan.md` (analogous, `Mode: qa`).

4. `src/commands/create-qa-plan.md` — update description to state it is an alias for `/veles:qa-plan`.

**Verification:**
- Manual test in Veles session: `/veles:spec test feature` → spec file.
- Manual test in Perun session: behavior depends on chosen option (A/B/C).

---

## 14. Implementation order

1. **BLK-01** (skill registry + build) — start first; unblocks everything else.
2. **BLK-02 + BLK-04** (headless contract + output schema) — one iteration.
3. **BLK-03** (change manifest + triage) — needs headless contract.
4. **BLK-05** (slash commands) — UX decision point; defer to end of Phase 2.

---

## 15. Appendix A — Example spec skeleton

```markdown
---
source: user request /veles:spec multi-mode-veles
branch: master
date: 2026-07-15
---

# Feature Spec: Multi-mode Veles

## Goal
Veles can author feature specs and implementation plans in addition to QA test plans.

## Background
Currently Veles only produces QA test plans (`src/modules/plan/veles.md`). Perun’s Workflow 3 references Veles for feature-build planning but no mode exists for it.

## Constraints
- Preserve the existing QA test-plan mode and output contract.
- Veles remains `mode: "all"` and Perun-dispatchable.
- New skills live under `src/skills/veles/`.

## Requirements
1. Natural-language messages in direct Veles sessions are classified into `spec`, `implementation-plan` or `qa` without requiring a slash command.
2. `/veles:spec` command creates a spec in `docs/specs/`.
3. `/veles:plan` command creates an implementation plan in `docs/plans/`.
4. Perun dispatches Veles with explicit `Mode:` prefixes and a trusted headless envelope.

## Architecture
- `veles.md` performs direct-user intent classification, headless envelope validation, mode detection and skill routing.
- Unified JSON contract is a discriminated schema with `ok`, `needs_clarification`, `error`, and `timeout` variants.

## API / command surface
- Natural messages (autoclassified)
- `/veles:spec <topic>`
- `/veles:plan <topic>`
- `/veles:qa-plan [source]`

## Security
No new secret-handling; all file writes go through existing `Write` tool.

## Testing
- Prompt tests in `tests/modules/plan/`.
- Eval scenarios in `docs/eval/scenarios/veles/`.

## Rollout
Phase 1: skills + commands + veles.md update.  
Phase 2: Perun integration.

## Open questions
- Should `/qa:create-plan` be retired or kept as alias?
```

---

## 16. Appendix B — Example implementation plan skeleton

```markdown
---
spec: docs/specs/2026-07-15-multi-mode-veles-spec.md
source: user request /veles:plan multi-mode-veles
branch: master
date: 2026-07-15
---

# Implementation Plan: Multi-mode Veles

## Goal
Implement multi-mode Veles as specified in `docs/specs/2026-07-15-multi-mode-veles-spec.md`.

## Global Constraints
- All new code is TypeScript under `src/`.
- Tests import from `dist/` after build.
- No new `src/modules/` file may import from `packages/skill-utils`.

## Dependencies
- `qa-plan-authoring` skill remains unchanged.
- `skill-registry` must discover `src/skills/veles/**/SKILL.md` via `dist/skills/veles` (BLK-01).

## Tasks

### Task 0: Register Veles skill directory
**Files:** `packages/skill-registry/src/index.ts`  
**Interfaces:** `load_appverk_skill` tool  
**Steps:**
1. Add `path.resolve(moduleDirectory, "../../../dist/skills/veles")` to `skillDirectories`.
2. Verify `scripts/copy-root-assets.mjs` emits `dist/skills/veles/**/SKILL.md`.
3. Build and confirm both new skills are loadable.
**Tests:** Skill-registry test or smoke test that loads `feature-spec-authoring` and `implementation-plan-authoring`.
**Commit step:** `feat(skill-registry): discover veles skills`

### Task 1: Create feature-spec-authoring skill
**Files:** `src/skills/veles/feature-spec-authoring/SKILL.md`  
**Interfaces:** `load_appverk_skill("feature-spec-authoring")`  
**Steps:**
1. Define spec format and authoring steps.
2. Add no-placeholder and self-review rules.
**Tests:** Prompt test asserts skill is loadable.
**Commit step:** `feat(veles): add feature-spec-authoring skill`

### Task 2: Create implementation-plan-authoring skill
**Files:** `src/skills/veles/implementation-plan-authoring/SKILL.md`  
**Interfaces:** `load_appverk_skill("implementation-plan-authoring")`  
**Steps:**
1. Define plan format with per-task Files/Interfaces/Steps/Tests/Commit.
2. Add verification plan and risk register sections.
**Tests:** Prompt test asserts skill is loadable.
**Commit step:** `feat(veles): add implementation-plan-authoring skill`

### Task 3: Update Veles prompt for intent classification and mode routing
**Files:** `src/modules/plan/veles.md`  
**Interfaces:** `Veles - Planner` prompt  
**Steps:**
1. Add direct-user intent-classification instructions with example message patterns.
2. Add headless-safe mode resolution: explicit `Mode:` prefix required; missing prefix returns `status: "needs_clarification"`.
3. Add low-confidence clarification rule for direct-user context only.
4. Map resolved modes to skills.
5. Define unified output contract.
6. Add collision policy for durable artefacts.
**Tests:** `tests/modules/plan/veles-prompt.test.ts` extended.
**Commit step:** `feat(veles): add intent classification, mode routing and unified output contract`

### Task 4: Add slash commands
**Files:** `src/commands/veles-spec.md`, `src/commands/veles-plan.md`, `src/commands/veles-qa-plan.md`  
**Interfaces:** `/veles:spec`, `/veles:plan`, `/veles:qa-plan`  
**Steps:**
1. Create command markdowns.
2. Wire into build asset copy.
**Tests:** Root plugin test verifies packed files.
**Commit step:** `feat(commands): add veles spec and plan commands`

### Task 5: Update Perun Workflow 3
**Files:** `src/agents/perun.md`  
**Interfaces:** Perun prompt  
**Steps:**
1. Add complexity triage (§6.0) — mechanical changes go to Stribog, simple implementation changes go to Svarog.
2. Dispatch Veles with explicit `Mode:` prefixes for complex spec/plan/qa requests.
3. Handle `status: "needs_clarification"` by asking the user and re-dispatching.
4. Add approval gates.
5. Branch JSON parsing on `type`.
**Tests:** Eval scenarios for simple → Svarog direct dispatch and Perun → Veles → Svarog handoff.
**Commit step:** `feat(perun): integrate veles spec and plan modes with complexity triage`

## Verification plan
- Run `bun run check`.
- Run `bun run verify-dist`.
- Manual test of natural messages ("design …", "plan the implementation of …", "test plan for …") in a clean session.
- Manual test of `/veles:spec`, `/veles:plan` and `/veles:qa-plan` shortcuts.

## Risk register
| Risk | Mitigation |
|---|---|
| Skill registry does not scan `src/skills/veles/` | Confirm scan pattern before merging; add explicit glob if needed |
| Perun JSON parser expects old QA-only contract | Keep legacy fields in QA output; add `type`/`summary` universally |
| Output directory collisions | Enforce `YYYY-MM-DD-<topic>` prefix in skill instructions |
```
