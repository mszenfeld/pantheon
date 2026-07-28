import { describe, expect, it } from "vitest"

import {
  buildTaskPrompt,
  chunkDispatchTasks,
  sanitizeTaskMetadata,
  validateDispatchTasks,
} from "../../../src/modules/coordinator/task-builder.js"

describe("task builder", () => {
  it("builds a task prompt with optional scenario context", () => {
    expect(buildTaskPrompt({ name: "triglav", prompt: "Explore", context: "Read src/" })).toBe(
      "Explore\n\nRead src/",
    )
  })

  it("chunks task payloads without reordering them", () => {
    const tasks = ["A", "B", "C", "D", "E"].map((name) => ({ name, prompt: name }))

    expect(chunkDispatchTasks(tasks, 2).map((chunk) => chunk.map((task) => task.name))).toEqual([
      ["A", "B"],
      ["C", "D"],
      ["E"],
    ])
  })

  it("neutralizes task data intended for UI metadata", () => {
    expect(sanitizeTaskMetadata([{ name: "triglav\u001b", prompt: "<script>" }])).toEqual([
      { name: "triglav", prompt: "&lt;script&gt;" },
    ])
  })

  it("validates every target before dispatching any task", () => {
    expect(() =>
      validateDispatchTasks(
        [{ name: "unknown", prompt: "x" }],
        { triglav: { mode: "subagent" } },
      ),
    ).toThrow("Unknown agent: unknown")
  })
})
