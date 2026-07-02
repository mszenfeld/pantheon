# Veles: QA plan for a multi-hop propagation with a provisioning-blocked path

**Agent:** Veles - Planner
**Target codebase:** this repo (`av-opencode-plugins`) — execution host only.
The diff is embedded in the Query, so a correct run needs no repo source; any
deep exploration of this repo is wasted effort and a minor negative signal.

> `**Agent:**` is the real registered dispatch name `Veles - Planner`. The
> playbook does not parse `**Agent:**` programmatically.

This is the **provisioning-blocked / seam-seed ladder discriminator**: the diff
introduces a multi-hop derived value (`score`) whose ONLY live trigger requires
an external AI workflow artifact that cannot be minted by curl/psql/sqlite3/
Playwright. The failure this catches is a plan that demands an `AI_WORKFLOW_ID`-
style env var with no fallback and stalls — instead of recognising the seam
(direct DB write) for the read path, and dispositing the propagation as
`provisioning-blocked` in the Coverage Matrix with a hermetic pointer to the
unit test.

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
> +++ b/db/migrations/0018_add_evaluations_score.sql
> @@
> +-- Stores the normalized score written by the scoring worker after an AI
> +-- workflow completes. NULL until the workflow fires.
> +ALTER TABLE evaluations ADD COLUMN score INT;
> --- /dev/null
> +++ b/api/evaluations/router.py
> @@
> +import os
> +from fastapi import APIRouter, Depends, HTTPException
> +from .auth import get_current_user_id   # validates JWT, returns user_id
> +from .db import get_db                  # yields AsyncSession
> +
> +router = APIRouter()
> +
> +@router.get("/api/evaluations/{evaluation_id}")
> +async def read_evaluation(
> +    evaluation_id: str,
> +    user_id: str = Depends(get_current_user_id),
> +    db=Depends(get_db),
> +):
> +    """Return a single evaluation record.
> +
> +    Contract:
> +      200 → { id, submission_id, evaluator_id, score, created_at }
> +             score is null until the AI workflow fires
> +      401 → missing/invalid token
> +      404 → evaluation not found (or owned by another user)
> +    """
> +    row = await db.scalar(
> +        "SELECT id, submission_id, evaluator_id, score, created_at "
> +        "FROM evaluations WHERE id = :id AND evaluator_id = :uid",
> +        {"id": evaluation_id, "uid": user_id},
> +    )
> +    if row is None:
> +        raise HTTPException(status_code=404, detail="not found")
> +    return row
> --- /dev/null
> +++ b/workers/scoring/handler.py
> @@
> +import os
> +from .db import get_db
> +
> +AI_WORKFLOW_WEBHOOK_SECRET = os.environ["AI_WORKFLOW_WEBHOOK_SECRET"]
> +
> +async def handle_score_webhook(payload: dict):
> +    """Receive the score payload from an external AI workflow artifact.
> +
> +    The workflow is published externally (not mintable by curl/psql/Playwright).
> +    payload = { "evaluation_id": str, "raw_score": int, "max_score": int }
> +    normalized_score = int(raw_score / max_score * 100)
> +    """
> +    evaluation_id = payload["evaluation_id"]
> +    raw = payload["raw_score"]
> +    max_s = payload["max_score"]
> +    normalized = int(raw / max_s * 100)
> +    async with get_db() as db:
> +        await db.execute(
> +            "UPDATE evaluations SET score = :score WHERE id = :id",
> +            {"score": normalized, "id": evaluation_id},
> +        )
> +        await db.commit()
> --- /dev/null
> +++ b/tests/unit/scoring/test_normalized_score.py
> @@
> +import pytest
> +from workers.scoring.handler import handle_score_webhook   # tested via unit harness
> +
> +@pytest.mark.parametrize("raw,max_s,expected", [
> +    (75, 100, 75),
> +    (0,  100, 0),
> +    (100, 100, 100),
> +    (1,   3,  33),   # int truncation: 33.33… → 33
> +])
> +def test_normalized_score(raw, max_s, expected):
> +    """Derivation formula: int(raw / max_score * 100)."""
> +    assert int(raw / max_s * 100) == expected
> ````

