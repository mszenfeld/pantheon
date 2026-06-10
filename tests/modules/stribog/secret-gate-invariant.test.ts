import { describe, expect, it } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { SessionAgentRegistry, makeShellEnvHook } from "../../../src/modules/qa/shell-env-hook.js"
import { STRIBOG_AGENT_KEY } from "../../../src/modules/stribog/stribog.metadata.js"

describe("Stribog secret-gate invariant (minter != actuator)", () => {
  it("the QA shell.env hook injects NO binding into a stribog session", async () => {
    const store = new BindingsStore()
    store.writeBinding("perun1", "QA_BIND_TOKEN", "eyJ...", "secret", "minted-recipe")

    const registry = new SessionAgentRegistry()
    registry.register("stribog-child", STRIBOG_AGENT_KEY)

    const hook = makeShellEnvHook({
      store,
      registry,
      resolveParentID: async () => "perun1",
    })

    const env: Record<string, string> = {}
    await hook({ sessionID: "stribog-child", cwd: "/" }, { env })
    expect(env.QA_BIND_TOKEN).toBeUndefined()
  })
})
