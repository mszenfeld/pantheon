declare const TRUNCATION_MARKER = "\n[\u2026truncated\u2026]";
declare const AGGREGATE_TRUNCATION_MARKER = "\n[\u2026truncated: wave output budget reached \u2014 full result is in this task's child session\u2026]";
/**
 * UTF-8-safe byte-bounded truncation with a caller-supplied marker. Slices the
 * underlying bytes at the cap and decodes with `fatal: false` in streaming mode
 * so a partial trailing multi-byte sequence at the cut is dropped rather than
 * rendered as a U+FFFD replacement character. Truncating by UTF-16 code units
 * would both over-count ASCII and silently corrupt multi-byte characters at the
 * cut.
 *
 * `maxBytes` bounds the BODY (the kept prefix), not the marker — the returned
 * string is `body + marker`, so its total byte length is `≤ maxBytes +
 * byteLength(marker)`. A `maxBytes <= 0` yields just the marker (an explicit
 * "nothing fit, see the pointer" signal), which is exactly what the aggregate
 * budget wants once the wave budget is fully spent.
 */
declare function truncateBytesWithMarker(input: string, maxBytes: number, marker: string): string;
/**
 * UTF-8-safe byte-bounded truncation using the per-task `TRUNCATION_MARKER`.
 * Thin wrapper over `truncateBytesWithMarker` so both call sites (`dispatch.ts`
 * and `poller.ts`) apply the exact same per-task truncation policy.
 */
declare function truncateBytes(input: string, maxBytes: number): string;

export { AGGREGATE_TRUNCATION_MARKER, TRUNCATION_MARKER, truncateBytes, truncateBytesWithMarker };
