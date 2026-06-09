# Code Review — `feature/stribog-executor`

**Date:** 2026-06-09
**Branch:** `feature/stribog-executor` (off `master` @ 17c4fe9)
**Method:** AI-powered review — security + code-quality + documentation auditors, then Cross-Verifier (cross-domain correlation) and Challenger (adversarial false-positive / severity calibration).

**Scope:** 24 files vs `master`. New `src/modules/stribog/` light-executor subagent (5 source files + `stribog.md` asset), 6 test files, committed `dist/` build output, design spec + plan, and a 2-line `src/index.ts` registration.

**Verdict: APPROVE WITH MINOR FOLLOW-UPS.** No CRITICAL/HIGH issues survive verification. Tests **733/733 pass**, `tsc --noEmit` clean, lint clean for all `stribog` files (4 pre-existing lint errors elsewhere are out of scope), `dist/` in sync with `src/`. The two security invariants hold *by construction* and are test-locked: **minter ≠ actuator** (`qa/shell-env-hook.ts:32` `!agent.startsWith("zmora-")` + no `execute_recipe`) and **CWE-117 model-injection** (MODEL_REGEX in `pantheon-config/schema.ts:41`). Code quality faithfully mirrors the sibling `explore`/Triglav module — in several places (allow-list length guard, model-default coverage) it is *stricter* than the sibling.

The findings below are about **discoverability and merge-readiness**, not correctness.

---

## Findings

### [MEDIUM] ARCH-001: Dispatchable OS actuator ships ahead of its Phase-2 safety nets `[verified]`
**Status:** ✅ Fixed (2026-06-09)

**ID:** ARCH-001
**Location:** `src/modules/stribog/index.ts:8,13` (registration + config injection); design context `docs/superpowers/specs/2026-06-09-stribog-light-executor-design.md:244-251`
**Category:** Architecture
**Effort:** medium (or zero, if the branch stays unmerged per plan)

**Problem:**
Verification established that Phase 1 already makes Stribog **dispatchable now** — it is rendered into Perun's specialist/key-trigger/delegation tables (`coordinator/index.ts:61` → `agent-registry/perun-prompt-builder.ts:13-45`) and `validateDispatchable` accepts any `mode:"subagent"` agent (`coordinator/dispatch.ts:95-97`). But the safety nets the design pairs with this actuator are all deferred to Phase 2: the Perun **scratch-ref edit-recovery snapshot**, the **forced non-interactive-env hook** (hang prevention), and **concurrency enforcement** (`design.md:244-251`, plan:772-779).

**Impact:**
If this branch is merged to `master` as-is, Perun can route real-side-effect work (`Edit`/`Write` + `docker`/`make`/`curl`) to Stribog **before** any edit-recovery or hang-prevention exists. A botched edit has no scratch-ref to restore from; a foreground process can hang the turn.

**Remediation:**
Consistent with the stated plan (keep the branch unmerged until Phase 2), which fully mitigates it. To make the merge decision explicit, choose one:
1. **Do not merge to `master` until Phase 2's scratch-ref net lands** (recommended — matches current intent).
2. If merging Phase 1 alone, ship an explicit **"experimental — no edit-recovery yet"** note in the README/agent description, or temporarily gate dispatchability.

---

### [MEDIUM] DOC-001: README omits the Stribog subagent `[verified]`
**Status:** ✅ Fixed (2026-06-09)

**ID:** DOC-001
**Location:** `README.md:26-30` (the `## Subagents` table — lists only Zmora and Triglav)
**Category:** Documentation
**Effort:** trivial

**Problem:**
Verification settled the cross-auditor conflict: Stribog **is** surfaced through Perun in Phase 1 (the code-quality "it's invisible plumbing" note was the incorrect side). The README's own convention lists the other two Perun-dispatchable subagents (Zmora, Triglav) — both `mode:"subagent"`, neither user-pickable — so Stribog belongs there too.

**Remediation:** Add a row mirroring the Triglav style, aligned with `STRIBOG_DESCRIPTION` (`stribog.metadata.ts:13-14`):
```
| **Stribog** | Light execution specialist. Performs one small, mechanical task with real side effects (bring up/fix a service, restart, read logs, a 1–2 file config change), verifies it, returns a structured result; dispatched by Perun. |
```

