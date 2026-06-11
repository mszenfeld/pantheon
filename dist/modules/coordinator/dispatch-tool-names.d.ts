declare const DISPATCH_TOOL_NAMES: readonly ["dispatch_parallel", "dispatch_background", "poll_background", "wait_background"];
type DispatchToolName = (typeof DISPATCH_TOOL_NAMES)[number];

export { DISPATCH_TOOL_NAMES, type DispatchToolName };
