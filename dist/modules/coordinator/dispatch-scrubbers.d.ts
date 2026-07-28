import { DispatchScrubber, DispatchScrubberFactory, DispatchResult } from './dispatch-types.js';
export { DispatchScrubberSession } from './dispatch-types.js';

declare function createDispatchScrubber(parentSessionID: string | undefined, scrubber: DispatchScrubber | undefined, scrubberFactory: DispatchScrubberFactory | undefined): {
    scrubber: DispatchScrubber | undefined;
    release: () => void;
};
/** Remove internal variant suffixes only from values returned to callers. */
declare function normalizeDispatchResults(results: DispatchResult[]): DispatchResult[];

export { DispatchScrubber, DispatchScrubberFactory, createDispatchScrubber, normalizeDispatchResults };