---

### [MEDIUM] DOC-002: `agents.stribog.model` override (and the pinned Sonnet default) is undocumented `[verified]`
**Status:** ✅ Fixed (2026-06-09)

**ID:** DOC-002
**Location:** `docs/configuring-agents.md:3` (intro names only perun/zmora/triglav/veles) and the agents table at `:63-68`
**Category:** Documentation
**Effort:** trivial

**Problem:**
The override works in Phase 1 (`index.ts:24-25`, proven by `stribog-model-injection.test.ts`), but the canonical config reference omits the `stribog` key. Worse, Stribog *pins* `anthropic/claude-sonnet-4-6` when unset (`stribog.metadata.ts:11`), unlike Triglav/Veles which inherit the session default — an undocumented behavioral difference.

**Remediation:** Add a `stribog` row to the agents table and a note that, unlike the other agents, it pins a Sonnet-class default when `agents.stribog.model` is unset (a tier hint, not a security control). Also note the agent key is security-relevant (it drives the `zmora-` secret-gate) and shouldn't be renamed.

---

### [LOW] DOC-003: AGENTS.md monorepo-layout table has no `stribog` row `[verified]` (merged CQ-1 = DOC-003)
**Status:** ✅ Fixed (2026-06-09)

**ID:** DOC-003
**Location:** `AGENTS.md:3` (intro module list) and the layout table at `:6-27`
**Category:** Documentation
**Effort:** trivial

**Problem:** Independently flagged by both the code-quality and documentation auditors (cross-verifier merged them). Every sibling absorbed module (`explore`, `plan`, `qa`) has a row; `stribog` has none — and AGENTS.md's own checklist (`:220`, `:267`) mandates it. Real, but a non-functional contributor-doc gap (Challenger downgraded MEDIUM→LOW). **Highest-value quick fix.**

**Remediation:** Add a `src/modules/stribog/` row after the `explore` row, noting the actuator allow-list, the `execute_recipe`/`Task`/`rm` exclusions (minter ≠ actuator), and the Sonnet-class default.

---

### [LOW] MAINT-001: `metadata.test.ts` doesn't lock the route-toward fields (`useWhen`/`keyTrigger`/`triggers`) `[verified]`
**Status:** ✅ Fixed (2026-06-09)

**ID:** MAINT-001
**Location:** `tests/modules/stribog/metadata.test.ts:8-29`
**Category:** Maintainability (test coverage)
**Effort:** easy

**Problem:** Those three fields render verbatim into Perun's routing prompt (`perun-prompt-builder.ts:21-45`) and are now load-bearing for dispatch (ARCH-001/DOC-001). A regression that blanks them would silently de-route Stribog with **no failing test** (Cross-Verifier COMPOSITE-2). The test asserts only `name`/`mode`/`category`/`cost`/`avoidWhen`.

**Remediation:** Add assertions on `useWhen`, `keyTrigger`, and the two `triggers` entries — ideally in the same change that adds the README/doc rows, so the documented capability and the routing metadata are co-verified.

---

### [LOW] DOC-004: No durable per-agent doc (`docs/light-execution.md`) — Triglav has `docs/exploration.md` `[verified]`
**Status:** ✅ Fixed (2026-06-09)

**ID:** DOC-004
**Location:** (create) `docs/light-execution.md`
**Category:** Documentation
**Effort:** medium

**Problem:** The load-bearing "why" (allow-list rationale, minter ≠ actuator, the accepted host-env trust boundary, the READY/FAIL/ESCALATE contract) currently lives only in `docs/superpowers/` specs, which AGENTS.md:294-302 marks deletable. *(Cross-Verifier argued to escalate this to HIGH as a security-correlated compound; the Challenger kept it LOW since the spec still exists and Phase 2 is pending. Left at LOW; recommend landing it alongside the Phase-2 user-facing rollout, porting the trust-model text from `design.md:187-227`.)*

---

