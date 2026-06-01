# Veles: QA plan for a multi-principal authorization diff

**Agent:** Veles - Planner
**Target codebase:** this repo (`av-opencode-plugins`) — execution host only.
The diff is embedded in the Query, so a correct run needs no repo source; any
deep exploration of this repo is wasted effort and a minor negative signal.

> `**Agent:**` is the real registered dispatch name `Veles - Planner`. The
> playbook does not parse `**Agent:**` programmatically.

This is the **binding-completeness discriminator**: the endpoint enforces
per-owner authorization, so a faithful plan must test "a SECOND user cannot
read user A's document" — which requires a token for a second principal. The
failure this catches is a plan that references a `$QA_BIND_*` it never declares
(the real `QA_BIND_JWT_FOR_USER_B` dangling-reference bug), or that reuses one
user's token for both principals (making the authorization test meaningless).

## Query

Verbatim prompt sent to the agent (the leading instruction keeps a faithful run
from gathering context off the nonexistent repo paths, dispatching triglav, or
asking a clarifying question that would hang a headless server):

> Generate a QA test plan for the following self-contained changes. The diff
> below is the complete and only change set — plan **only** from it: do not read
> repository source, do not dispatch exploration sub-agents, and do not ask
> clarifying questions. Save the plan and end your turn with the required JSON
> result object.
>
> ````diff
> --- /dev/null
> +++ b/api/documents/views.py
> @@
> +import os
> +from fastapi import APIRouter, Depends, HTTPException
> +from .auth import get_current_user_id      # validates the Supabase JWT, returns the user id
> +from .db import get_document               # SELECT id, owner_id, title, body FROM documents WHERE id = ?
> +
> +router = APIRouter()
> +SUPABASE_URL = os.environ["SUPABASE_URL"]          # Supabase project URL (auth issuer)
> +SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
> +
> +@router.get("/api/documents/{doc_id}")
> +def read_document(doc_id: str, user_id: str = Depends(get_current_user_id)):
> +    doc = get_document(doc_id)
> +    # Ownership enforcement: a non-owner must NOT learn the document exists.
> +    if doc is None or doc.owner_id != user_id:
> +        raise HTTPException(status_code=404, detail="document not found")
> +    return {"id": doc.id, "title": doc.title, "body": doc.body}
> ````

## Expected coverage

Coverage is **tiered** so partial-coverage models are *ranked*, not pass/failed.
Score MUST items as the ranking backbone; NICE items break ties and reward depth.

**MUST:**

- `## Setup` lists `SUPABASE_URL` and `SUPABASE_ANON_KEY` (both via real
  `os.environ[...]`) and the service URL `http://localhost:8000`.
- `## Setup → **Bindings:**` declares a JWT binding for the primary test user
  (e.g. `QA_BIND_JWT`) with a login recipe whose `Inputs:` include the user's
  credentials and `Egress: $SUPABASE_URL`.
- **A SECOND binding for a SECOND principal** (e.g. `QA_BIND_JWT_FOR_USER_B`)
  with its own distinct credential inputs (e.g. `TEST_USER_B_EMAIL`,
  `TEST_USER_B_PASSWORD`) — those names also appear under
  `**Required environment variables:**`. The second user CANNOT share the first
  user's token.
- BE scenarios reference `GET /api/documents/{doc_id}`: 200 + body for the
  owner; **404 when a different authenticated user requests it** (using the
  second principal's token); 401 unauthenticated. ≥2 edge cases (e.g.
  nonexistent `doc_id` → 404 indistinguishable from a non-owned one; malformed
  id → 422).
- Final message is the 6-field JSON; `fe_count` = 0; `be_count` equals the BE
  scenario count; `topic` is a documents/authorization slug; `plan_path` exists.

**NICE-TO-HAVE:**

- A DB-state check confirming `documents.owner_id` differs from user B's id.
- An explicit no-existence-leak assertion (404 body identical for "not yours"
  vs "does not exist").
- A SETUP scenario synthesised per binding (the plan need not synthesise these —
  Perun does — but a plan that makes the two principals explicit is clearer).

## Quality signals

**Scoring model — gate, then rank:**

1. **GATE — JSON contract compliance.** Exactly the 6 keys
   `{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`, valid JSON,
   nothing after it. Binary; failure → `degenerate`.
2. **GATE — binding completeness (the discriminator for this scenario).**
   Collect every `$QA_BIND_*` token referenced anywhere in the FE/BE scenarios.
   **Each one MUST have a matching declaration in `## Setup → **Bindings:**`.** A
   scenario that references a `$QA_BIND_*` no binding declares is a **dangling
   reference → `degenerate`**: the binding can never be minted (`execute_recipe`
   returns `unknown_binding`) and every scenario using it stalls on `NEED_INFO`
   in production. Reusing the first user's token for the "other user" test is
   *not* a gate failure but IS a primary-ranking demerit (the authorization test
   becomes meaningless).
3. **PRIMARY RANKING — plan quality.** Coverage of the MUST edge cases
   (owner-200, non-owner-404, unauth-401, no-existence-leak) and the correctness
   of the two-principal modelling.

**Supporting signals (objectively scorable):**

- **Self-consistency** — `be_count` = number of `### BE-` headings;
  `setup_prereqs` mirrors the `## Setup` backtick items; `plan_path` exists.
- **Setup inference** — 1 point each for `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `http://localhost:8000`, and each per-principal credential name.
- **Grounding / no hallucination** — uses real identifiers from the diff
  (`/api/documents/{doc_id}`, `owner_id`, `SUPABASE_URL`); does not invent
  endpoints/fields.
- **No-execution discipline** — `git status` shows no source edit (the plan file
  under `docs/testing/plans/` is the only expected write).
- **No interview / no wasted exploration** — did not call `question`; did not
  dispatch triglav or read the nonexistent paths.

**Degeneration floor (structural):** `degenerate` if the plan has <1 BE
scenario, <2 edge cases per scenario, a broken JSON gate, **or any dangling
`$QA_BIND_*` reference**.

**Variance / determinism:** run **≥2 iterations** per model. Flag `unreliable`
if across iterations the JSON gate flips, counts differ, or the binding set
(one vs two principals) differs.

**Latency:** record-only.

## What this discriminates

- **Dangling binding reference** — **the primary discriminator**. A model that
  writes a `non-owner → 404` scenario using `$QA_BIND_JWT_FOR_USER_B` (or any
  second-user token) but never declares that binding produces a plan that can
  never run — the exact regression that motivated this scenario.
- **Collapses the two principals** — reuses `$QA_BIND_JWT` for both users, so
  the authorization test cannot actually distinguish owner from non-owner.
- **Drops the authorization scenario entirely** — only tests owner-200 + 401,
  missing the cross-user 404 that is the whole point of the diff.
- **Breaks the JSON contract / mis-counts / hallucinates / interviews** — the
  standard Veles failure modes (see `qa-plan-from-diff.md`).

This scenario is self-contained and runs against the public repo straight from
`git clone` — no external project, no secrets. It can FAIL meaningfully: a
dangling `$QA_BIND_*` reference is a hard `degenerate` gate.
