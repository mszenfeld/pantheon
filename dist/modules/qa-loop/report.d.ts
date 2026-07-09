import { Sidecar } from './types.js';

/**
 * §5 report renderer — the SINGLE deterministic writer of the report markdown: Status · Issues Found ·
 * All Scenarios · Loop History · Coverage · the qa_loop_undo recovery line. A pure render of the
 * sidecar (no I/O); the tool persists the returned string.
 */
declare function renderReport(s: Sidecar): string;

export { renderReport };
