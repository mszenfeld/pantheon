---
name: feature-spec-authoring
description: Author a durable, decision-ready feature specification for Veles planning workflows.
---

# Feature Spec Authoring

## Purpose

Create a durable feature specification that gives implementers, reviewers, and
operators a shared, testable description of the intended change. A specification
records decisions and acceptance criteria; it is not an implementation plan and
must not silently invent unresolved product, security, or operational choices.

## Inputs

Gather the user's goal, available repository evidence, relevant existing
behaviour, constraints, stakeholders, and any explicitly approved decisions.
State assumptions only when they are supported by those inputs. If a material
decision is unresolved, surface it as an explicit decision request rather than
choosing a convenient default.

## Authoring workflow

1. **Define the goal.** State the user or business outcome, in-scope behaviour,
   out-of-scope work, and measurable success criteria.
2. **Record background.** Summarize the current behaviour, affected users,
   repository evidence, related systems, and the problem being solved.
3. **Capture constraints.** List compatibility, platform, timing, performance,
   privacy, compliance, dependency, and operational constraints that bound the
   solution.
4. **Write requirements.** Separate functional and non-functional requirements.
   Make each requirement observable and assign a stable identifier when that
   improves traceability.
5. **Describe architecture.** Identify affected boundaries, components, data
   flows, interfaces, ownership, and alternatives considered. Explain why the
   selected approach satisfies the requirements without expanding scope.
6. **Assess security.** Document trust boundaries, authorization and data
   handling requirements, validation, auditability, and threat mitigations.
   Escalate any security posture that has not been decided.
7. **Define testing.** Specify acceptance criteria and the unit, integration,
   contract, end-to-end, and manual checks needed to prove the requirements.
8. **Plan rollout.** Describe migration, feature-flag, deployment, monitoring,
   rollback, and support needs where applicable. Say explicitly when none apply.

## No-placeholder rule

Do not save a durable specification containing `TBD`, `TODO`, `TBC`, empty
sections, invented citations, generic filler, or unowned placeholders. Resolve
an item from evidence, mark it as an explicit open decision with its impact and
owner, or return a clarification/error result before writing.

## Adversarial self-critique

Before writing, challenge the draft: verify that every requirement traces to the
goal, every claimed fact has an input or repository source, acceptance criteria
would reject a plausible broken implementation, security and rollout omissions
are deliberate, and the architecture does not smuggle in unstated decisions.
Revise the specification to address each discovered gap.

## Reservation policy

Before writing the artifact, call `veles_reserve_planning_path` with:

```json
{
  "directory": "docs/specs/",
  "baseName": "YYYY-MM-DD-<topic>-spec",
  "extension": ".md"
}
```

Use the returned path exactly. Then call
`veles_write_reserved_planning_artifact` with that path and the complete
Markdown content. Do not probe for existing files, choose collision suffixes
manually, or write the artifact with direct `Write`.

## Specification frontmatter

The saved artifact starts with YAML frontmatter containing at least a title or
subject identifier, source context, date, and:

```yaml
approved: false
```

Do not include `approved_at` or `approved_by_session` until
`approve_planning_artifact` approves the artifact.

## Output contract

Return a structured result with:

```json
{
  "status": "ok",
  "type": "spec",
  "plan_path": "docs/specs/<reserved-file>.md",
  "topic": "<topic>",
  "summary": "One-sentence human-readable specification summary."
}
```

If the artifact cannot be completed honestly, return the applicable structured
clarification or error result instead of writing an incomplete specification.
