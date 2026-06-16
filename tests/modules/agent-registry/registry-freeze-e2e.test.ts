import { beforeEach, describe, expect, it } from "vitest"
import {
  clearAgentMetadataRegistry,
  registerAgentMetadata,
} from "../../../src/modules/agent-registry/index.js"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"
import { AppVerkExplorePlugin } from "../../../src/modules/explore/index.js"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import type { SpecialistInfo } from "../../../src/modules/agent-registry/agent-metadata.js"
import type { Config } from "@opencode-ai/plugin"

function info(name: string): SpecialistInfo {
  return {
    name,
    mode: "subagent",
    description: `${name} desc`,
    metadata: { triggers: [] },
  }
}

/**
 * End-to-end proof of the ordering invariant: a `registerAgentMetadata`
 * that runs AFTER the coordinator has built Perun's prompt must FAIL LOUD rather
 * than silently never reaching the cached prompt. This drives the REAL coordinator
 * `config` hook and the REAL `get prompt()` getter (which calls `getPerunPrompt()`,
 * the snapshot+cache path) instead of calling the builder directly — so it covers
 * the cache the unit tests bypass.
 */
describe("late registration after Perun prompt snapshot fails loud", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("throws when an agent registers after getPerunPrompt() has snapshotted the registry", async () => {
    const fakeClient = {} as never
    const toastClient = {
      client: { tui: { showToast: async () => {} } },
    } as never
    // Mirror the real defaultPluginFactories ORDER: every agent-registering
    // module constructs BEFORE the coordinator. explore (triglav) + qa (zmora)
    // back the {USE_AVOID:triglav} and specialist rows perun.md references; the
    // coordinator factory itself registers fix-auto.
    await AppVerkExplorePlugin(toastClient)
    await AppVerkQAPlugin({ client: fakeClient } as never)
    const coord = await AppVerkCoordinatorPlugin({
      client: fakeClient,
    } as never)

    // Run the coordinator's config hook — registers fix-auto + installs the
    // Perun agent def with the lazy `get prompt()` getter.
    const config: Config = { agent: {} }
    await coord.config?.(config as never)

    // Reading the prompt getter triggers getPerunPrompt() → snapshot + freeze.
    const perunDef = config.agent?.["Perun - Coordinator"]
    expect(perunDef).toBeDefined()
    const prompt = (perunDef as { prompt: string }).prompt
    expect(prompt.length).toBeGreaterThan(0)
    // fix-auto was registered by the coordinator factory BEFORE the snapshot, so
    // it is in the rendered prompt — the registry was non-empty at snapshot time.
    expect(prompt).toContain("`fix-auto`")

    // A module mis-ordered AFTER the coordinator would register here, post-snapshot.
    expect(() => registerAgentMetadata(info("late-agent"))).toThrow(
      /Late agent registration after Perun prompt snapshot: late-agent/,
    )
  })
})
