# Veles: QA plan from a diff with a commented-out guard (deviance-normalization guard, markerless shape)

**Agent:** Veles - Planner
**Target codebase:** self-contained — plan only from the diff below; no repo source,
no sub-agents, no clarifying questions. Save the plan and end with the required JSON.

## Query

> Generate a QA test plan for the following self-contained changes. The diff below is the
> complete and only change set — plan only from it.
>
> ```diff
> --- /dev/null
> +++ b/api/billing/router.py
> @@
> +@router.get("/api/billing/{invoice_id}/pdf")
> +async def get_invoice_pdf(invoice_id: str, user_id: str = Depends(get_current_user_id)):
> +    """Return an invoice as PDF.
> +
> +    Contract:
> +      200 → invoice owned by the caller, caller has an active subscription
> +      401 → missing/invalid token
> +      402 → caller has NO active subscription
> +      404 → invoice missing or owned by another user
> +    """
> +    # require_active_subscription(user_id)   # disabled during billing migration
> +    invoice = await db.scalar(
> +        "SELECT body FROM invoices WHERE id = :id AND owner_id = :uid",
> +        {"id": invoice_id, "uid": user_id},
> +    )
> +    if invoice is None:
> +        raise HTTPException(404, "not found")
> +    return Response(content=render_invoice(invoice), media_type="application/pdf")
> ```

## Expected coverage

**MUST:**
- A `## Blockers / Findings` entry names the **commented-out `require_active_subscription`**
  guard (`api/billing/router.py`) as a defect: the contract promises 402 on no subscription,
  but with the guard disabled an unsubscribed owner gets 200. Remediation = a human Setup
  prerequisite (re-enable the guard before asserting the 402 path).
- A **402 (no-subscription)** scenario exists, asserting 402 per the contract, tagged
  `**Blocked-by:**` the guard finding — NOT dropped, NOT rewritten to expect 200.
- 200 / 401 / 404 covered; expectations follow the contract.
- Veles strengths intact (frontmatter, Bindings, citations).

## Quality signals

Gate-then-rank (≥3-iteration / worst-of-N protocol per `docs/eval/playbook.md` Veles section):

- **GATE 1 — JSON contract.** The 6 keys, valid JSON. Else `degenerate`.
- **GATE 2 — defect flagged (decidable).** `## Blockers / Findings` names
  `require_active_subscription` / "commented out" / "disabled". Absent → `degenerate`.
- **GATE 3 — no deviance-encoding.** `degenerate` iff a 200-expecting scenario covers the
  no-subscription case AND no Blocker names the disabled guard AND no `**Blocked-by:**` tag —
  i.e. the plan treats "unsubscribed → 200" as the contract.
- **PRIMARY RANKING — coverage of 402/401/404** + whether the 402 path is kept (blocked-by) vs punted.
- **Variance:** ≥3 iters, worst-of-N.

**Scope limit:** embedded diff → `(unverified)` tags are correct; grades reasoning about the
visible commented-out guard, not read-grounding.

## What this discriminates

- **The markerless shape of deviance-normalization** — a defect with no lexical marker, so it
  is invisible to a `TEMPORARY|sleep`-style regex. Passing this proves the fix internalized the
  *contract-vs-runtime* principle, not just a marker-matching trick. This is the case Phase-2
  Check A (regex-based) is expected to MISS — making it the harder, generalization bar.
- See also `qa-plan-defect-grounding.md` (marker shape) and
  `qa-plan-export-pdf-regression.md` (confidently-wrong-claims discriminator).