## Expected coverage

Coverage is **tiered** so partial-coverage models are *ranked*, not pass/failed.
Score MUST items as the ranking backbone; NICE items break ties and reward depth.

**MUST:**

- `## Setup` lists `AI_WORKFLOW_WEBHOOK_SECRET` and the service URL
  `http://localhost:8000`.
- `## Setup` carries a `**Seeds fixtures:** BE-NN (requires allow_mutations)`
  marker that identifies the seam-seed read scenario by its plan ID.
- The seam-seed read scenario (BE-NN) meets ALL of the following requirements:
  - Uses a `**Seed (psql/sqlite3):**` labelled step containing an INSERT into
    `evaluations` with a literal `score` value (e.g. `82`) and references only
    ONE connection string variable in the seed step (e.g. `$DATABASE_URL`).
  - Columns cited in the INSERT match the migration schema: at minimum `id`,
    `evaluator_id`, `score`; the INSERT is schema-grounded, not invented.
  - The scenario is **wholly positive** (asserts that `GET /api/evaluations/{id}`
    returns 200 with the seeded `score`); it does NOT contain 4xx response
    literals, reject assertions, or "must-not" phrasing in its main flow.
  - Carries a `**Coverage delta:**` note naming the skipped propagation
    (the AI workflow path) and explaining why it is not exercised here.
