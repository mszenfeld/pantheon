import { normalizeVariantSuffix } from "../_shared/sanitize.js";
function createDispatchScrubber(parentSessionID, scrubber, scrubberFactory) {
  if (scrubberFactory === void 0 || parentSessionID === void 0 || parentSessionID.length === 0) {
    return { scrubber, release: () => void 0 };
  }
  try {
    const session = scrubberFactory(parentSessionID);
    if (session === void 0) return { scrubber, release: () => void 0 };
    return {
      scrubber: (text) => session.scrub(text),
      release: () => {
        try {
          session.release();
        } catch {
        }
      }
    };
  } catch {
    return { scrubber, release: () => void 0 };
  }
}
function normalizeDispatchResults(results) {
  for (const result of results) {
    result.name = normalizeVariantSuffix(result.name);
    if (result.error !== void 0) {
      result.error = normalizeVariantSuffix(result.error);
    }
  }
  return results;
}
export {
  createDispatchScrubber,
  normalizeDispatchResults
};
