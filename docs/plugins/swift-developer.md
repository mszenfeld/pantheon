# Swift Developer Plugin

## Installation

The root plugin bundle includes this package automatically.

## Usage

```text
/swift <task description>
```

Example:

```text
/swift Add user profile screen with SwiftData persistence
```

## What it does

1. Detects your project stack by reading `Package.swift` and scanning imports.
2. Loads mandatory skills (`swift-coding-standards`, `swift-tdd-workflow`).
3. Loads conditional skills based on detected frameworks (SwiftUI, concurrency, networking, persistence, SPM).
4. Follows TDD: writes tests first, then implementation, then refactors.
5. Runs quality gates (build, tests, coverage ≥ 80%).

## Direct agent use

```bash
opencode agent swift-developer "Refactor networking layer to use async/await"
```

## Architecture

| Element | Name | Purpose |
|---------|------|---------|
| Command | `/swift` | Entrypoint for Swift development workflow |
| Agent | `swift-developer` | Expert Swift developer agent |
| Tool | `load_appverk_skill` | Global skill loader (managed by `skill-registry`) |

### Available Skills

| Skill | Load Condition |
|---|---|
| `swift-coding-standards` | Always |
| `swift-tdd-workflow` | When writing or modifying code |
| `swiftui-patterns` | When SwiftUI is detected |
| `swift-concurrency-patterns` | When async/await or actors are detected |
| `swift-data-persistence` | When SwiftData/CoreData is detected |
| `swift-networking-patterns` | When URLSession networking is involved |
| `swift-package-manager` | When modifying SPM dependencies |

## Limitations

- SwiftUI only — no UIKit support.
- `@Observable` only — legacy `@ObservedObject`/`@StateObject` not covered.
- SPM only — no CocoaPods or Carthage support.
- URLSession + Codable only — no Alamofire support.
- SwiftData preferred — CoreData covered only as legacy.
- iOS-focused — watchOS/tvOS/macOS specifics not explicitly covered.

## Project Structure

```
packages/swift-developer/
├── src/
│   ├── index.ts              # Plugin entry point — thin createSkillPlugin wrapper (no local skill loader)
│   ├── agent-prompt.md       # Agent system prompt
│   ├── commands/swift.md     # /swift command template
│   └── skills/               # Skill definitions, consumed by the global skill-registry's load_appverk_skill tool
│       ├── swift-coding-standards/SKILL.md
│       ├── swift-tdd-workflow/SKILL.md
│       ├── swiftui-patterns/SKILL.md
│       ├── swift-concurrency-patterns/SKILL.md
│       ├── swift-data-persistence/SKILL.md
│       ├── swift-networking-patterns/SKILL.md
│       └── swift-package-manager/SKILL.md
└── tests/
    ├── plugin.test.ts
    ├── package-smoke.test.ts
    └── build-output.test.ts
```
