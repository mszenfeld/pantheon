import { createOpencodeClient, Message } from '@opencode-ai/sdk';
import { DispatchSpecialist, AgentInfo } from './dispatch.js';
import { PollerMessage } from './poller.js';
import '../_shared/session-agent-registry.js';

/**
 * SDK adapter layer: bridges the strongly-typed OpenCode SDK client into the
 * plain `DispatchSpecialist` / `AgentInfo` shapes that `dispatchParallel`
 * consumes. Extracting this here keeps `index.ts` thin and — crucially — makes
 * the adapter independently unit-testable with a fake `OpencodeClient` (see
 * `tests/sdk-specialist.test.ts`).
 */
type SDKClient = ReturnType<typeof createOpencodeClient>;
declare function createSDKSpecialist(client: SDKClient, parentSessionID: string): DispatchSpecialist;
/**
 * Session-status types that mean "the turn loop is still in flight". The
 * server's status map only ever contains non-idle sessions, so this set is
 * matched against present entries; `"running"` is not emitted by the current
 * SDK but is included for forward compatibility (mirrors oh-my-openagent's
 * `ACTIVE_SESSION_STATUSES`).
 */
declare const ACTIVE_SESSION_STATUS_TYPES: ReadonlySet<string>;
declare function toPollerMessage(raw: {
    info: Message;
    parts: Array<{
        type: string;
        text?: string;
        metadata?: Record<string, unknown>;
    }>;
}): PollerMessage;
/**
 * TTL for the agent-registry cache (60 s). The registry only changes when the
 * OpenCode server reloads plugins, which is rare relative to dispatch volume —
 * but we keep a TTL (rather than caching forever) so a hot-reloaded plugin's
 * new agents are picked up within a minute without restarting the coordinator.
 */
declare const AGENT_REGISTRY_TTL_MS = 60000;
declare function loadAgentRegistry(client: SDKClient): Promise<Record<string, AgentInfo>>;

export { ACTIVE_SESSION_STATUS_TYPES, AGENT_REGISTRY_TTL_MS, type SDKClient, createSDKSpecialist, loadAgentRegistry, toPollerMessage };
