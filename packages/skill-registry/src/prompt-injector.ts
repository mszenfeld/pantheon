import type { SkillEntry } from "./skill-catalog.js"

export function generateActivationRules(
  catalog: Map<string, SkillEntry>,
): string {
  const entries = Array.from(catalog.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  const rows = entries
    .map((skill) => `| \`${skill.name}\` | ${skill.activation} |`)
    .join("\n")

  return `## AppVerk Skills — Mandatory Activation Rules

You have access to the \`load_appverk_skill(name)\` tool. Load skills BEFORE starting work. Do not guess — follow the rules below.

### Universal Rules (all tasks)
| When you are... | You MUST load... |
|---|---|
| Writing, modifying, or reviewing Python code | \`python-coding-standards\` |
| Writing, modifying, or reviewing TypeScript/React code | \`frontend-coding-standards\` |
| Writing tests, fixing bugs, refactoring Python code | \`python-tdd-workflow\` |
| Writing tests, fixing bugs, refactoring TypeScript/React code | \`frontend-tdd-workflow\` |
| Adding/removing/updating Python dependencies | \`uv-package-manager\` |
| Adding/removing/updating TypeScript dependencies | \`pnpm-package-manager\` |

### Python Stack Rules
| When the project uses... | You MUST load... |
|---|---|
| FastAPI | \`fastapi-patterns\` |
| SQLAlchemy | \`sqlalchemy-patterns\` |
| Pydantic | \`pydantic-patterns\` |
| asyncio / uvicorn | \`async-python-patterns\` |
| Django | \`django-web-patterns\` + \`django-orm-patterns\` |
| Celery | \`celery-patterns\` |

### TypeScript/React Stack Rules
| When the project uses... | You MUST load... |
|---|---|
| Tailwind CSS | \`tailwind-patterns\` |
| Zustand | \`zustand-patterns\` |
| TanStack Query | \`tanstack-query-patterns\` |
| React Hook Form | \`form-patterns\` |
| TanStack Router | \`tanstack-router-patterns\` |

### All Available Skills
| Skill | Activation Rule |
|---|---|
${rows}

### HARD-RULES
- BEFORE any coding, review, or refactoring: check the tables above and load ALL applicable skills.
- If unsure whether a skill applies: load it — better to have context than miss constraints.
- After loading a skill, follow its HARD-RULES strictly.
- Do NOT begin implementation without loading applicable skills first.`
}
