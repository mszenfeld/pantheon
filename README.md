<p align="center">
  <img src="docs/assets/image.png" alt="" width="280" />
  <br />
  <img src="docs/assets/text.png" alt="Pantheon — AI Harness" width="380" />
</p>

<p align="center">
  <em>An OpenCode-based harness for orchestrating AI agents.</em>
</p>

---

Pantheon provides a coordinator agent that delegates work to specialists, a QA agent for executing test plans, and per-agent model configuration.

The harness curates the agent picker — only registered agents are shown and new sessions start on `Perun - Coordinator`. See [`docs/configuring-agents.md`](docs/configuring-agents.md) for details.

## Primary agents

| Agent     | Description                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Perun** | The coordinator. Delegates work to specialists (blocking or in the background so it can overlap exploration with its own work), computes dispatch waves with dependency awareness, and synthesizes results. |
| **Veles** | Planning specialist. Authors feature specs, implementation plans, and QA test plans from a diff or request and returns the saved artefact; it plans the work rather than executing it. See [`docs/veles-planning.md`](docs/veles-planning.md). `EXPENSIVE`. |

## Subagents

| Agent       | Description                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Zmora**   | QA tester. Executes FE and BE test scenarios on demand, dispatched by Perun.                                                |
| **Triglav** | Read-only codebase explorer. Maps structure and finds definitions/references/patterns; dispatched by Perun before planning. See [`docs/exploration.md`](docs/exploration.md). |
| **Stribog** | Light execution specialist. Performs one small, mechanical task with real side effects (bring up/fix a service, restart, read logs, a 1–2 file config change), verifies it, and returns a structured result; dispatched by Perun. Experimental (Phase 1): no automatic edit-recovery yet. See [`docs/light-execution.md`](docs/light-execution.md). |
| **Svarog** | Heavy/main code executor. Implements a multi-file feature or refactor from a plan — writes code test-first, runs the full suite/build, and returns a verified diff with a recoverable checkpoint. Stops at READY (does not commit); dispatched by Perun. See [`docs/heavy-execution.md`](docs/heavy-execution.md). |

## Installation

Add to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.4.0"
  ]
}
```

Restart OpenCode after installation or any config change.

## QA commands

The QA workflow exposes two slash commands (this is not a full command reference — most harness work flows through the agents above):

| Command           | Description                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/qa:create-plan` | Analyzes recent changes and generates a structured QA plan in `docs/testing/plans/`.                                                                                                                                                                                                                                                                        |
| `/qa:run`         | Executes the most recent plan via Perun — dispatches FE/BE scenarios to Zmora and aggregates results into `docs/testing/reports/`. Runs a preflight check on env vars, services, and databases declared in the plan's `## Setup` block (aborts before dispatch on missing items) and pauses mid-run with a resume prompt if a scenario reports `NEED_INFO`. |

## Configuring agents

Per-agent model selection lives in `pantheon.json`:

```jsonc
// ~/.config/opencode/pantheon.json
{
  "agents": {
    "perun":   { "model": "opencode-go/kimi-k2.7-code" },
    "veles":   { "model": "opencode-go/kimi-k2.7-code" },
    "zmora":   { "model": "github-copilot/gpt-5.4" },
    "triglav": { "model": "opencode-go/deepseek-v4-flash" },
    "svarog":  { "model": "openai/gpt-5.5" },
  },
}
```

> The provider prefixes above are one option — the same model is offered by several providers, so run `opencode models` for the exact ID per provider. See **Recommended models** below for the rationale behind each pick.

### Recommended models

A sensible starting point per agent. The **Perun** and **Veles** picks come from running the model-eval playbook (`docs/eval/playbook.md`; reports aren't committed to the repo); the rest are matched to each role's job. The provider is up to you — the same model is offered by several (`opencode`, `opencode-go`, `openrouter`, `anthropic`, …), each with its own ID.

| Agent | Recommended model | Why |
| --- | --- | --- |
| **Perun** (coordinator) | Kimi K2.7 Code | Eval pick across the two coordinator-discipline scenarios (`docs/eval/scenarios/perun/`) — clean on both gates (stays in role, zero `COORDINATOR_POLICY_VIOLATION`s; never improvises a credential) and steadier across iterations than Kimi K2.6 at comparable cost. The reasoning-heavy orchestration/synthesis role. |
| **Veles** (planner) | Kimi K2.7 Code | Eval pick (2026-06-24, `docs/eval/scenarios/veles/`) — strong and contract-clean across all three Layer-1 discriminators: stable ranking (from-diff), complete two-principal bindings with no dangling `$QA_BIND_*` (multi-principal), and consistent defect-grounding (flags a leftover debug artifact as a blocker instead of normalizing it). Same model Perun runs; `EXPENSIVE`, so reliability and speed matter. |
| **Zmora** (QA tester) | GPT-5.4 | Drives FE/BE scenarios with heavy, structured tool use; reliable at executing scripted steps. |
| **Triglav** (explorer) | Deepseek V4 Flash | Dispatched many-in-parallel and in the background — favors a fast, cheap model. |
| **Svarog** (heavy executor) | GPT-5.5 (strongest GPT on the OpenAI subscription; provider-gated on `openai`) | Heavy in-tree editor doing broad multi-file work — must not run on a weak model. Pinned to the top standard OpenAI GPT tier; the Svarog eval may still refine it. |

Set each in `pantheon.json` as `<providerID>/<modelID>` for the provider you choose (run `opencode models` to find the exact ID — it varies per provider). The full reference (locations, precedence, schema, FAQ) is in [`docs/configuring-agents.md`](docs/configuring-agents.md).

## Local Development

### Prerequisites

**Required:** Bun >= 1.3.13.

```bash
curl -fsSL https://bun.sh/install | bash
```

This project uses Bun exclusively. A `preinstall` guard rejects `npm install` and `yarn install`. See AGENTS.md "Prerequisites" for the rationale.

### Install + validate

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run check          # all three at once
```
