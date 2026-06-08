# @appverk/opencode-code-review

Code review workflow for OpenCode. Provides the `/review` command with parallel security and code quality audits, python-developer skill integration, and structured report generation with issue IDs.

## Installation

The root plugin bundle (`av-opencode-plugins`) includes this package automatically. No separate install needed.

## Usage

Run a comprehensive code review:

```text
/review <description>
```

Example:
```text
/review Review the authentication module for security issues and code quality
```

The command:
1. Detects your project stack (Python, Frontend, PHP)
2. Loads relevant `python-developer` skills for framework-specific checks (if Python)
3. Launches agents in parallel:
   - **security-auditor** — delegates to skill-agents for secret scanning, SAST, and dependency scanning
   - **code-quality-auditor** — delegates to skill-agents for linter integration and architecture analysis
   - **documentation-auditor** — verifies code changes are reflected in docs (if documentation detected)
4. Runs verification agents:
   - **cross-verifier** — finds correlations between security, quality, and documentation findings
   - **challenger** — challenges CRITICAL/HIGH findings for false positives
5. Aggregates findings, assigns issue IDs (SEC-001, ARCH-001, etc.)
6. Generates a structured markdown report
7. Optionally saves to `docs/reviews/YYYY-MM-DD-<branch>.md`

### Fix single issue

```text
/fix SEC-001
```

`/fix` also resolves QA issues from test reports. Use `/fix QA-001` to fix an issue found by `/qa:run`.

Or paste the full issue block:

```text
/fix [paste issue block]
```

### Batch fix from report

Pass a specific report path to fix issues from that report only:

```text
/fix-report docs/reviews/2026-04-22-feature-auth.md
```

Or run without arguments to **auto-merge** the newest review and QA reports:

```text
/fix-report
```

When run without arguments, it automatically discovers the latest review report (`docs/reviews/*.md`) and the latest QA report (`docs/testing/reports/*.md`), merges their unfixed issues into a single checklist, and presents them for selection. Issues are tagged with their source report so fixed items are marked resolved in the correct file.

Presents issues as a checklist, fixes selected ones via `fix-auto` subagent, and marks them resolved.

### Analyze PR feedback

```text
/analyze-feedback 123
```

Fetches review comments from PR #123, classifies each as "Address" or "Reject", and generates draft responses for rejected feedback. Optionally publishes responses via GitHub CLI.

## Direct Agent Use

You can also invoke the agents directly:

```bash
opencode agent security-auditor "Audit the payment module for vulnerabilities"
opencode agent code-quality-auditor "Review the user service for SOLID violations"
opencode agent documentation-auditor "Check if API changes are documented"
opencode agent cross-verifier "Correlate security and architecture findings"
opencode agent challenger "Challenge HIGH severity findings for false positives"
opencode agent feedback-analyzer "Evaluate this PR comment for validity"
opencode agent fix-auto "Fix this issue block without asking for confirmation"
```

## What Gets Reviewed

### Security Audit
- Secret scanning (API keys, passwords, tokens in source code)
- SAST analysis (injection, XSS, SSRF, misconfiguration)
- Dependency scanning (CVEs, vulnerable packages)
- AI threat modeling (business logic flaws, auth bypass, IDOR)
- Framework-specific security patterns (if python-developer skills loaded)

### Code Quality Audit
- Standards discovery (CONTRIBUTING.md, CODING_STANDARDS.md)
- Linter integration (ruff, mypy, eslint, tsc with project configs)
- Architecture analysis (SOLID, DDD, Clean Architecture)
- AI design review (cohesion, coupling, testability)
- Framework-specific quality patterns (if python-developer skills loaded)

## Report Format

Each issue is assigned a unique ID:

| Category | Prefix | Example |
|----------|--------|---------|
| Security | SEC | SEC-001 |
| Performance | PERF | PERF-002 |
| Architecture | ARCH | ARCH-003 |
| Maintainability | MAINT | MAINT-004 |
| Documentation | DOC | DOC-005 |
| Testing | QA | QA-001 |

> **Cross-plugin note:** The `QA` prefix is owned by the QA plugin and consumed by the code-review plugin (`/fix` command). Both plugins share the same canonical Category→Prefix table defined in `packages/skill-utils/src/category-prefix-mapping.ts`.

Every issue includes:
- Severity (CRITICAL / HIGH / MEDIUM / LOW)
- File path and line number
- OWASP category (if applicable)
- CWE identifier (if applicable)
- Problem description and impact
- Remediation with before/after code examples
- Estimated effort (trivial / easy / medium / hard)

## Architecture

The plugin registers the following elements through its `config` hook:

> **Note:** All code-review agents are registered with `mode: "subagent"`. They are hidden from tab-completion and intended to be invoked programmatically by commands or other agents.

### Commands

| Element | OpenCode Mechanism | Purpose |
|---|---|---|
| `command.review` | `config.command` | Orchestrates stack detection, parallel agent dispatch, verification, result aggregation, ID assignment, and report formatting. |
| `command.fix` | `config.command` | Fixes a single issue by ID lookup or pasted issue block. Performs analysis, proposal, implementation, verification, and reporting. |
| `command.fix-report` | `config.command` | Parses a saved review report, presents issues as a checklist, fixes selected issues via `fix-auto` subagent, and marks them resolved. |
| `command.analyze-feedback` | `config.command` | Fetches PR comments, classifies each via `feedback-analyzer` subagent, generates report with draft responses, optionally publishes to GitHub. |

### Main Audit Agents