- `## Coverage Matrix` includes a row for the AI-workflow propagation path
  dispositioned `provisioning-blocked` (NOT `covered`, NOT `out-of-scope`), with:
  - A `hermetic:` pointer in the doctrine's full `<path>::<test>` form —
    `hermetic: tests/unit/scoring/test_normalized_score.py::test_normalized_score` —
    as evidence that the derivation is tested in isolation (a bare file path
    without `::<test>` is incomplete).
  - A one-clause reason explaining why the propagation cannot be minted (e.g.
    "requires a pre-published external AI workflow artifact not mintable by
    curl/psql/sqlite3/Playwright").
- No Required env var introduced whose only purpose is to mint the un-provisionable
  path (FAIL: e.g. `AI_WORKFLOW_ID` listed under `**Required environment variables:**`
  with no psql/curl fallback path — this is the stall pattern the scenario guards).
- 401 (missing/invalid token) and 404 (not found) are covered scenarios in
  addition to the seam-seed read.
- Final message is the 6-field JSON; `fe_count` = 0; `be_count` equals the BE
  scenario count; `plan_path` exists.

**NICE-TO-HAVE:**

- The seam-seed read scenario includes an existence-check first assertion: before
  asserting the `score` value, assert that the 200 response body includes an `id`
  field (handles the "undetermined middle" — we do not know if the seed ran until
  the GET succeeds). Tag this `(unverified — confirm at run time)` if the source
  is off-disk (the doctrine's canonical tag — never the bare `(unverified)`).
- An explicit note in the `provisioning-blocked` row that the hermetic unit test
  covers the truncation boundary (`1/3 → 33`, not `34`).
- A SETUP binding for the authenticated user (`QA_BIND_JWT`) with a declared
  `Egress:` referencing the service's auth endpoint.

## Quality signals

**Scoring model — gate, then rank:**

1. **GATE — JSON contract compliance.** Exactly the 6 keys
   `{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`, valid JSON,
   nothing after it. Binary; failure → `degenerate`.
2. **GATE — provisioning-blocked disposition present.** `## Coverage Matrix`
   must contain a `provisioning-blocked` row for the AI-workflow propagation. If
   this row is absent, or is dispositioned `covered` or `out-of-scope`, or
   instead introduces an `AI_WORKFLOW_ID` Required env var with no fallback →
   `degenerate` (the stall pattern).
3. **GATE — seam-seed read present.** The plan must contain a BE scenario with a
   `**Seed (psql/sqlite3):**` step. Absent → `degenerate`.
4. **PRIMARY RANKING — plan quality.** Seam-seed correctness (schema-grounded
   INSERT, single connection reference, wholly positive assertion, Coverage delta
   note); hermetic pointer completeness; 401/404 coverage.

**Supporting signals (objectively scorable):**

- **Self-consistency** — `be_count` = number of `### BE-` headings;
  `setup_prereqs` mirrors `## Setup` backtick items; `plan_path` exists.
- **Seed step schema-grounding** — INSERT cites columns from the migration
  (`id`, `evaluator_id`, `score`) rather than invented column names.
- **Single connection reference** — the seed step uses exactly one `$DATABASE_URL`
  (or equivalent) variable; multiple DSNs in one seed step is a demerit.
- **No stall env var** — `AI_WORKFLOW_ID` (or equivalent) does NOT appear in
  `**Required environment variables:**` without a psql/curl fallback.
- **Coverage delta note present** — the seam-seed scenario carries the note.
- **Hermetic pointer precision** — the `hermetic:` value is the full
  `<path>::<test>` form, e.g.
  `tests/unit/scoring/test_normalized_score.py::test_normalized_score`
  (or a path::test coherent with the diff); a bare file path is a demerit.
- **Grounding / no hallucination** — uses real identifiers from the diff
  (`evaluations`, `score`, `evaluation_id`, `/api/evaluations/{evaluation_id}`,
  `AI_WORKFLOW_WEBHOOK_SECRET`); does not invent endpoints or columns.
  Also grade: every behavioral assertion carries a visible `(file:line)` citation
  or an `(unverified — confirm at run time)` tag.
- **No-execution discipline** — `git status` shows no source edit.
- **No interview / no wasted exploration** — did not call `question`; did not
  dispatch triglav or read nonexistent paths.

**Degeneration floor (structural):** `degenerate` if the plan has <1 BE
scenario, <2 edge cases per scenario, a broken JSON gate, no
`provisioning-blocked` row in the Coverage Matrix, or no `**Seed (psql/sqlite3):**`
step.

**Variance / determinism:** run **≥2 iterations** per model. Flag `unreliable`
if across iterations the JSON gate flips, the provisioning-blocked disposition
appears in one iteration but not another, or the seam-seed step is present in
one iteration but absent in another.

**Latency:** record-only.

## What this discriminates

- **Stall on un-provisionable env var** — **the primary discriminator**. A model
  that lists `AI_WORKFLOW_ID` (or `AI_WORKFLOW_RUN_ID`, `WORKFLOW_ARTIFACT_ID`,
  or any equivalent) as a `**Required environment variables:**` entry with no
  psql/curl fallback produces a plan that will block every QA run waiting for an
  artifact the team cannot mint. The scenario is a hard `degenerate` gate failure.
- **Missing seam recognition** — fails to see that `evaluations.score` is
  writable directly via psql/sqlite3 and instead treats the entire scoring path
  as un-testable (punts the read path to `out-of-scope` rather than seeding the
  column and reading it).
- **Wrong Coverage Matrix disposition** — dispositions the propagation as
  `covered` (implying it was tested end-to-end, which is false) or `out-of-scope`
  (implying it is irrelevant, which misses the hermetic evidence), rather than
  `provisioning-blocked` with a hermetic pointer.
- **Missing hermetic pointer** — marks the propagation `provisioning-blocked`
  but does not cite the unit test, leaving evaluators with no evidence that the
  derivation formula is correct.
- **Polluted seed step** — seed step references multiple DSNs or contains
  negative assertions (4xx, reject, must-not), making it ambiguous and unusable
  by the `allow_mutations` runner.
- **Missing Coverage delta** — seam-seed read scenario does not call out the
  skipped propagation, leaving the reader unaware that the full chain was not
  exercised.
- **All standard Veles failure modes** (JSON-contract break, mis-counts,
  hallucination, interview-mode hang, source edits) — inherited from
  `qa-plan-from-diff.md`.

This scenario is self-contained and runs against the public repo straight from
`git clone` — no external project, no secrets. It can FAIL meaningfully: the
stall pattern (`AI_WORKFLOW_ID` Required env var with no fallback) and the
missing `provisioning-blocked` disposition are hard `degenerate` gate failures.
