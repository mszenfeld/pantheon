import { describe, expect, it } from "vitest"
import {
  SVAROG_AGENT_KEY,
  DEFAULT_SVAROG_MODEL,
  SVAROG_SERENA_EDITORS,
  svarogSpecialistInfo,
} from "../../../src/modules/svarog/svarog.metadata.js"

describe("svarogSpecialistInfo", () => {
  it("uses the bare 'svarog' key and subagent mode", () => {
    expect(SVAROG_AGENT_KEY).toBe("svarog")
    expect(svarogSpecialistInfo.name).toBe("svarog")
    expect(svarogSpecialistInfo.mode).toBe("subagent")
  })

  it("leaves the unrendered category/cost fields unset", () => {
    expect(svarogSpecialistInfo.metadata.category).toBeUndefined()
    expect(svarogSpecialistInfo.metadata.cost).toBeUndefined()
  })

  it("routes AWAY from trivial/secret/ambiguous work (avoid-when)", () => {
    const avoid =
      svarogSpecialistInfo.metadata.avoidWhen?.join(" ").toLowerCase() ?? ""
    expect(avoid).toMatch(/stribog|trivial|mechanical/)
    expect(avoid).toContain("secret")
    expect(avoid).toMatch(/design|ambig|veles/)
  })

  it("routes TOWARD multi-file feature work via prompt-facing fields", () => {
    const { useWhen, keyTrigger, triggers, workflowContribution } =
      svarogSpecialistInfo.metadata
    expect((useWhen?.join(" ") ?? "").toLowerCase()).toMatch(
      /multi-file|feature|refactor/,
    )
    expect(keyTrigger ?? "").toContain("svarog")
    expect(triggers.length).toBeGreaterThanOrEqual(2)
    expect(workflowContribution ?? "").toMatch(/stribog/)
    expect(workflowContribution ?? "").toMatch(/veles|plan/)
  })

  it("pins a STRONG default model (provider/model form, MODEL_REGEX-valid)", () => {
    expect(DEFAULT_SVAROG_MODEL).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/)
    expect(DEFAULT_SVAROG_MODEL).toContain("/")
  })

  it("carve-out matches the 8 serena editors but NOT memory-writes or shell", () => {
    for (const id of [
      "serena_rename_symbol",
      "serena_safe_delete_symbol",
      "serena_replace_symbol_body",
      "serena_replace_content",
      "serena_replace_regex",
      "serena_insert_after_symbol",
      "serena_insert_before_symbol",
      "serena_create_text_file",
    ]) {
      expect(SVAROG_SERENA_EDITORS.test(id)).toBe(true)
    }
    for (const id of [
      "serena_write_memory",
      "serena_delete_memory",
      "serena_execute_shell_command",
      "serena_get_diagnostics_for_file",
    ]) {
      expect(SVAROG_SERENA_EDITORS.test(id)).toBe(false)
    }
  })
})
