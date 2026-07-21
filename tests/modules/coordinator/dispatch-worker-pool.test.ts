import { describe, expect, it } from "vitest"

import { runWorkerPool } from "../../../src/modules/coordinator/worker-pool.js"

describe("runWorkerPool", () => {
  it("limits concurrent workers while preserving input order", async () => {
    let active = 0
    let peak = 0
    const results = await runWorkerPool({
      tasks: [
        { name: "one", prompt: "one" },
        { name: "two", prompt: "two" },
        { name: "three", prompt: "three" },
      ],
      concurrency: 2,
      runTask: async (task) => {
        active++
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        active--
        return {
          name: task.name,
          status: "success",
          result: task.prompt,
          duration_ms: 0,
        }
      },
      onUnstartedAbort: (task) => ({
        name: task.name,
        status: "aborted",
        result: "",
        duration_ms: 0,
      }),
    })

    expect(peak).toBe(2)
    expect(results.map((result) => result.name)).toEqual(["one", "two", "three"])
  })
})
