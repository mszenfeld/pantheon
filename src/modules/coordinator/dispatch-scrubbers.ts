import { normalizeVariantSuffix } from "../_shared/sanitize.js"

import type { DispatchResult } from "./worker-pool.js"

export interface DispatchScrubberSession {
  scrub: (text: string) => string
  release: () => void
}

export type DispatchScrubber = (text: string, parentSessionID: string) => string
export type DispatchScrubberFactory = (
  parentSessionID: string,
) => DispatchScrubberSession | undefined

export function createDispatchScrubber(
  parentSessionID: string | undefined,
  scrubber: DispatchScrubber | undefined,
  scrubberFactory: DispatchScrubberFactory | undefined,
): { scrubber: DispatchScrubber | undefined; release: () => void } {
  if (scrubberFactory === undefined || parentSessionID === undefined || parentSessionID.length === 0) {
    return { scrubber, release: (): void => undefined }
  }
  try {
    const session = scrubberFactory(parentSessionID)
    if (session === undefined) return { scrubber, release: (): void => undefined }
    return {
      scrubber: (text: string): string => session.scrub(text),
      release: (): void => {
        try {
          session.release()
        } catch {
          // Release is best-effort plugin cleanup.
        }
      },
    }
  } catch {
    return { scrubber, release: (): void => undefined }
  }
}

/** Remove internal variant suffixes only from values returned to callers. */
export function normalizeDispatchResults(results: DispatchResult[]): DispatchResult[] {
  for (const result of results) {
    result.name = normalizeVariantSuffix(result.name)
    if (result.error !== undefined) {
      result.error = normalizeVariantSuffix(result.error)
    }
  }
  return results
}
