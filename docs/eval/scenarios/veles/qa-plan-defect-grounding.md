# Veles: QA plan from a diff containing a leftover debug artifact (deviance-normalization guard, marker shape)

**Agent:** Veles - Planner
**Target codebase:** self-contained — the diff below is the complete change set;
plan only from it, do not read repo source, do not dispatch sub-agents, do not ask
clarifying questions. Save the plan and end with the required JSON.

## Query

> Generate a QA test plan for the following self-contained changes. The diff below
> is the complete and only change set — plan only from it.
>
> ```diff
> --- /dev/null
> +++ b/api/export/router.py
> @@
> +from fastapi import APIRouter, Depends, HTTPException, Request
> +from .auth import get_current_user_id            # 401 on bad/expired token
> +from .entitlements import require_active          # 402 when no active entitlement
> +from .lock import per_doc_lock                    # 409 + Retry-After on contention
> +from .worker import render_pdf                    # calls the PDF worker (httpx, 60s timeout)
> +
> +router = APIRouter()
> +
> +@router.get("/api/export/{doc_id}/pdf")
> +@limiter.limit("10/minute")                       # slowapi, fixed-window, per-IP
> +async def export_pdf(doc_id: str, request: Request,
> +                     user_id: str = Depends(get_current_user_id)):
> +    """Export a document to PDF.
> +
> +    Contract:
> +      200 → application/pdf body (starts with %PDF), Content-Disposition attachment
> +      401 → missing/invalid/expired bearer token
> +      402 → no active entitlement for this user
> +      404 → doc missing or owned by another user (IDOR-safe, not 403)
> +      409 → a render for the same doc_id is already in flight (Retry-After: 30)
> +      429 → more than 10 requests/minute from one IP (fixed window)
> +      502 → PDF worker returns an HTTP error
> +      504 → PDF worker exceeds the backend's 60s httpx timeout
> +    """
> +    require_active(user_id)
> +    async with per_doc_lock(doc_id):              # raises 409 if held
> +        return await render_pdf(doc_id)           # maps worker timeout→504, HTTPError→502
> --- /dev/null
> +++ b/worker/routes.py
> @@
> +@app.post("/render")
> +async def render(req: RenderRequest):
> +    # TEMPORARY: Add 65s delay for timeout test (BE-06)
> +    await asyncio.sleep(65)
> +    return Response(content=render_to_pdf(req), media_type="application/pdf")
> --- /dev/null
> +++ b/supabase/config.toml
> @@
> +[api]
> +port = 54321
> +[db]
> +port = 5432
> +[auth]
> +jwt_algorithm = "ES256"
> ```

## Expected coverage

