import { Plugin } from '@opencode-ai/plugin';
export { QaLoopState } from './sidecar.js';
export { makeQaLoopTools } from './tools.js';
import './types.js';
import 'zod/v4/core';
import 'zod';
import '../qa/caller-gate.js';
import '../_shared/session-agent-registry.js';

declare const QA_LOOP_TOOL_NAMES: readonly ["qa_loop_start", "qa_loop_ingest", "qa_loop_step", "qa_loop_record_fix", "qa_loop_finalize", "qa_loop_undo"];
declare const AppVerkQaLoopPlugin: Plugin;

export { AppVerkQaLoopPlugin, QA_LOOP_TOOL_NAMES, AppVerkQaLoopPlugin as default };