| Element | OpenCode Mechanism | Purpose |
|---|---|---|
| `agent.security-auditor` | `config.agent` | Security-focused agent prompt. Delegates secret scanning, SAST, and dependency scanning to skill-agents via Task tool. Performs AI threat modeling and framework-specific checks. |
| `agent.code-quality-auditor` | `config.agent` | Quality-focused agent prompt. Performs inline standards-discovery. Delegates linter integration and architecture analysis to skill-agents via Task tool. |
| `agent.documentation-auditor` | `config.agent` | Documentation audit agent. Detects project docs, maps code changes to documentation, and flags outdated or missing entries. |

### Verification Agents

| Element | OpenCode Mechanism | Purpose |
|---|---|---|
| `agent.cross-verifier` | `config.agent` | Cross-domain correlation agent. Finds intersections between security, quality, and documentation findings. |
| `agent.challenger` | `config.agent` | Adversarial review agent. Challenges CRITICAL/HIGH findings for false positives and validates severity levels. |
| `agent.synthesis-agent` | `config.agent` | **Planned** — deduplicates, composites, and groups findings into actionable PRs. Not yet implemented. |

### Subagents

| Element | OpenCode Mechanism | Purpose |
|---|---|---|
| `agent.feedback-analyzer` | `config.agent` | Per-comment classification agent. Analyzes a single PR comment for validity and generates a draft response if rejected. |
| `agent.fix-auto` | `config.agent` | Auto-fix subagent. Performs analysis, implementation, verification, and reporting without user confirmation. Invoked by `/fix-report`. |

### Skill-Agents

Skill-agents are dedicated subagents for heavy analysis tasks, invoked by main audit agents via the Task tool:

| Element | OpenCode Mechanism | Purpose |
|---|---|---|
| `agent.skill-secret-scanner` | `config.agent` | Detects hardcoded secrets, API keys, passwords, and credentials. Uses trufflehog and fallback pattern matching. |
| `agent.skill-sast-analyzer` | `config.agent` | Multi-language static application security testing. Uses Semgrep, Bandit, ESLint, and pattern matching. |
| `agent.skill-dependency-scanner` | `config.agent` | Scans dependencies for known CVEs. Supports Python (uv/pip/poetry), JavaScript, Go, Java, Ruby, PHP. |
| `agent.skill-architecture-analyzer` | `config.agent` | Analyzes SOLID principles, DDD patterns, Clean Architecture boundaries, and anti-patterns. |
| `agent.skill-linter-integrator` | `config.agent` | Auto-detects and runs project-configured linters and typecheckers. Supports Python and TypeScript. |

### Skills

The plugin includes a `standards-discovery` skill available globally via `load_appverk_skill("standards-discovery")`. The `src/index.ts` entrypoint injects a Pre-Analysis block into every agent and command prompt, instructing them to load this skill before starting work. This discovers project-specific coding standards, style guides, and architecture documentation automatically — no manual copy-pasting into markdown files needed.

### How Agents Work

1. The `/review` command starts by detecting the project tech stack (Python, Frontend, PHP).
2. If Python is detected, it loads relevant `python-developer` skills via the `load_python_skill` tool.
3. It launches main audit agents in parallel via the `task` tool.
4. Main audit agents delegate heavy analysis to skill-agents via the Task tool (e.g., `security-auditor` spawns `skill-secret-scanner`).
5. After collecting results, verification agents (`cross-verifier`, `challenger`) and the planned `synthesis-agent` validate findings.
6. Results are aggregated, false positives removed, composite findings added.
7. The command assigns category-prefixed IDs and formats the final report.

## Limitations

- **Skill-agent dependency:** Main audit agents require skill-agents to be registered. If a skill-agent is missing, the main audit agent falls back to manual instructions.
- **Agent output parsing:** Agents return findings as text; the command parses them from Task output. Complex reports may require manual verification of ID assignment.
- **No persistent state:** Issue status tracking (fixed/partially-fixed) relies on markdown report files. No database or external state.
- **GitHub CLI required:** `/analyze-feedback` requires `gh` CLI installed and authenticated.
- **Frontend/PHP skills:** Stack detection recognizes Frontend and PHP projects, but dedicated skill loading (like `load_python_skill`) is not yet implemented for these stacks.

## Project Structure

- `src/index.ts` — Plugin entry point (config hook registration)
- `src/commands/review.md` — `/review` command template
- `src/commands/fix.md` — `/fix` command template
- `src/commands/fix-report.md` — `/fix-report` command template
- `src/commands/analyze-feedback.md` — `/analyze-feedback` command template
- `src/agents/security-auditor.md` — Security auditor agent prompt (delegates to skill-agents)
- `src/agents/code-quality-auditor.md` — Code quality auditor agent prompt (delegates to skill-agents)
- `src/agents/documentation-auditor.md` — Documentation auditor agent prompt
- `src/agents/cross-verifier.md` — Cross-verifier agent prompt
- `src/agents/challenger.md` — Challenger agent prompt
- `src/agents/feedback-analyzer.md` — Feedback analyzer subagent prompt
- `src/agents/fix-auto.md` — Auto-fix subagent prompt
- `src/agents/skill-secret-scanner.md` — Secret scanning skill-agent
- `src/agents/skill-sast-analyzer.md` — SAST analysis skill-agent
- `src/agents/skill-dependency-scanner.md` — Dependency scanning skill-agent
- `src/agents/skill-architecture-analyzer.md` — Architecture analysis skill-agent
- `src/agents/skill-linter-integrator.md` — Linter integration skill-agent
- `src/skills/standards-discovery/SKILL.md` — Standards discovery skill (global via skill-registry)
- `scripts/copy-assets.mjs` — Build step that copies markdown files to `dist/`
