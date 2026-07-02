# Scoring-pipeline fixture (for qa-plan-provisioning-blocked.md)

Named behavior classes for the scoring-pipeline surface — the multi-hop
propagation introduced by the diff embedded in `qa-plan-provisioning-blocked.md`.

## Propagation chain

```
External AI workflow artifact (un-mintable)
  → executor receives score_payload via webhook
    → worker computes normalized_score (formula: raw / max_score * 100, int)
      → DB write: evaluations.score column (NOT NULL, default NULL)
```

## Seam: readable after direct DB seed

The `evaluations.score` column is writable directly via `psql`/`sqlite3` once
the row exists. The read path (`GET /api/evaluations/{id}`) exposes it. A
seam-seed scenario therefore:

1. INSERTs a row into `evaluations` with a known `score` value via psql/sqlite3.
2. GETs the row via the API and asserts `score` equals the seeded value.

This is the ONLY live test path for `score` — the propagation itself requires
an external AI workflow artifact that cannot be minted by curl/psql/sqlite3/Playwright.

## Unit test (hermetic pointer)

`tests/unit/scoring/test_normalized_score.py` — asserts
`normalized_score(raw=75, max_score=100) == 75` and boundary cases (0, 100,
rounding). This is the hermetic evidence that the derivation formula is correct.
The `provisioning-blocked` Coverage Matrix row for the propagation scenario
MUST point here.

## Columns for INSERT (from migration 0018_add_evaluations_score)

```
evaluations(id UUID, submission_id UUID NOT NULL, evaluator_id UUID NOT NULL,
            score INT, created_at TIMESTAMPTZ DEFAULT now())
```

`score` is nullable; set it to an integer (e.g. 82) in the seed INSERT.
`submission_id` and `evaluator_id` are foreign-keyed to `submissions` and
`users` respectively — the INSERT must reference existing rows (seed those
first if absent, or use the test-fixture UUIDs declared in `## Setup`).
