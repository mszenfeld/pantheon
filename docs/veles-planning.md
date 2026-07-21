# Veles planning

## Overview

Veles is the planning specialist. In a direct Veles session, it classifies a planning request into one of three modes:

- **Feature spec** — defines the problem, goals, constraints, requirements, architecture considerations, risks, and acceptance criteria before implementation is planned.
- **Implementation plan** — turns an approved feature spec into an executable, reviewable sequence of implementation tasks, including affected files, interfaces, verification, and risks.
- **QA test plan** — defines acceptance scenarios and required setup for validating a change.

## Direct Veles sessions

Start a direct session with **Veles - Planner** and describe what you need in natural language. Veles selects the appropriate mode, or asks one focused clarifying question when the intent is ambiguous.

Examples:

- “Design multi-mode Veles.” — feature spec
- “Plan the implementation of multi-mode Veles.” — implementation plan
- “Create a QA plan for PR #123.” — QA test plan
- “Write a test plan for the new login flow.” — QA test plan

## Invoking planning from Perun

Veles does not register `/veles:*` slash commands. To plan directly, switch to
**Veles - Planner** and describe the request in natural language. In a Perun
session (or any other agent session), request planning in natural language instead. For example:

- “Design a feature spec for X.”
- “Plan the implementation of Y.”
- “Create a QA plan for PR #123.”

Perun will route the request to Veles when appropriate.

`/qa:create-plan` is a standalone QA command that continues to work globally. It does not dispatch Veles.

## Output locations

Veles writes durable artefacts to the following directories:

| Mode | Directory |
| --- | --- |
| Feature spec | `docs/specs/` |
| Implementation plan | `docs/plans/` |
| QA test plan | `docs/testing/plans/` |

## Headless Perun dispatch

When Perun dispatches Veles, it supplies a headless envelope with these fields:

```text
Execution context: perun-headless
Mode: <spec|implementation-plan|qa>
```

Headless Veles requests do not use interactive questions. Their result follows one unified contract:

- `ok` — an artefact was created; includes its type, `plan_path`, topic, and one-sentence summary. QA results also include their QA-specific setup and scenario counts.
- `needs_clarification` — the request cannot be classified or completed without missing information; includes a topic, message, and suggested modes.
- `error` — the request could not be completed; includes a topic and reason.
- `timeout` — planning did not complete within the dispatch limit; includes a topic.

## Approval flow

Feature specs and implementation plans are review artefacts. Review and approve them before asking Svarog to execute an implementation plan. This approval step makes the intended requirements and implementation approach explicit before code changes begin.

## Collision policy

Veles never overwrites a durable planning artefact. When a requested destination already exists, it creates a new suffixed path instead, such as `2026-07-15-example-plan-2.md`. Revisions are therefore separate artefacts, and any references should be updated to the new path.
