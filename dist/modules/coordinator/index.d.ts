import { Plugin } from '@opencode-ai/plugin';
export { deriveReportPath, neutralizeUntrustedOutput, normalizeVariantSuffix } from '../_shared/sanitize.js';
export { createSDKSpecialist, loadAgentRegistry, toPollerMessage } from './sdk-specialist.js';
export { DISPATCH_TOOL_NAMES } from './dispatch-tool-names.js';
import '@opencode-ai/sdk';
import './dispatch-types.js';
import './worker-pool.js';
import '../_shared/session-agent-registry.js';
import './poller.js';

/**
 * Tools owned by other modules that Perun may declare in its `allowed-tools`
 * frontmatter. These are deliberately separate from `PERUN_TOOLS`: listing one
 * here documents the cross-module grant without registering a duplicate tool.
 */
declare const PERUN_CROSS_MODULE_TOOLS: readonly ["av_commit", "prepare_perun_commit_scope", "authorize_perun_commit_scope"];
/**
 * Coordinator-provided tools that MUST appear in perun.md's `allowed-tools`
 * frontmatter. Kept as an exported constant so a test can enforce the sync that
 * is otherwise manual (there is no programmatic link between tool registration
 * and the agent frontmatter).
 */
declare const PERUN_TOOLS: readonly ["dispatch_parallel", "assign_issue_ids", "compute_waves", "classify_feature_manifest", "get_planning_artifact_digest", "approve_planning_artifact", "read_verified_planning_artifact", "dispatch_background", "poll_background", "wait_background", "qa_loop_start", "qa_loop_ingest", "qa_loop_step", "qa_loop_record_fix", "qa_loop_finalize", "qa_loop_undo"];
declare const AppVerkCoordinatorPlugin: Plugin;

export { AppVerkCoordinatorPlugin, PERUN_CROSS_MODULE_TOOLS, PERUN_TOOLS };
