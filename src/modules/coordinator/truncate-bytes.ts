export const TRUNCATION_MARKER = "\n[…truncated…]"

// Marker appended when a successful result body is trimmed by the whole-wave
// aggregate budget (NOT the per-task cap). It is deliberately distinct from
// `TRUNCATION_MARKER` so the coordinator can tell "this task itself blew the
// 100KB per-task cap" apart from "this task lost room because earlier tasks in
// the same wave already spent the wave budget" — and, crucially, it points the
// reader at the child session for the full output rather than implying the
// tail is simply gone.
export const AGGREGATE_TRUNCATION_MARKER =
  "\n[…truncated: wave output budget reached — full result is in this task's child session…]"

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
export function truncateBytesWithMarker(
  input: string,
  maxBytes: number,
  marker: string,
): string {
  const buf = Buffer.from(input, "utf8")
  if (maxBytes > 0 && buf.byteLength <= maxBytes) {
    return input
  }
  const sliced = buf.subarray(0, Math.max(maxBytes, 0))
  // Decode in streaming mode so an incomplete trailing multi-byte sequence at
  // the cut boundary is buffered (and, since we never flush, dropped) rather
  // than emitted as a U+FFFD replacement character. A non-streaming decode
  // treats the slice as a complete unit and would replace the partial trailing
  // bytes with U+FFFD, corrupting the output.
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced, {
    stream: true,
  })
  return decoded + marker
}

/**
 * UTF-8-safe byte-bounded truncation using the per-task `TRUNCATION_MARKER`.
 * Thin wrapper over `truncateBytesWithMarker` so both call sites (`dispatch.ts`
 * and `poller.ts`) apply the exact same per-task truncation policy.
 */
export function truncateBytes(input: string, maxBytes: number): string {
  return truncateBytesWithMarker(input, maxBytes, TRUNCATION_MARKER)
}
