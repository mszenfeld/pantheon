const TRUNCATION_MARKER = "\n[\u2026truncated\u2026]";
const AGGREGATE_TRUNCATION_MARKER = "\n[\u2026truncated: wave output budget reached \u2014 full result is in this task's child session\u2026]";
function truncateBytesWithMarker(input, maxBytes, marker) {
  const buf = Buffer.from(input, "utf8");
  if (maxBytes > 0 && buf.byteLength <= maxBytes) {
    return input;
  }
  const sliced = buf.subarray(0, Math.max(maxBytes, 0));
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced, {
    stream: true
  });
  return decoded + marker;
}
function truncateBytes(input, maxBytes) {
  return truncateBytesWithMarker(input, maxBytes, TRUNCATION_MARKER);
}
export {
  AGGREGATE_TRUNCATION_MARKER,
  TRUNCATION_MARKER,
  truncateBytes,
  truncateBytesWithMarker
};
