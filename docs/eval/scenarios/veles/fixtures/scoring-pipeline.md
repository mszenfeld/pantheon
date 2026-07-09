# Scoring-pipeline fixture (for qa-plan-provisioning-blocked.md)

Named behavior classes for the scoring-pipeline surface — the multi-hop
propagation introduced by the diff embedded in `qa-plan-provisioning-blocked.md`.

## Propagation chain

```
External AI workflow artifact (un-mintable)
  → executor receives score_payload via webhook
    → worker computes normalized_score (formula: raw / max_score * 100, int)
      → DB write: evaluations.score column (nullable INT, NULL until the workflow fires)
```

## Seam: readable after direct DB seed

The `evaluations.score` column is writable directly via `psql`/`sqlite3` once
the row exists. The read path (`GET /api/evaluations/{id}`) exposes it. A
seam-seed scenario therefore:

1. INSERTs a row into `evaluations` with a known `score` value via psql/sqlite3,
   supplying all NOT-NULL columns from the authoritative schema below
   (`id`, `submission_id`, `evaluator_id`) plus the `score` under test.
2. GETs the row via the API and asserts `score` equals the seeded value.

This is the ONLY live test path for `score` — the propagation itself requires
an external AI workflow artifact that cannot be minted by curl/psql/sqlite3/Playwright.

## Unit test (hermetic pointer)

`tests/unit/scoring/test_normalized_score.py` — asserts
`normalized_score(raw=75, max_score=100) == 75` and boundary cases (0, 100,
rounding). This is the hermetic evidence that the derivation formula is correct.
The `provisioning-blocked` Coverage Matrix row for the propagation scenario
MUST point here.

## Authoritative `evaluations` schema (committed table + new column)

This is the single source of truth the seam-seed INSERT grounds against. It is
the pre-existing committed `evaluations` table PLUS the `score` column added by
the embedded diff (`ALTER TABLE evaluations ADD COLUMN score INT`). A
schema-grounded INSERT must satisfy **every** NOT-NULL / FK column below:

```
evaluations(id UUID PRIMARY KEY,
            submission_id UUID NOT NULL REFERENCES submissions(id),
            evaluator_id  UUID NOT NULL REFERENCES users(id),
            score         INT,                       -- added by the diff; nullable
            created_at    TIMESTAMPTZ DEFAULT now())
```

Column obligations for the seed INSERT:

- `id`, `submission_id`, `evaluator_id` are all NOT NULL — the INSERT MUST
  supply all three. `score` is the nullable column under test; set it to an
  integer (e.g. `82`) so the read path returns a concrete value.
- `submission_id` and `evaluator_id` are foreign-keyed to `submissions` and
  `users` respectively — the INSERT must reference existing parent rows: seed
  those parents first, or use the test-fixture UUIDs declared in the plan's
  `## Setup`. A grounded INSERT that names all NOT-NULL columns AND satisfies
  these FKs is genuinely insertable; one that omits `submission_id` would
  violate the NOT-NULL constraint and is therefore *not* schema-grounded.
