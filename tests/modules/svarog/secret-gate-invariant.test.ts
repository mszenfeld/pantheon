import { describe, expect, it } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import {
  SessionAgentRegistry,
  makeShellEnvHook,
} from "../../../src/modules/qa/shell-env-hook.js"
import { SVAROG_AGENT_KEY } from "../../../src/modules/svarog/svarog.metadata.js"

describe("Svarog secret-gate invariant (minter != actuator)", () => {
  it("the QA shell.env hook injects NO binding into a svarog session", async () => {
    const store = new BindingsStore()
    store.writeBinding("perun1", "QA_BIND_TOKEN", "eyJ...", "secret", "minted-recipe")

    const registry = new SessionAgentRegistry()
    registry.register("svarog-child", SVAROG_AGENT_KEY)

    const hook = makeShellEnvHook({
      store,
      registry,
      resolveParentID: async () => "perun1",
    })

    const env: Record<string, string> = {}
    await hook({ sessionID: "svarog-child", cwd: "/" }, { env })
    expect(env.QA_BIND_TOKEN).toBeUndefined()
  })

  it("DOES inject the binding into a zmora session (proves the svarog gate is attribution, not an inert hook)", async () => {
    const store = new BindingsStore()
    store.writeBinding("perun1", "QA_BIND_TOKEN", "eyJ...", "secret", "minted-recipe")

    const registry = new SessionAgentRegistry()
    registry.register("zmora-child", "zmora-setup")

    const hook = makeShellEnvHook({
      store,
      registry,
      resolveParentID: async () => "perun1",
    })

    const env: Record<string, string> = {}
    await hook({ sessionID: "zmora-child", cwd: "/" }, { env })
    // the negative svarog result above is due to attribution, not a hook that injects for no one
    expect(env.QA_BIND_TOKEN).toBe("eyJ...")
  })
})