### [LOW] DOC-005: Cosmetic JSON-sketch drift in the spec vs shipped `stribog.md` `[verified]`
**Status:** ✅ Fixed (2026-06-09)

**ID:** DOC-005
**Location:** `docs/superpowers/specs/2026-06-09-stribog-light-executor-design.md:137-143`
**Category:** Documentation
**Effort:** trivial

**Problem:** The spec's result-contract sketch renders invalid JSON (missing comma after `baseUrl`; `reason` annotated only as a comment). The shipped `stribog.md:25-36` is the correct, authoritative version. Semantics match — cosmetic only. Optional; may be dropped as noise.

---

### [LOW] DOC-006: `docs/plugins/coordinator.md` roster description doesn't mention Stribog `[verified]` (Cross-Verifier GAP-1)
**Status:** ✅ Fixed (2026-06-09)

**ID:** DOC-006
**Location:** `docs/plugins/coordinator.md:185-187, 366-367`
**Category:** Documentation
**Effort:** trivial

**Problem:** That doc explains how `buildPerunPrompt` fills the specialist roster from the registry, but doesn't note that a new registered specialist (Stribog) now appears in it.

---

### [INFO] SEC-001: `Bash(curl:*)` is a residual egress primitive under the accepted host-env trust boundary

**ID:** SEC-001
**Location:** `src/modules/stribog/allowed-tools.ts:25`
**Category:** Security
**Effort:** n/a

**Problem:** `curl` is the one network primitive; under the operator's env it is a theoretical exfil/SSRF vector. **The Challenger downgraded this to informational** because the trust boundary is *explicitly accepted and documented* (`allowed-tools.ts:11-13`) and `curl` is no worse than the already-accepted `docker`/`make`/`npm` arbitrary-code execution. No remediation required for merge; tightening it would need a flag-inspecting `tool.execute.before` gate (out of scope).

---

## Verification Summary

**Method:** Cross-domain correlation (Cross-Verifier) + adversarial review (Challenger), each reading the actual wiring before ruling.

| Metric | Count |
|--------|-------|
| Findings verified | 9 (1 ARCH, 6 DOC, 1 MAINT, 1 SEC-info) |
| False positives removed | 1 (CQ-3: redundant `description:` label assertion) |
| Severity adjustments | 5 (DOC-001 H→M, DOC-002 H→M, DOC-003 M→L, DOC-004 M→L, SEC LOW→info) |
| Cross-analysis findings | 5 (2 composite + 3 coverage gaps; GAP-2 elevated to ARCH-001) |

### Cross-Analysis (Security ↔ Quality ↔ Documentation)
- **COMPOSITE-1:** A dispatchable, network-capable actuator (SEC-001) ships with no durable user-facing risk doc (DOC-001 + DOC-002 + DOC-004). Resolved together by adding the README/config rows + creating `docs/light-execution.md`.
- **COMPOSITE-2:** The live-routing metadata is untested (MAINT-001) on the very branch where it becomes load-bearing for dispatch (DOC-001). Fix the test and the docs in one change.
- **GAP-2 → ARCH-001:** the highest-value insight — actuator dispatchable before its safety nets.

### Challenged Findings
- **CQ-3 removed** (false positive): the description *value* is already locked in `plugin.test.ts:32`; the `prompt.test.ts` label assertion is already stronger than the sibling.
- **DOC-001 / DOC-002 downgraded H→M:** real omissions, but `mode:"subagent"` means Stribog isn't user-pickable; non-blocking discoverability gaps, not user-blocking.
- **DOC-003 / DOC-004 downgraded to LOW; SEC-001 → informational.**
- **Confirmed real:** ARCH-001, DOC-001, DOC-002, DOC-003, MAINT-001 (the actionable set).
- **Confirmed no missed HIGH/CRITICAL:** minter≠actuator gate and MODEL_REGEX both re-examined for bypass — neither is evadable.

**Bottom line:** Phase-1 code is correct, well-tested, and secure. Nothing blocks merge on code grounds. The one judgment call is **ARCH-001** (don't make Stribog live on `master` until Phase-2 safety nets land — which the keep-unmerged plan already does), and the rest are quick doc/test follow-ups best bundled into the Phase-2 PR.
