# Skill Registry Plugin Guide

The root plugin bundle includes this package automatically.

## Usage

All AppVerk development skills are available globally to every OpenCode agent via the `load_appverk_skill(name)` tool. You do not need to run a command — the skill registry activates automatically when the plugin bundle loads.

Load a skill manually in any conversation:

```text
Use the load_appverk_skill tool with name "python-coding-standards"
```

Or load multiple skills at once:

```text
Load these skills: python-coding-standards, python-tdd-workflow, fastapi-patterns
```

## What it does

1. **Scans skill directories** at plugin initialization — reads
   `packages/python-developer/dist/skills/`,
   `packages/frontend-developer/dist/skills/`,
   `packages/code-review/dist/skills/`,
   `dist/skills/qa/`, and
   `packages/swift-developer/dist/skills/`.
2. **Parses frontmatter** from every `.md` file to extract `name`, `description`, and `activation` fields.
3. **Validates uniqueness** — throws if two skills share the same `name`.
4. **Registers `load_appverk_skill`** as a global OpenCode tool available to all agents.
5. **Injects activation rules** into every agent's system prompt via `experimental.chat.system.transform`, instructing agents when to load which skill.

## Consumers

The `code-review` plugin consumes `standards-discovery` by injecting a Pre-Analysis block into every agent and command prompt at runtime. This ensures all review workflows discover project-specific standards before analysis begins.

## Direct tool use

You can call the tool directly from any agent conversation:

```text
load_appverk_skill("frontend-coding-standards")
```

If the skill name is unknown, the tool returns an error listing all available skills.

## Architecture

| Element | Purpose |
|---------|---------|
| `load_appverk_skill` | Global tool — loads a skill markdown file by name. Returns full content. Cached after first load. |
| `experimental.chat.system.transform` | Injects "AppVerk Skills — Mandatory Activation Rules" into every agent's system prompt. |
| `buildSkillCatalog` | Scans `dist/skills/` directories, parses YAML-like frontmatter, builds `Map<string, SkillEntry>`. |
| `generateActivationRules` | Generates markdown tables of skills and their activation conditions for the system prompt. |

## Available Skills

### Python Stack
| Skill | Activation |
|---|---|
| `python-coding-standards` | MUST load when writing or reviewing Python code |
| `python-tdd-workflow` | MUST load when writing tests, fixing bugs, or refactoring Python code |
| `fastapi-patterns` | When FastAPI is detected |
| `sqlalchemy-patterns` | When SQLAlchemy is detected |
| `pydantic-patterns` | When Pydantic is involved |
| `async-python-patterns` | When asyncio / uvicorn is detected |
| `uv-package-manager` | When managing Python dependencies |
| `django-web-patterns` | When Django is detected |
| `django-orm-patterns` | When Django ORM is involved |
| `celery-patterns` | When Celery is detected |

### TypeScript/React Stack
| Skill | Activation |
|---|---|
| `frontend-coding-standards` | MUST load when writing or reviewing TypeScript/React code |
| `frontend-tdd-workflow` | MUST load when writing tests, fixing bugs, or refactoring TypeScript/React code |
| `tailwind-patterns` | When Tailwind CSS is detected |
| `zustand-patterns` | When Zustand is detected |
| `tanstack-query-patterns` | When TanStack Query is detected |
| `form-patterns` | When React Hook Form is detected |
| `tanstack-router-patterns` | When TanStack Router is detected |
| `pnpm-package-manager` | When managing TypeScript dependencies |

### Swift Stack
| Skill | Activation |
|---|---|
| `swift-coding-standards` | Load when writing or reviewing Swift code |
| `swift-tdd-workflow` | Load when writing tests, fixing bugs, or refactoring Swift code |
| `swiftui-patterns` | Load when writing or reviewing SwiftUI views, state management, or UI code |
| `swift-concurrency-patterns` | Load when writing async/await code, actors, or concurrent Swift code |
| `swift-data-persistence` | Load when implementing data storage or persistence in Swift |
| `swift-networking-patterns` | Load when building network layers or API clients in Swift |
| `swift-package-manager` | Load when managing Swift package dependencies or project configuration |

## Limitations

- Skills are loaded by matching the `name` field in frontmatter, not by filename.
- The catalog is built once at plugin initialization; new skill files require a restart to appear.
- No hot-reloading of skills during runtime.

## Project Structure

| File | Responsibility |
|------|---------------|
| `packages/skill-registry/src/index.ts` | Plugin factory — exports `AppVerkSkillRegistryPlugin` |
| `packages/skill-registry/src/skill-catalog.ts` | Scans directories, parses frontmatter, validates uniqueness |
| `packages/skill-registry/src/load-skill.ts` | Tool implementation with in-memory caching |
| `packages/skill-registry/src/prompt-injector.ts` | Generates system prompt activation rules block |
| `packages/skill-registry/tests/skill-catalog.test.ts` | Unit tests for scanning, parsing, and duplicate detection |
| `packages/skill-registry/tests/load-skill.test.ts` | Unit tests for loading, caching, and error messages |
| `packages/skill-registry/tests/prompt-injector.test.ts` | Unit tests for activation rules generation |
| `packages/skill-registry/tests/plugin.test.ts` | Smoke test for plugin exports and hooks |
