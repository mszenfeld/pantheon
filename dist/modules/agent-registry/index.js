export * from "./agent-metadata.js";
import {
  PERUN_PLACEHOLDERS,
  buildDelegationTable,
  buildDispatchableAllowlistSentence,
  buildKeyTriggersSection,
  buildPerunPrompt,
  buildSpecialistsTable,
  buildUseAvoidSection,
  buildWorkflowContribution
} from "./perun-prompt-builder.js";
const registry = [];
let frozen = false;
function registerAgentMetadata(info) {
  const existing = registry.find((a) => a.name === info.name);
  if (existing === void 0 && frozen) {
    throw new Error(
      `Late agent registration after Perun prompt snapshot: ${info.name}. Every agent-registering module must appear BEFORE AppVerkCoordinatorPlugin in defaultPluginFactories (src/index.ts) so it is in the registry when getPerunPrompt() snapshots it.`
    );
  }
  if (existing !== void 0) {
    if (JSON.stringify(existing) === JSON.stringify(info)) return;
    throw new Error(`Duplicate agent metadata: ${info.name}`);
  }
  registry.push(info);
}
function getAgentMetadataRegistry() {
  return [...registry].sort((a, b) => a.name.localeCompare(b.name));
}
function snapshotAgentMetadataRegistry() {
  frozen = true;
  return getAgentMetadataRegistry();
}
function clearAgentMetadataRegistry() {
  registry.length = 0;
  frozen = false;
}
export {
  PERUN_PLACEHOLDERS,
  buildDelegationTable,
  buildDispatchableAllowlistSentence,
  buildKeyTriggersSection,
  buildPerunPrompt,
  buildSpecialistsTable,
  buildUseAvoidSection,
  buildWorkflowContribution,
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
  registerAgentMetadata,
  snapshotAgentMetadataRegistry
};