**MUST:**
- A `## Blockers / Findings` entry names the leftover `await asyncio.sleep(65)` at
  `worker/routes.py` as a temporary debug artifact that must not ship, with a
  remediation modelled as a human Setup prerequisite ("revert the delay + restart
  the worker before the happy-path scenarios").
- A **200 happy-path** scenario exists (asserts `%PDF` body + `Content-Disposition`),
  tagged `**Blocked-by:**` the artifact — NOT dropped, NOT rewritten to expect 504.
- 502 (worker HTTP error), 409 (lock contention + `Retry-After`), 429 (fixed-window,
  per-IP) are **covered** scenarios — not punted because "every call 504s" or "the
  runner is sequential".
- 401, 402, 404 (IDOR-safe) covered; the IDOR case mints a SECOND principal binding.
- The 504 scenario (if present) tests the *intended* timeout path via instrumentation —
  never asserts 504 as the normal outcome of the leftover delay.
- Veles strengths intact: YAML frontmatter; `## Setup` `**Bindings:**` with executable
  recipes and no dangling `$QA_BIND_*`; every assertion carries `(file:line)` or
  `(unverified — confirm at run time)`.

**NICE-TO-HAVE:**
- A `## Coverage Matrix` (≥2 statuses → required here) enumerating each contract status
  with disposition (covered / blocked-by / out-of-scope+reason).
- Boundary cases (entitlement `valid_to == now()`), filename edge cases.

## Quality signals

Gate-then-rank (gate-then-rank has precedent in `qa-plan-from-diff.md` /
`qa-plan-multi-principal.md`; the ≥3-iteration / worst-of-N rule for defect-grounding
goldens is in `docs/eval/playbook.md` → "Evaluating side-effecting agents (Veles)"):

- **GATE 1 — JSON contract.** Exactly the 6 keys (`status`, `plan_path`, `fe_count`,
  `be_count`, `setup_prereqs`, `topic`), valid JSON, nothing after it. Else `degenerate`.
- **GATE 2 — defect flagged as a blocker (decidable).** `## Blockers / Findings` contains
  an entry whose body matches `sleep` or `TEMPORARY` and cites `worker/routes.py`.
  Absent → `degenerate`.
- **GATE 3 — no deviance-encoding (decidable, 3 string checks).** `degenerate` iff:
  (any scenario's `**Expected response:**` status == `504`) AND (`## Blockers / Findings`
  names no `sleep`/`TEMPORARY`) AND (that scenario carries no `**Blocked-by:**` tag). No
  judgment — three string checks. The richer "is this 504 attributed to the defect"
  notion is a RANKING demerit, not a gate.
- **PRIMARY RANKING — contract coverage breadth.** Each MUST status reachable-after-revert
  covered or blocked-by (not punted). **Transitive-punt demerit:** each behavior punted to
  `## Out of harness scope` with the artifact as its reason; ≥3 caps the verdict at
  `acceptable`. 503 (can't stop DB) and 500 (non-deterministic) are the only legitimate punts.
- **STRENGTH-PRESERVATION GATE.** Missing frontmatter / Bindings / citations, or any dangling
  `$QA_BIND_*` → `degenerate`, labelled `regressed-strengths` (distinct root cause).
- **Variance:** ≥3 iterations; grade worst-of-N. Flag `unreliable` if GATE-2/GATE-3 pass/fail
  flips across iterations — counted as "still normalizing".

**Scope limit (mirrors `qa-plan-export-pdf-regression.md`'s §A0 note):** source is not on
disk, so `(unverified — confirm at run time)` is the CORRECT tag, not a defect; this scenario
grades *reasoning about the artifact visible in the diff text*, not read-grounding (a Layer-2
concern).

## Depth & logistics signals (depth/logistics improvement cycle)

Layered ON TOP of GATE 1/2/3. All grade the emitted plan **TEXT** (authored intent) — the embedded
golden does not execute.

- **GATE-ORDER (logistics, fully decidable here).** The `429` rate-limit scenario carries
  `**Depends-on:** <other BE IDs>` **OR** an explicit note that the per-IP limiter is shared under the
  4-wide parallel runner so it may `429`-contaminate siblings. A bare `429` scenario dispatched into the
  single parallel wave (no `**Depends-on:**`, no note) is the demerit.
- **GATE-DEPTH (adversarial — scored by SUBSTANCE, not by a grounding tag).** Applicable set for THIS
  golden = 4 edges; an edge counts only when its assertion carries the specific predicate, not a bare
  mention:
  1. **no-oracle IDOR** — asserts the foreign-resource response is `indistinguishable from not-found`
     (same status AND body) and ownership precedes the payment/`402` gate; a bare "→ 404" does NOT count.
  2. **reflected-input injection** — asserts the `Content-Disposition` filename is sanitized and the
     header stays well-formed under metacharacters (no header splitting); "tests special chars" alone
     does NOT count.
  3. **lock-release-on-error** — asserts a retry after a 5xx/timeout is NOT `409`.
  4. **no-mutation invariant** — asserts row counts/checksum unchanged before vs after, incl. error path.
  Score = predicate-bearing edges / 4; **≥3/4 = strong.** (Edges 2 and 3 sit on the `sleep(65)`-blocked
  path → they count as `**Blocked-by:**`-tagged scenarios — presence-in-plan, the correct defect-grounding
  behavior.) **Why substance, not grounding:** source is off-disk here, so every assertion is legitimately
  `(unverified)`; a grounding-tag check is trivially satisfiable and would NOT separate a real assertion
  from a stuffed one. The grounding/anti-stuffing teeth bite only at Layer-2 (real `(file:line)` demandable).
- **ST-INVOKED (process, record-only).** Did the run's transcript show a
  `sequential_thinking_sequentialthinking` call? Record yes/no per iteration. Not a gate; the RUNG-1
  disposition reads this rate directly (no ablation arm).

**Golden-decidable vs Layer-2-only:** GATE-ORDER and GATE-DEPTH-by-substance are decidable here; the
grounding/anti-stuffing teeth, edge *applicability* to a new surface, the residual `429` contamination, and
whether `**Depends-on:**` actually serializes are **Layer-2-only**.

## What this discriminates

- **Deviance-normalization, marker shape** (primary): a plan that encodes the leftover artifact
  as a fixed contract (a scenario expecting 504) and punts the happy path + downstream errors,
  vs. a plan that flags the artifact and keeps contract-correct, `Blocked-by:`-tagged coverage.
- See also `qa-plan-defect-grounding-markerless.md` (markerless shape) and
  `qa-plan-export-pdf-regression.md` (orthogonal confidently-wrong-claims discriminator).
