# @appverk/opencode-python-developer

Python development workflow for OpenCode. Provides the `/python` command and `python-developer` agent with modular skill loading for FastAPI, Django, Celery, SQLAlchemy, Pydantic, and async patterns.

## Installation

The root plugin bundle (`av-opencode-plugins`) includes this package automatically. No separate install needed.

## Usage

Run the Python development workflow:

```text
/python <task description>
```

Example:
```text
/python Add user authentication endpoint with JWT
```

The command:
1. Detects your project stack (FastAPI, Django, Celery, etc.)
2. Loads relevant Python development skills
3. Follows TDD: writes tests first, then implementation
4. Runs quality gates (typecheck, tests, lint)

## Direct Agent Use

You can also invoke the agent directly:

```bash
opencode agent python-developer "Refactor user service to use repository pattern"
```

## Available Skills

The plugin bundles 10 skills loaded on demand via the global `load_appverk_skill` tool (provided by the `skill-registry` package):

- `coding-standards` — AppVerk Python rules (types, imports, naming)
- `tdd-workflow` — Red-green-refactor cycle, fakes over mocks
- `fastapi-patterns` — DDD/Clean Architecture with FastAPI
- `sqlalchemy-patterns` — Async repository pattern, UoW
- `pydantic-patterns` — Model validation, settings
- `async-python-patterns` — asyncio, uvicorn, non-blocking I/O
- `uv-package-manager` — uv add/run/lock workflows
- `django-web-patterns` — Views, ViewSets, DRF serializers
- `django-orm-patterns` — Models, queries, migrations, N+1 prevention
- `celery-patterns` — Idempotent tasks, retry, pass IDs not objects

## Architecture

The entry point (`src/index.ts`) is a thin wrapper around `createSkillPlugin` from `@appverk/opencode-skill-utils`, which registers the following elements through OpenCode's `config` hook:

| Element | OpenCode Mechanism | Purpose |
|---|---|---|
| `agent.python-developer` | `config.agent` | Core persona with Python/TDD expertise. Registered with `mode: "primary"` so it appears in TUI tab-completion. System prompt lists available skills and instructs the agent when to call `load_appverk_skill`. |
| `command.python` | `config.command` | Prompt template with `agent: python-developer` frontmatter. Orchestrates stack detection → core skill loading → conditional skill loading → TDD cycle. |

Skill loading itself is **not** provided by this package — it is handled by the global `load_appverk_skill` tool exposed by the `skill-registry` package, which reads the skill files this package builds to `dist/skills/`.

### How Skills Are Loaded

1. The `/python` command (or direct agent invocation) starts a session with the `python-developer` agent.
2. The agent detects the project stack by reading `pyproject.toml` and scanning `src/` or `app/` imports.
3. The agent calls the global `load_appverk_skill(name)` tool for each relevant skill.
4. The tool resolves the named skill from the registered `dist/skills/{name}/SKILL.md` files and returns its content.
5. OpenCode injects the skill content into the agent context.
6. The agent follows the loaded rules during the TDD cycle and quality gates.

**Core skills** (`coding-standards`, `tdd-workflow`) are loaded for every task.  
**Stack-specific skills** (FastAPI, Django, Celery, etc.) are loaded only when the corresponding framework is detected.

## Limitations

- OpenCode does **not** auto-detect Python files and auto-switch to the `python-developer` agent. You must explicitly use `/python` or invoke the agent manually.
- Skills are loaded on demand via tool calls; the agent must correctly identify which skills are needed.
- If the plugin fails to load, `/python` will not be available and the `python-developer` agent will not exist.

## Project Structure

- `src/index.ts` — Plugin entry point; a thin `createSkillPlugin` wrapper (config hook only, no local skill-loading tool)
- `src/agent-prompt.md` — Core system prompt for `python-developer` agent
- `src/commands/python.md` — `/python` command template
- `src/skills/{name}/SKILL.md` — 10 skill definitions (consumed by the global `skill-registry`'s `load_appverk_skill` tool)
- `scripts/copy-skills.mjs` — Build step that copies skills to `dist/skills/`
