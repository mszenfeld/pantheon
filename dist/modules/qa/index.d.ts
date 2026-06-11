import { Plugin } from '@opencode-ai/plugin';
export { buildQATesterAgent } from './prompt-builder.js';
export { BE_TOOLS, FE_TOOLS, SETUP_TOOLS, SHARED_TOOLS, toolsForVariant } from './allowed-tools.js';

declare const VARIANTS: readonly ["fe", "be", "setup"];
declare const AppVerkQAPlugin: Plugin;

export { AppVerkQAPlugin, VARIANTS, AppVerkQAPlugin as default };
