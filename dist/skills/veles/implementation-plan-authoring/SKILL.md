---
name: implementation-plan-authoring
description: Author a durable, dependency-aware implementation plan from an approved feature specification.
---

# Implementation Plan Authoring

## Purpose

Create an executable, reviewable implementation plan that translates an
approved feature specification into minimal, ordered engineering work. The plan
is a durable artifact: it explains what changes, why each task exists, how to
verify it, and what risks remain. It does not replace the source specification
or re-decide its product and security choices.

## Inputs

Use the approved feature specification, repository evidence, relevant tests and
architecture, constraints, and implementation context. In headless mode,
`spec_path` is required. Read the referenced specification and validate that it
is approved before planning. Carry its canonical digest into the plan so the
implementation chain is auditable.

## Authoring workflow

1. **Ground the plan.** Identify the approved specification, its digest,
   affected behaviours, repository locations, existing conventions, and scope
   boundaries. Do not plan against an unread, missing, or unapproved spec.
2. **Decompose the work.** Split the change into small dependency-aware tasks.
   Each task must name its intent, affected files, interfaces or contracts,
   precise steps, tests, and a commit step. Order tasks so prerequisites are
   explicit and independently reviewable.
3. **Preserve boundaries.** Keep scope aligned to the specification. Identify
   migrations, compatibility work, configuration, documentation, generated
   artifacts, and rollout work only where repository evidence or the spec
   requires them.
4. **Define verification.** Provide a verification plan that maps every
   requirement to unit, integration, contract, build, static-analysis, and
   manual checks as appropriate. Include exact existing project commands where
   known and identify acceptance evidence for risky changes.
5. **Maintain a risk register.** List technical, data, security, operational,
   dependency, and rollout risks with likelihood, impact, detection, mitigation,
   owner, and rollback or escalation path. State `None identified` only after
   considering each category.

## No-placeholder rule

Do not save a durable plan containing `TBD`, `TODO`, `TBC`, empty tasks,
unverified invented paths, generic test instructions, or unowned placeholders.
Resolve the detail from the approved specification and repository evidence, or
identify a material open decision and return clarification/error rather than
publishing an execution-ready-looking plan.

## Adversarial self-critique

Before writing, attempt to invalidate the plan: confirm every task traces to a
requirement, dependencies form a valid order, listed files and interfaces exist
or are explicitly new, verification would catch a plausible regression, and the
risk register covers adverse rollout outcomes. Remove speculative work and
surface unresolved architectural or security forks.

## Reservation policy

Before writing the artifact, call `veles_reserve_planning_path` with:

```json
{
  "directory": "docs/plans/",
  "baseName": "YYYY-MM-DD-<topic>-plan",
  "extension": ".md"
}
```

Use the returned path exactly. Then call
`veles_write_reserved_planning_artifact` with that path and the complete
Markdown content. Do not probe for existing files, choose collision suffixes
manually, or write the artifact with direct `Write`.

## Plan frontmatter

The saved implementation plan begins with YAML frontmatter containing:

```yaml
artifact_type: implementation-plan
spec_path: docs/specs/<approved-spec>.md
spec_digest: <canonical-digest-of-approved-spec>
approved: false
```

`spec_path` is a normalized repo-relative path to the approved source
specification. It is required in headless mode and optional in direct-user mode.
`spec_digest` is required in headless mode. Do not include `approved_at` or
`approved_by_session` until `approve_planning_artifact` approves the plan.

## Output contract

Return a structured result with:

```json
{
  "status": "ok",
  "type": "implementation-plan",
  "plan_path": "docs/plans/<reserved-file>.md",
  "topic": "<topic>",
  "summary": "One-sentence human-readable implementation-plan summary.",
  "spec_path": "docs/specs/<approved-spec>.md"
}
```

Return a structured clarification or error result rather than writing a plan
when the required specification, approval state, material decision, or evidence
is unavailable.
