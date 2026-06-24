import { tool } from "@opencode-ai/plugin";
import { buildQATesterAgent } from "./prompt-builder.js";
import {
  applyModelOverride,
  captureUserModels
} from "../_shared/apply-model-override.js";
import { loadModuleAsset } from "../_shared/load-asset.js";
import { registerDispatchExtensions } from "../_shared/dispatch-extensions.js";
import { registerAgentMetadata } from "../agent-registry/index.js";
import { zmoraSpecialistInfo } from "./zmora.metadata.js";
import { BindingsStore } from "./bindings-store.js";
import { QaRunState } from "./qa-run-state.js";
import { SessionAgentRegistry, makeShellEnvHook } from "./shell-env-hook.js";
import { makeExecuteRecipeHandler } from "./execute-recipe.js";
import { makeRecordInputHandler } from "./record-input.js";
import { makePreflightHandler } from "./preflight.js";
import { parseBindings } from "./binding-parser.js";
import { scrubSecrets } from "./scrubber.js";
import { makeRunBash } from "./run-bash.js";
import { makeCallerGate, SETUP_AGENT_KEY } from "./caller-gate.js";
import {
  FE_TOOLS,
  BE_TOOLS,
  SETUP_TOOLS,
  SHARED_TOOLS,
  toolsForVariant
} from "./allowed-tools.js";
function loadCommandMarkdown(name) {
  return loadModuleAsset(import.meta.url, `../../commands/${name}`);
}
const VARIANTS = ["fe", "be", "setup"];
const TTL_MS = 60 * 60 * 1e3;
const SWEEP_INTERVAL_MS = 5 * 60 * 1e3;
const COMMANDS = [
  {
    name: "qa:create-plan",
    description: "Analyze code changes and generate a detailed QA test plan with FE and BE scenarios.",
    file: "create-qa-plan.md"
  },
  {
    name: "qa:run",
    description: "Execute a QA test plan \u2014 Perun dispatches one zmora variant per scenario through dispatch_parallel.",
    file: "run-qa.md"
  },
  // Deprecated aliases for the pre-namespace command names. These resolve to the
  // SAME asset files as the canonical `qa:*` commands above, so old muscle-memory
  // / saved snippets / scripts (`/create-qa-plan`, `/run-qa`) keep working with a
  // clear "renamed → /qa:*" pointer in the description. Remove in a future minor
  // once the new names have propagated.
  {
    name: "create-qa-plan",
    description: "Deprecated \u2014 renamed to /qa:create-plan. Please use that instead.",
    file: "create-qa-plan.md"
  },
  {
    name: "run-qa",
    description: "Deprecated \u2014 renamed to /qa:run. Please use that instead.",
    file: "run-qa.md"
  }
];
const AppVerkQAPlugin = async ({ client }) => {
  const store = new BindingsStore();
  const state = new QaRunState();
  const registry = new SessionAgentRegistry();
  const gate = makeCallerGate({ registry, setupAgentKey: SETUP_AGENT_KEY });
  const parentIDCache = /* @__PURE__ */ new Map();
  async function resolveParentID(sessionID) {
    const cached = parentIDCache.get(sessionID);
    if (cached !== void 0) return cached;
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      const parentID = result.data?.parentID;
      if (typeof parentID === "string" && parentID.length > 0) {
        parentIDCache.set(sessionID, parentID);
        return parentID;
      }
      return void 0;
    } catch {
      return void 0;
    }
  }
  const recordInputHandler = makeRecordInputHandler({
    store,
    state,
    resolveParentID
  });
  const executeRecipeHandler = makeExecuteRecipeHandler({
    store,
    state,
    resolveParentID,
    // `makeRunBash` owns wall-clock timeout enforcement: AbortController +
    // `spawn`'s `signal` so an over-budget recipe is actually killed
    // (CWE-404). Default timeout (30s) lives in run-bash.ts.
    runBash: makeRunBash(),
    processEnv: process.env
  });
  const preflightHandler = makePreflightHandler({
    store,
    state,
    resolveParentID,
    processEnv: process.env
  });
  const shellEnvHook = makeShellEnvHook({ store, registry, resolveParentID });
  registerDispatchExtensions({
    sessionAgentRegistry: registry,
    scrubberFactory: (parentSessionID) => {
      try {
        const snapshot = store.pinSnapshot(parentSessionID);
        return {
          scrub: (text) => scrubSecrets(text, parentSessionID, store, snapshot),
          release: () => store.releaseSnapshot(snapshot.id)
        };
      } catch {
        return void 0;
      }
    }
  });
  registerAgentMetadata(zmoraSpecialistInfo);
  const sweepTimer = setInterval(() => {
    try {
      store.sweepExpired(Date.now(), TTL_MS);
    } catch {
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  return {
    config: async (config) => {
      config.agent ??= {};
      const userModels = captureUserModels(
        config,
        VARIANTS.map((stack) => `zmora-${stack}`)
      );
      for (const stack of VARIANTS) {
        let cached;
        config.agent[`zmora-${stack}`] = {
          description: `Zmora \u2014 ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`,
          get prompt() {
            cached ??= buildQATesterAgent(stack).prompt;
            return cached;
          },
          mode: "subagent",
          // DECLARATIVE-ONLY defense-in-depth. This plugin-tool map is INERT on
          // opencode 1.15.10 (see AGENTS.md "Plugin-tool enforcement model") — the
          // load-bearing gate is caller-gate.ts at each tool's execute(). Kept so
          // it becomes free enforcement if a future opencode honors the map.
          tools: {
            execute_recipe: stack === "setup",
            record_input: false,
            parse_plan: false,
            preflight: false
          }
        };
      }
      applyModelOverride(
        config,
        "zmora",
        VARIANTS.map((stack) => `zmora-${stack}`),
        void 0,
        userModels
      );
      config.command ??= {};
      for (const c of COMMANDS) {
        let cached;
        config.command[c.name] = {
          description: c.description,
          get template() {
            cached ??= loadCommandMarkdown(c.file);
            return cached;
          }
        };
      }
    },
    tool: {
      // The "resolvable = bound in store OR non-empty in process env; liveness
      // NOT probed" claim restated below for the LLM mirrors the dev-facing
      // JSDoc on `makePreflightHandler` in preflight.ts. Worded separately for
      // two audiences on purpose — keep both in sync if the contract changes.
      preflight: tool({
        description: [
          "Verify that the env-var names a QA plan's `## Setup` declares as required are resolvable for this run, BEFORE dispatching any scenario. Perun-only. Call it after parsing the `## Setup` section and before the first `dispatch_parallel`.",
          "",
          "A name is 'present' if it is bound in the run's bindings store (user-pasted via `record_input`, or minted) OR set to a non-empty value in OpenCode's process env (which dispatched zmora children inherit) \u2014 the same resolution order `execute_recipe` uses for recipe inputs.",
          "",
          'Service / database *liveness* is NOT probed here \u2014 a host that is up now may be down at dispatch, so reachability is verified per-scenario via the `NEED_INFO` backstop (which reports `kind: "service"`). This tool only catches the most common gap: a missing credential / binding input.',
          "",
          "Side effect: registers the passed `env` names as plan-declared for this run, which lets the user paste a credential-prefixed prerequisite (e.g. `SUPABASE_URL`, `DATABASE_URL`) via `record_input` \u2014 names that would otherwise hit the credential-prefix denylist. So call `preflight` with the full Required-env list BEFORE the paste dialog (the documented order), even for names you expect to be missing.",
          "",
          "Result shape (JSON-stringified):",
          '- `{ status: "ok" }` \u2014 every requested name is resolvable; proceed to dispatch.',
          '- `{ status: "missing", missing: string[] }` \u2014 these names are unresolvable; ABORT the dispatch and emit the preflight prompt asking the user to provide them.'
        ].join("\n"),
        args: {
          env: tool.schema.array(tool.schema.string()).describe(
            "Env-var names parsed from the plan's `**Required environment variables:**` bullets (each matching /^[A-Z_][A-Z0-9_]*$/). Pass an empty array if the plan declares none."
          )
        },
        async execute(args, ctx) {
          if (!gate.isCoordinatorCaller(ctx.sessionID)) {
            return JSON.stringify({
              status: "forbidden",
              reason: "preflight is restricted to the coordinator (Perun)"
            });
          }
          const result = await preflightHandler(
            { env: args.env },
            { sessionID: ctx.sessionID }
          );
          return JSON.stringify(result);
        }
      }),
      parse_plan: tool({
        description: [
          "Parse a QA plan's `## Setup` \u2192 `**Bindings:**` subsection into the plugin's per-run state. Perun MUST call this exactly once per QA run, after reading the plan and BEFORE the first `dispatch_parallel` that includes a zmora-setup task. Without this call `execute_recipe` returns `{status:\"unknown_binding\"}` for every recipe.",
          "",
          "The plan text is parsed in-process \u2014 the binding values themselves are NEVER produced here, only the recipe AST. Value materialisation happens later in `execute_recipe`.",
          "",
          "Result shape (JSON-stringified):",
          '- `{ status: "ok", bindings: string[] }` \u2014 bindings stored; `bindings` lists the names parsed (e.g. `["QA_BIND_TOKEN"]`). Empty array means the plan has no `## Setup` / `**Bindings:**` subsection \u2014 Perun should proceed to dispatch without any zmora-setup tasks.',
          '- `{ status: "error", reason }` \u2014 parse/validation failed (invalid binding name, recipe AST rejection, etc.). Surface `reason` to the user verbatim and abort the QA run.',
          "",
          "Idempotent: calling twice with the same plan replaces the stored plan (later wins). Safe to call again on resume."
        ].join("\n"),
        args: {
          plan: tool.schema.string().describe(
            "Full text of the QA plan markdown. Perun passes the contents read via `Read` \u2014 do not summarise or trim."
          )
        },
        async execute(args, ctx) {
          if (!gate.isCoordinatorCaller(ctx.sessionID)) {
            return JSON.stringify({
              status: "forbidden",
              reason: "parse_plan is restricted to the coordinator (Perun)"
            });
          }
          const parentID = await resolveParentID(ctx.sessionID) ?? ctx.sessionID;
          const parsed = parseBindings(args.plan);
          if (parsed.status !== "ok") {
            return JSON.stringify({ status: "error", reason: parsed.reason });
          }
          state.storePlan(parentID, parsed.bindings);
          return JSON.stringify({
            status: "ok",
            bindings: parsed.bindings.map((b) => b.name)
          });
        }
      }),
      execute_recipe: tool({
        description: [
          "Execute a single binding recipe declared in the plan's **Bindings:** section. Atomically: validates recipe AST, runs via bash with composed env (host env + previously-bound inputs), validates output, registers the value in the bindings store. Returns status only \u2014 the value never appears in the LLM context.",
          "",
          "Available only to the dispatched zmora-setup variant \u2014 enforced at execute() by the caller gate (the per-agent AgentConfig tools map is declarative-only on opencode 1.15.10).",
          "",
          "Result shape (JSON-stringified):",
          '- `{ status: "ok" }` \u2014 binding minted and stored.',
          '- `{ status: "need_info", missing: string[] }` \u2014 recipe inputs are not yet bound; Perun must collect them first.',
          '- `{ status: "recipe_failed", reason, stderr_tail }` \u2014 bash exit non-zero, timeout, or output validation failed. `stderr_tail` is scrubbed of secrets and truncated to 200 chars.',
          '- `{ status: "unknown_binding" }` \u2014 `binding_name` is not in the parent run\'s plan.'
        ].join("\n"),
        args: {
          binding_name: tool.schema.string().describe(
            `Name of the binding to provision, e.g. "QA_BIND_TOKEN". Must start with QA_BIND_ and match the plan's **Bindings:** declaration.`
          )
        },
        async execute(args, ctx) {
          if (!gate.isSetupCaller(ctx.sessionID)) {
            return JSON.stringify({
              status: "forbidden",
              reason: "execute_recipe is restricted to the zmora-setup specialist \u2014 only a dispatched zmora-setup task may mint bindings"
            });
          }
          const result = await executeRecipeHandler(
            { binding_name: args.binding_name },
            { sessionID: ctx.sessionID }
          );
          return JSON.stringify(result);
        }
      }),
      record_input: tool({
        description: [
          "Record a user-pasted NAME=value input into the bindings store for use by subsequent execute_recipe calls (as recipe inputs) and Zmora shell invocations (via the shell.env hook). Validates the name (denylist + identifier regex) and value charset.",
          "",
          "Available only to Perun, invoked when parsing user replies during mid-run dialog. The value is stored as type=secret, source=user-paste \u2014 it is scrubbed from any specialist stderr that propagates back through the plugin.",
          "",
          "Result shape (JSON-stringified):",
          '- `{ status: "ok" }` \u2014 recorded (also returned for duplicates, idempotent).',
          '- `{ status: "rejected", reason }` \u2014 name failed denylist/regex check, or value failed charset/length validation.'
        ].join("\n"),
        args: {
          name: tool.schema.string().describe(
            'Env var name (regular identifier, not necessarily QA_BIND_*), e.g. "TEST_USER_EMAIL". Must match /^[A-Z_][A-Z0-9_]*$/ and never a process-control name (PATH, NODE_OPTIONS, ...). Credential-prefixed names (AWS_, SUPABASE_, DATABASE_, ...) are accepted only when the parsed plan declares them as a binding Input; otherwise rejected.'
          ),
          value: tool.schema.string().describe(
            "Value pasted by the user. Stored as type=secret, source=user-paste. Max 4096 chars; restricted charset (no control bytes)."
          )
        },
        async execute(args, ctx) {
          if (!gate.isCoordinatorCaller(ctx.sessionID)) {
            return JSON.stringify({
              status: "forbidden",
              reason: "record_input is restricted to the coordinator (Perun)"
            });
          }
          const result = await recordInputHandler(
            { name: args.name, value: args.value },
            { sessionID: ctx.sessionID }
          );
          return JSON.stringify(result);
        }
      })
    },
    "shell.env": shellEnvHook,
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return;
      const deletedID = event.properties?.info?.id;
      if (typeof deletedID !== "string" || deletedID.length === 0) return;
      registry.unregister(deletedID);
      store.clearParent(deletedID);
      state.clearRun(deletedID);
      parentIDCache.delete(deletedID);
      for (const [childID, parentID] of parentIDCache.entries()) {
        if (parentID === deletedID) parentIDCache.delete(childID);
      }
    }
  };
};
var qa_default = AppVerkQAPlugin;
export {
  AppVerkQAPlugin,
  BE_TOOLS,
  FE_TOOLS,
  SETUP_TOOLS,
  SHARED_TOOLS,
  VARIANTS,
  buildQATesterAgent,
  qa_default as default,
  toolsForVariant
};
