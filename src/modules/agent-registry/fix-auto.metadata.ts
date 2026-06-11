import type { SpecialistInfo } from "./agent-metadata.js"

/**
 * Explicit src-side entry for `fix-auto`, which lives in `packages/code-review`
 * (a separate build unit that cannot import the registry bridge during the
 * plugins->harness migration — see spec). Registered from the coordinator factory.
 *
 * `name`/`mode`/`description` MUST mirror the agent `code-review` actually
 * registers in `config.agent["fix-auto"]` (the hardcoded AGENTS entry in
 * `packages/code-review/src/index.ts`) — Perun's specialist table is rendered
 * from these fields, so any drift makes Perun advertise a phantom agent that
 * the dispatch preflight then rejects at runtime. The sync is enforced by
 * `tests/modules/agent-registry/fix-auto-cross-boundary-sync.test.ts`, which
 * instantiates `AppVerkCodeReviewPlugin` from dist and compares the registered
 * key/mode/description against this constant.
 */
export const fixAutoSpecialistInfo: SpecialistInfo = {
  name: "fix-auto",
  mode: "subagent",
  description:
    "Auto-fix subagent for code review issues. Performs analysis, implementation, verification, and reporting without user confirmation.",
  metadata: {
    triggers: [],
  },
}
