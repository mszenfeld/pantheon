import { describe, expect, it } from "vitest"
import type { Config } from "@opencode-ai/plugin"
// Import the REAL registered agent from the code-review build unit (dist), the
// same artifact the root entrypoint loads. `packages/ -> src/` is forbidden, but
// `src/ -> packages/<name>/dist` is the allowed migration direction (src/index.ts
// already imports this exact module).
import { AppVerkCodeReviewPlugin } from "../../../packages/code-review/dist/index.js"
import { fixAutoSpecialistInfo } from "../../../src/modules/agent-registry/fix-auto.metadata.js"

/**
 * Cross-boundary anti-drift guard for `fix-auto` (review report M4).
 *
 * `fix-auto` lives in `packages/code-review`, a separate build unit that cannot
 * import the src-side agent registry. Its name/mode/description are therefore
 * DUPLICATED in `src/modules/agent-registry/fix-auto.metadata.ts`
 * (`fixAutoSpecialistInfo`) and rendered into Perun's specialist table from the
 * coordinator factory. If `code-review` renames the agent, flips its mode, or
 * edits its description without updating `fixAutoSpecialistInfo`, Perun silently
 * advertises a phantom specialist and the dispatch preflight rejects it at
 * runtime — with no build/test signal.
 *
 * The pre-existing anti-drift test (`metadata-coverage.test.ts`) only ever
 * instantiates QA/coordinator/explore, so it compares the src copy against
 * itself and never against the real `code-review` registration. This test
 * closes that gap by booting `AppVerkCodeReviewPlugin` from dist and comparing
 * its actually-registered `config.agent["fix-auto"]` entry against the src-side
 * metadata.
 */
describe("cross-boundary sync: fix-auto metadata mirrors the code-review registration", () => {
  async function registeredFixAutoAgent(): Promise<{
    mode?: string
    description?: string
  }> {
    const plugin = await AppVerkCodeReviewPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    const agent = config.agent?.[fixAutoSpecialistInfo.name]
    expect(
      agent,
      `code-review must register an agent under key "${fixAutoSpecialistInfo.name}"; ` +
        "if it was renamed/retired, update fixAutoSpecialistInfo (and Perun's routing) to match.",
    ).toBeDefined()
    return agent as { mode?: string; description?: string }
  }

  it("registers fix-auto under the same key the src-side metadata advertises", async () => {
    const agent = await registeredFixAutoAgent()
    expect(agent).toBeDefined()
  })

  it("mode matches fixAutoSpecialistInfo.mode", async () => {
    const agent = await registeredFixAutoAgent()
    expect(agent.mode).toBe(fixAutoSpecialistInfo.mode)
  })

  it("description matches fixAutoSpecialistInfo.description", async () => {
    const agent = await registeredFixAutoAgent()
    expect(agent.description).toBe(fixAutoSpecialistInfo.description)
  })
})
