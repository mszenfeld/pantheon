import { tool } from "@opencode-ai/plugin";
import { DISPATCH_TOOL_NAMES } from "./dispatch-tool-names.js";
import {
  authorizeDispatchCaller,
  dispatchParallel,
  DISPATCHABLE_ALL_AGENTS
} from "./dispatch.js";
import { sanitizeTaskMetadata } from "./task-builder.js";
import { assignIssueIds } from "./assign-issue-ids.js";
import { computeWaves } from "./compute-waves.js";
import { getPlanningArtifactDigest } from "./artifact-digest.js";
import { approvePlanningArtifact } from "./artifact-approval.js";
import { readVerifiedPlanningArtifact } from "./artifact-read.js";
import {
  execFileGitRunner,
  isGitRunner,
  validateAndClassify
} from "./feature-manifest.js";
import {
  neutralizeUntrustedOutput,
  deriveReportPath,
  normalizeVariantSuffix
} from "../_shared/sanitize.js";
import {
  createSDKSpecialist,
  loadAgentRegistry,
  toPollerMessage
} from "./sdk-specialist.js";
import { getLoadErrors, pantheonConfigEmpty } from "../pantheon-config/index.js";
import { loadModuleAsset } from "../_shared/load-asset.js";
import {
  applyModelOverride,
  captureUserModels,
  getUnknownAgentDiagnostics
} from "../_shared/apply-model-override.js";
import {
  buildDispatchableAllowlistSentence,
  buildPerunPrompt,
  snapshotAgentMetadataRegistry
} from "../agent-registry/index.js";
import { getDispatchExtensions } from "../_shared/dispatch-extensions.js";
import {
  COORDINATOR_AGENT,
  getDefaultAgent,
  setDefaultAgent
} from "../agent-roster/index.js";
import { BackgroundTaskStore } from "./background-store.js";
import { collectBackground, startBackgroundTask } from "./background.js";
import { DISPATCH_TOOL_NAMES as DISPATCH_TOOL_NAMES2 } from "./dispatch-tool-names.js";
function loadAgentPrompt(name) {
  return loadModuleAsset(import.meta.url, `../../agents/${name}.md`);
}
function getFeatureManifestGitRunner(input) {
  if (typeof input !== "object" || input === null) return execFileGitRunner;
  try {
    const candidate = Reflect.get(input, "featureManifestGitRunner");
    return isGitRunner(candidate) ? candidate : execFileGitRunner;
  } catch {
    return execFileGitRunner;
  }
}
const PERUN_TOOLS = [
  "dispatch_parallel",
  "assign_issue_ids",
  "compute_waves",
  "classify_feature_manifest",
  "get_planning_artifact_digest",
  "approve_planning_artifact",
  "read_verified_planning_artifact",
  "dispatch_background",
  "poll_background",
  "wait_background",
  "qa_loop_start",
  "qa_loop_ingest",
  "qa_loop_step",
  "qa_loop_record_fix",
  "qa_loop_finalize",
  "qa_loop_undo"
];
const _dispatchToolNamesAreInPerunTools = DISPATCH_TOOL_NAMES;
void _dispatchToolNamesAreInPerunTools;
const DISPATCHABLE_ALLOWLIST_NAMES = [
  ...DISPATCHABLE_ALL_AGENTS
].sort((a, b) => a.localeCompare(b));
let cachedPerunPrompt;
function getPerunPrompt() {
  if (cachedPerunPrompt === void 0) {
    const template = loadAgentPrompt("perun");
    cachedPerunPrompt = buildPerunPrompt(
      template,
      snapshotAgentMetadataRegistry(),
      {
        dispatchableAllowlist: DISPATCHABLE_ALLOWLIST_NAMES
      }
    );
  }
  return cachedPerunPrompt;
}
const AppVerkCoordinatorPlugin = async (input) => {
  const { client } = input;
  const featureManifestGitRunner = getFeatureManifestGitRunner(input);
  let toastShown = false;
  const backgroundStore = new BackgroundTaskStore();
  const dispatchableAllowlistSentence = buildDispatchableAllowlistSentence(
    DISPATCHABLE_ALLOWLIST_NAMES
  );
  const dispatchParallelTool = tool({
    description: [
      "Dispatch tasks to specialist agents in parallel. Returns results in the same order as the input tasks. Use this instead of calling Task directly to guarantee parallelism and deterministic ordering.",
      "",
      "Guarantees and limits:",
      "- Maximum 4 tasks per call (aligned with the worker pool size; over-limit calls are rejected before any session is created). For larger workloads, chunk into multiple sequential dispatch_parallel calls.",
      "- A 4-worker pool runs every task in this call in parallel. `tasks.length \u2264 4` is enforced, so concurrency equals the call size. Result order is preserved.",
      '- Each task has a hard timeout (5 minutes for most agents; the planner Veles gets a longer budget because it authors and self-verifies plans). On expiry the task is returned with status "timeout" and the partial result is discarded.',
      '- Each successful result is truncated at 100KB (UTF-8 bytes). Truncated results end with the marker "[\u2026truncated\u2026]" \u2014 synthesize what is present, do not retry.',
      "- A second, whole-wave aggregate cap (~128KB total across all successful results in this call) is applied on top of the per-task cap so one call can never flood the context. When a wave exceeds it, later results (in input order) are trimmed and end with a marker pointing to that task's child session for the full output \u2014 read the child session if you need the omitted tail; do not retry.",
      "- Anti-recursion pre-flight: every task is validated against the live agent registry BEFORE any session is created. Tasks targeting an unknown agent or a `mode: primary` agent are rejected. A `mode: all` agent is rejected UNLESS it is on the dispatch allowlist AND the caller is a primary agent; this lets the coordinator dispatch the planner while blocking self/nested recursion. " + dispatchableAllowlistSentence + " Rejections throw and dispatch nothing.",
      "- Specialist output is treated as untrusted data: ANSI/control characters are stripped and HTML-like substrings are escaped before the result is returned.",
      '- Honors `ToolContext.abort`: when the parent session aborts, in-flight tasks terminate within ~one poll-interval with status "aborted" and the child session is cancelled server-side (best-effort).',
      '- Result shape: each entry has `{ name, status: "success" | "error" | "timeout" | "aborted", result, duration_ms, error?, sessionId? }`, in the same order as the input `tasks` array.'
    ].join("\n"),
    args: {
      // `agent` + `summary` are both REQUIRED, primitive top-level args.
      // The OpenCode TUI's GenericTool renderer (the path used for every
      // plugin-supplied tool) shows `{tool} {input(input)}`, where the
      // `input()` helper formats only primitive top-level args. `tasks` is
      // an array, so without these two strings the call line collapses to a
      // bare `dispatch_parallel`. Splitting into `agent` and `summary` lets
      // reviewers see "who" and "what" as two distinct columns inline.
      agent: tool.schema.string().min(1).max(60).describe(
        'REQUIRED. Display label for the dispatched agent(s). Free-form, but follow this convention so reviewers can scan the TUI line:\n- single agent: bare name (e.g. "code-reviewer")\n- N copies of one agent (2 \u2264 N \u2264 4): "name \xD7N" (e.g. "code-reviewer \xD73", "code-reviewer \xD74"). N == 1 uses the bare name. N is capped at 4 \u2014 the per-call task limit; chunk larger workloads into multiple sequential calls.\n- different agents: comma-joined names (e.g. "code-reviewer, security-auditor")\n- mixed + duplicates: combine the two (e.g. "code-reviewer \xD72, security-auditor")\nHard cap 60 chars. Do not include prompts, goals, or PII \u2014 `summary` is the place for that.\n\nException for logical agents with multiple variants: when a logical agent is implemented as multiple registered names (e.g. `zmora` \u2192 `zmora-fe` + `zmora-be`), use the logical name in `agent`, not the variant names. Document the mapping in the dispatching agent\'s prompt.'
      ),
      summary: tool.schema.string().min(1).max(80).describe(
        'REQUIRED. One-line description of what is being delegated (e.g. "run login plan", "security/perf/quality review of PR #123", "QA-003 missing CSRF token"). Rendered next to `agent` in the OpenCode TUI. Hard cap 80 chars; do not include prompts or PII.'
      ),
      tasks: tool.schema.array(
        tool.schema.object({
          name: tool.schema.string().describe("Specialist agent name"),
          prompt: tool.schema.string().describe("Prompt for the specialist"),
          context: tool.schema.string().optional().describe("Optional extra context appended to the prompt"),
          executionContext: tool.schema.literal("perun-headless").optional().describe("Marks the dispatched child as a headless Perun session.")
        })
      ).describe("Array of tasks to dispatch in parallel")
    },
    async execute(args, context) {
      context.metadata({
        title: neutralizeUntrustedOutput(`${args.agent} \u2014 ${args.summary}`),
        metadata: {
          tasks: sanitizeTaskMetadata(args.tasks)
        }
      });
      if (context.sessionID.length === 0) {
        throw new Error(
          "dispatch_parallel: missing context.sessionID \u2014 cannot parent child sessions"
        );
      }
      authorizeDispatchCaller(context.agent, args.tasks.map((task) => task.name));
      const specialist = createSDKSpecialist(client, context.sessionID);
      const agentRegistry = await loadAgentRegistry(client);
      const callerMode = agentRegistry[context.agent]?.mode;
      const ext = getDispatchExtensions();
      const results = await dispatchParallel({
        tasks: args.tasks,
        agentRegistry,
        specialist,
        callerMode,
        // Thread the harness abort signal end-to-end: poller checks it at each
        // iteration and during the inter-poll sleep, and child sessions are
        // cancelled server-side when it fires.
        signal: context.abort,
        parentSessionID: context.sessionID,
        sessionAgentRegistry: ext.sessionAgentRegistry,
        scrubber: ext.scrubber,
        scrubberFactory: ext.scrubberFactory,
        preflight: ext.preflight
      });
      return JSON.stringify(results);
    }
  });
  const assignIssueIdsTool = tool({
    description: [
      "Assign deterministic zero-padded IDs to a list of findings (QA-001, QA-002, ...). Use this instead of mentally tracking issue counters.",
      "",
      "Guarantees:",
      "- IDs are zero-padded to a minimum of 3 digits (e.g. `<PREFIX>-001`, `<PREFIX>-042`, `<PREFIX>-123`). Counters above 999 widen automatically (`<PREFIX>-1000`).",
      "- IDs are assigned in the order findings appear in the input array \u2014 the caller is responsible for sorting (e.g. by severity) BEFORE calling this tool.",
      "- Output preserves every input field and adds an `id` property; findings are not deduplicated, reordered, or filtered.",
      "- `startAt` (default 1) lets you continue numbering across multiple reports without collisions."
    ].join("\n"),
    args: {
      findings: tool.schema.array(
        tool.schema.object({
          severity: tool.schema.string(),
          title: tool.schema.string()
        }).passthrough()
      ).describe("Findings to assign IDs to"),
      prefix: tool.schema.string().describe('ID prefix, e.g. "QA"'),
      startAt: tool.schema.number().optional().describe("Starting number (default 1)")
    },
    async execute(args) {
      const result = assignIssueIds({
        findings: args.findings,
        prefix: args.prefix,
        startAt: args.startAt
      });
      return JSON.stringify(result, null, 2);
    }
  });
  const computeWavesTool = tool({
    description: [
      "Compute dependency-aware dispatch waves from a flat scenario list (Kahn's topological sort). Use this when a QA plan declares `**Depends-on:**` between scenarios \u2014 call BEFORE `dispatch_parallel` to decide what to run when.",
      "",
      "Inputs:",
      '- `scenarios`: array of `{ id: string, dependsOn: string[], sourceOrder: number }`. `id` is the scenario heading (e.g. "BE-02"), `dependsOn` is the parsed `**Depends-on:**` list (empty array if absent), `sourceOrder` is the scenario\'s position in the plan (used as the tie-breaker within a wave).',
      "",
      "Output (JSON-stringified):",
      "- `{ waves: string[][] }` on success. `waves[0]` is the first dispatch wave; within each wave the IDs are emitted in source order.",
      '- `{ waves: [], error: { kind, details } }` on validation failure. `kind` is one of `"self-ref"`, `"dangling"`, `"cycle"`. The caller (Perun) MUST NOT call `dispatch_parallel` when `error` is present \u2014 surface `details` verbatim to the user and abort the run.',
      "- Empty input returns `{ waves: [] }` with no error.",
      "",
      "Guarantees:",
      "- Deterministic: same input \u2192 same output. Within a wave, source order is the tie-breaker.",
      "- Pure: no I/O, no globals, no clock dependence."
    ].join("\n"),
    args: {
      scenarios: tool.schema.array(
        tool.schema.object({
          id: tool.schema.string().describe('Scenario id, e.g. "BE-02"'),
          dependsOn: tool.schema.array(tool.schema.string()).describe(
            "Scenario ids this scenario depends on (empty array if none)"
          ),
          sourceOrder: tool.schema.number().describe(
            "Scenario position in the plan (used as tie-breaker within a wave)"
          )
        })
      ).describe("Flat scenario list with parsed dependencies")
    },
    async execute(args) {
      const result = computeWaves(args.scenarios);
      return JSON.stringify(result, null, 2);
    }
  });
  const classifyFeatureManifestTool = tool({
    description: [
      "Validate a Triglav change manifest against Git's authoritative changed-file list and select Stribog, Svarog, or Veles.",
      'Coordinator-only: callers other than Perun receive `{ status: "forbidden", reason }`.',
      "Git failures, an empty diff, malformed manifests, and any uncertain or sensitive route conservatively select Veles."
    ].join("\n"),
    args: {
      result: tool.schema.string().describe("Full Triglav result containing CHANGE_MANIFEST_V1 and its JSON block."),
      base: tool.schema.string().optional().describe("Optional branch name or SHA to validate with Git before diffing against HEAD."),
      userRequestedPlanning: tool.schema.boolean().optional().describe("When true, route unconditionally to Veles for planning.")
    },
    async execute(args, context) {
      if (context.agent !== COORDINATOR_AGENT) {
        return JSON.stringify({
          status: "forbidden",
          reason: "classify_feature_manifest is restricted to the coordinator (Perun)"
        });
      }
      return JSON.stringify(
        await validateAndClassify(args.result, {
          gitRunner: featureManifestGitRunner,
          base: args.base,
          userRequestedPlanning: args.userRequestedPlanning
        })
      );
    }
  });
  const getPlanningArtifactDigestTool = tool({
    description: [
      "Return the SHA-256 digest of a planning artifact's canonical representation.",
      "The artifact must be a regular, non-symlinked file under docs/specs/ or docs/plans/. Frontmatter is parsed strictly; mutable approval fields are excluded from the digest.",
      'Coordinator-only: callers other than Perun receive `{ status: "forbidden", reason }`.'
    ].join("\n"),
    args: {
      path: tool.schema.string().describe("Repo-relative path under docs/specs/ or docs/plans/.")
    },
    async execute(args, context) {
      if (context.agent !== COORDINATOR_AGENT) {
        return JSON.stringify({
          status: "forbidden",
          reason: "get_planning_artifact_digest is restricted to the coordinator (Perun)"
        });
      }
      return JSON.stringify(getPlanningArtifactDigest(args.path));
    }
  });
  const approvePlanningArtifactTool = tool({
    description: [
      "Approve a planning artifact and write its immutable verification sidecar.",
      "The artifact must be a regular, non-symlinked file under docs/specs/ or docs/plans/. The pre-approval digest must match the artifact's current canonical digest; on mismatch the approval is rejected so the coordinator can re-inspect.",
      'Coordinator-only: callers other than Perun receive `{ status: "forbidden", reason }`.'
    ].join("\n"),
    args: {
      path: tool.schema.string().describe("Repo-relative path under docs/specs/ or docs/plans/."),
      pre_approval_digest: tool.schema.string().describe("SHA-256 canonical digest the artifact must match for approval to proceed.")
    },
    async execute(args, context) {
      if (context.agent !== COORDINATOR_AGENT) {
        return JSON.stringify({
          status: "forbidden",
          reason: "approve_planning_artifact is restricted to the coordinator (Perun)"
        });
      }
      return JSON.stringify(
        await approvePlanningArtifact(args.path, args.pre_approval_digest, context.sessionID)
      );
    }
  });
  const readVerifiedPlanningArtifactTool = tool({
    description: [
      "Read a planning artifact only after verifying its canonical digest against its approval sidecar.",
      "The artifact must be a regular, non-symlinked file under docs/specs/ or docs/plans/. The verified content snapshot closes the verification-to-execution TOCTOU window.",
      'Coordinator-only: callers other than Perun receive `{ status: "forbidden", reason }`.'
    ].join("\n"),
    args: {
      path: tool.schema.string().describe("Repo-relative path under docs/specs/ or docs/plans/.")
    },
    async execute(args, context) {
      if (context.agent !== COORDINATOR_AGENT) {
        return JSON.stringify({
          status: "forbidden",
          reason: "read_verified_planning_artifact is restricted to the coordinator (Perun)"
        });
      }
      return JSON.stringify(readVerifiedPlanningArtifact(args.path));
    }
  });
  const dispatchBackgroundTool = tool({
    description: [
      "Start a specialist task in the BACKGROUND and return immediately with a task id (bg_...). The task runs while you do other work in THIS turn; collect it later with wait_background / poll_background.",
      "",
      "- Single task per call. Max 4 background tasks running per session \u2014 collect one before firing more.",
      "- Use for read-only work you can overlap with your own (especially `triglav` exploration). Use blocking `dispatch_parallel` when you need the result immediately or need ordered QA waves.",
      "- ALWAYS collect (wait_background/poll_background) what you start before ending the turn \u2014 uncollected tasks are wasted.",
      '- Returns: { id, agent, status: "running" }.'
    ].join("\n"),
    args: {
      agent: tool.schema.string().min(1).max(60).describe(
        'Specialist agent name (e.g. "triglav"). Must be a subagent, or an allowlisted mode:all agent when the caller is a primary agent. ' + dispatchableAllowlistSentence
      ),
      summary: tool.schema.string().min(1).max(80).describe("One-line label for the TUI (no prompts/PII)."),
      prompt: tool.schema.string().describe("Prompt for the specialist."),
      context: tool.schema.string().optional().describe("Optional extra context appended to the prompt."),
      executionContext: tool.schema.literal("perun-headless").optional().describe("Marks the dispatched child as a headless Perun session.")
    },
    async execute(args, context) {
      context.metadata({ title: neutralizeUntrustedOutput(`${args.agent} \u2014 ${args.summary}`) });
      if (context.sessionID.length === 0) {
        throw new Error("dispatch_background: missing context.sessionID");
      }
      authorizeDispatchCaller(context.agent, [args.agent]);
      const specialist = createSDKSpecialist(client, context.sessionID);
      const agentRegistry = await loadAgentRegistry(client);
      const callerMode = agentRegistry[context.agent]?.mode;
      const ext = getDispatchExtensions();
      const result = await startBackgroundTask({
        store: backgroundStore,
        specialist,
        agentRegistry,
        callerMode,
        parentSessionId: context.sessionID,
        agent: args.agent,
        prompt: args.prompt,
        context: args.context,
        executionContext: args.executionContext,
        sessionAgentRegistry: ext.sessionAgentRegistry
      });
      return JSON.stringify(result, null, 2);
    }
  });
  const pollBackgroundTool = tool({
    description: [
      "Check the status of background tasks WITHOUT blocking. Returns a snapshot per id.",
      '- Result per id: { id, agent, status: "running" | "success" | "not_found", result?, duration_ms? }.',
      '- A "success" result is one-time retrieval: the task is collected and its slot freed, exactly like wait_background. Do NOT poll the same id again after success (it returns not_found).',
      '- A "running" result is non-terminal: keep working, then poll/wait again.',
      "- Use to decide whether to keep working or to wait_background."
    ].join("\n"),
    args: {
      ids: tool.schema.array(tool.schema.string()).describe("Background task ids (bg_...) to check.")
    },
    async execute(args, context) {
      context.metadata({ title: `poll ${args.ids.length} task(s)` });
      const specialist = createSDKSpecialist(client, context.sessionID);
      const ext = getDispatchExtensions();
      const results = await collectBackground({
        store: backgroundStore,
        specialist,
        ids: args.ids,
        block: false,
        // Route background results through the QA secret scrubber. The plugin
        // registers only `scrubberFactory` (legacy `scrubber` is permanently
        // undefined), so passing `scrubber: ext.scrubber` alone silently
        // skipped scrubbing entirely. `collectBackground` snapshot-pins the
        // factory per poll and prefers it over the legacy field.
        scrubber: ext.scrubber,
        scrubberFactory: ext.scrubberFactory,
        parentSessionId: context.sessionID
      });
      return JSON.stringify(results, null, 2);
    }
  });
  const waitBackgroundTool = tool({
    description: [
      "BLOCK until the given background tasks are idle (or time out), then return their results. Collected tasks are removed (one-time retrieval), freeing background slots.",
      '- Result per id: { id, agent, status: "success" | "error" | "timeout" | "aborted" | "not_found", result, duration_ms, error? }.',
      "- Honors abort: aborting cancels the wait AND kills the waited child sessions."
    ].join("\n"),
    args: {
      ids: tool.schema.array(tool.schema.string()).describe("Background task ids (bg_...) to wait for."),
      timeoutMs: tool.schema.number().optional().describe("Per-task timeout in ms (default 5 min).")
    },
    async execute(args, context) {
      context.metadata({ title: `wait ${args.ids.length} task(s)` });
      const specialist = createSDKSpecialist(client, context.sessionID);
      const ext = getDispatchExtensions();
      const results = await collectBackground({
        store: backgroundStore,
        specialist,
        ids: args.ids,
        block: true,
        timeoutMs: args.timeoutMs,
        signal: context.abort,
        // Same fix as poll_background: thread the factory so background results
        // actually pass through `scrubSecrets`. See the poll_background comment.
        scrubber: ext.scrubber,
        scrubberFactory: ext.scrubberFactory,
        parentSessionId: context.sessionID
      });
      return JSON.stringify(results, null, 2);
    }
  });
  return {
    config: async (config) => {
      config.agent = config.agent ?? {};
      const userModels = captureUserModels(config, COORDINATOR_AGENT);
      config.agent[COORDINATOR_AGENT] = {
        description: "Delegates work to specialists, synthesizes results, proposes next steps",
        mode: "primary",
        get prompt() {
          return getPerunPrompt();
        },
        // Partial override: OpenCode merges this dict over the default toolset,
        // so unlisted tools stay enabled — this disables ONLY these two and
        // leaves Perun's other tools intact. The coordinator orchestrates; it
        // must not load skills itself.
        // `skill: false` is a REAL backstop for the NATIVE `skill` tool on the
        // installed opencode 1.15.x runtime (verified in Task 1a): the runtime's
        // permission engine is string-keyed/PermissionV2, so the v1-SDK type
        // lacking a `skill` key is cosmetic — `skill: false` filters the tool out
        // of the toolset AND denies it at execute time.
        // `load_appverk_skill` is a PLUGIN tool, NOT native — its deny here is on
        // the INERT plugin-tool-map path (see AGENTS.md "Plugin-tool enforcement
        // model"), so this line does not actually prevent Perun loading skills.
        // Tracked follow-up: enforce it in skill-registry. Kept as declarative
        // defense-in-depth.
        tools: { skill: false, load_appverk_skill: false }
      };
      applyModelOverride(
        config,
        "perun",
        COORDINATOR_AGENT,
        void 0,
        userModels
      );
      if (getDefaultAgent(config) === void 0) {
        setDefaultAgent(config, COORDINATOR_AGENT);
      }
    },
    // IMPORTANT: Tool names here must exactly match the `allowed-tools` frontmatter in
    // `src/agents/perun.md`. The exported `PERUN_TOOLS` constant lists them and
    // `tests/modules/coordinator/perun-tools-sync.test.ts` enforces the match. If you
    // rename/add a tool, update PERUN_TOOLS + perun.md too — there is no programmatic link.
    tool: {
      dispatch_parallel: dispatchParallelTool,
      assign_issue_ids: assignIssueIdsTool,
      compute_waves: computeWavesTool,
      classify_feature_manifest: classifyFeatureManifestTool,
      get_planning_artifact_digest: getPlanningArtifactDigestTool,
      approve_planning_artifact: approvePlanningArtifactTool,
      read_verified_planning_artifact: readVerifiedPlanningArtifactTool,
      dispatch_background: dispatchBackgroundTool,
      poll_background: pollBackgroundTool,
      wait_background: waitBackgroundTool
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const deletedID = event.properties?.info?.id;
        if (typeof deletedID === "string" && deletedID.length > 0) {
          for (const t of backgroundStore.listByParent(deletedID)) {
            try {
              await createSDKSpecialist(client, deletedID).abortTask(
                t.childSessionId
              );
            } catch {
            }
          }
          backgroundStore.clearParent(deletedID);
          backgroundStore.removeByChild(deletedID);
        }
        return;
      }
      if (event.type !== "session.created") return;
      if (toastShown) return;
      try {
        const errors = [
          ...getLoadErrors(),
          ...getUnknownAgentDiagnostics()
        ].map(neutralizeUntrustedOutput);
        for (const e of errors) console.error(e);
        if (errors.length > 0) {
          await client.tui.showToast({
            body: {
              variant: "warning",
              title: "Pantheon",
              message: errors[0] ?? "pantheon.json parse error \u2014 check console for details"
            }
          });
        } else if (pantheonConfigEmpty()) {
          await client.tui.showToast({
            body: {
              variant: "info",
              title: "Pantheon",
              message: "pantheon.json not found \u2014 using default models"
            }
          });
        }
        toastShown = true;
      } catch {
        toastShown = true;
      }
    }
  };
};
export {
  AppVerkCoordinatorPlugin,
  DISPATCH_TOOL_NAMES2 as DISPATCH_TOOL_NAMES,
  PERUN_TOOLS,
  createSDKSpecialist,
  deriveReportPath,
  loadAgentRegistry,
  neutralizeUntrustedOutput,
  normalizeVariantSuffix,
  toPollerMessage
};
