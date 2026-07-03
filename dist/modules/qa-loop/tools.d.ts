import * as zod_v4_core from 'zod/v4/core';
import * as _opencode_ai_plugin from '@opencode-ai/plugin';
import * as zod from 'zod';
import { CallerGate } from '../qa/caller-gate.js';
import { QaLoopState } from './sidecar.js';
import '../_shared/session-agent-registry.js';
import './types.js';

interface QaLoopToolDeps {
    gate: Pick<CallerGate, "isCoordinatorCaller">;
    state: QaLoopState;
    cwd: string;
    resolveParentID: (sessionID: string) => Promise<string>;
    assignIssueIds: (input: {
        findings: {
            scenario: string;
            severity: string;
            title: string;
            problem: string;
            remediation: string;
            location: string | null;
        }[];
        startAt?: number;
    }) => Promise<{
        id: string;
        scenario: string;
        severity: string;
        title: string;
        problem: string;
        remediation: string;
        location: string | null;
    }[]>;
}
/**
 * The plan-declared seed marker (`**Seed (psql/sqlite3):**`). Kept intentionally
 * PERMISSIVE — a SUPERSET of what be-testing's LLM executor recognizes: a leading
 * list-marker — unordered (`- ` / `* ` / `+ `) OR ordered (`1. ` / `2) `, the plan format's
 * numbered-step form, test-plan-format §Plan Structure) — or blockquote (`> `), and
 * incidental whitespace around the marker, all still match. The consent gate must never be
 * weaker than the executor: if be-testing would run the fenced SQL (it recognizes the marker
 * semantically), this MUST catch it so the write stays consent-gated. Still rejects prose
 * that only mentions "seed" (`**Seeded rows are visible**`, `**Seed the database manually**`)
 * because the `(psql/sqlite3)` clause is required. Authors must write the byte-exact
 * canonical marker; the leniency here is defense-in-depth, not license to vary it.
 */
declare const SEED_MARKER: RegExp;
/** Loop budget defaults — the single source the tool reads (docs quote these). */
declare const QA_LOOP_DEFAULTS: {
    readonly maxIterations: 3;
    readonly maxDispatches: 50;
    readonly timeBudgetS: 1800;
};
declare function makeQaLoopTools(deps: QaLoopToolDeps): {
    qa_loop_start: {
        description: string;
        args: {
            plan_path: zod.ZodString;
            topic: zod.ZodString;
            report_path: zod.ZodString;
            mode: zod.ZodOptional<zod.ZodEnum<{
                approve: "approve";
                auto: "auto";
                step: "step";
            }>>;
            severity_floor: zod.ZodOptional<zod.ZodEnum<{
                LOW: "LOW";
                MEDIUM: "MEDIUM";
                HIGH: "HIGH";
                CRITICAL: "CRITICAL";
            }>>;
            max_iterations: zod.ZodOptional<zod.ZodNumber>;
            max_dispatches: zod.ZodOptional<zod.ZodNumber>;
            time_budget_s: zod.ZodOptional<zod.ZodNumber>;
            allow_mutations: zod.ZodOptional<zod.ZodBoolean>;
        };
        execute(args: {
            plan_path: string;
            topic: string;
            report_path: string;
            mode?: "approve" | "auto" | "step" | undefined;
            severity_floor?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined;
            max_iterations?: number | undefined;
            max_dispatches?: number | undefined;
            time_budget_s?: number | undefined;
            allow_mutations?: boolean | undefined;
        }, context: _opencode_ai_plugin.ToolContext): Promise<_opencode_ai_plugin.ToolResult>;
    };
    qa_loop_ingest: {
        description: string;
        args: {
            phase: zod.ZodEnum<{
                final: "final";
                baseline: "baseline";
                retest: "retest";
            }>;
            start_at_qa_id: zod.ZodOptional<zod.ZodNumber>;
            results: zod.ZodArray<zod.ZodObject<{
                scenario: zod.ZodString;
                state: zod.ZodEnum<{
                    pass: "pass";
                    fail: "fail";
                    skip: "skip";
                }>;
                reason: zod.ZodOptional<zod.ZodString>;
                severity: zod.ZodOptional<zod.ZodEnum<{
                    LOW: "LOW";
                    MEDIUM: "MEDIUM";
                    HIGH: "HIGH";
                    CRITICAL: "CRITICAL";
                }>>;
                title: zod.ZodOptional<zod.ZodString>;
                problem: zod.ZodOptional<zod.ZodString>;
                remediation: zod.ZodOptional<zod.ZodString>;
                location: zod.ZodOptional<zod.ZodString>;
            }, zod_v4_core.$strip>>;
        };
        execute(args: {
            phase: "final" | "baseline" | "retest";
            results: {
                scenario: string;
                state: "pass" | "fail" | "skip";
                reason?: string | undefined;
                severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined;
                title?: string | undefined;
                problem?: string | undefined;
                remediation?: string | undefined;
                location?: string | undefined;
            }[];
            start_at_qa_id?: number | undefined;
        }, context: _opencode_ai_plugin.ToolContext): Promise<_opencode_ai_plugin.ToolResult>;
    };
    qa_loop_step: {
        description: string;
        args: {
            phase: zod.ZodEnum<{
                enter: "enter";
                evaluate: "evaluate";
            }>;
        };
        execute(args: {
            phase: "enter" | "evaluate";
        }, context: _opencode_ai_plugin.ToolContext): Promise<_opencode_ai_plugin.ToolResult>;
    };
    qa_loop_record_fix: {
        description: string;
        args: {
            qa_id: zod.ZodString;
            child_session_id: zod.ZodString;
            svarog_status: zod.ZodEnum<{
                READY: "READY";
                FAIL: "FAIL";
                ESCALATE: "ESCALATE";
            }>;
            changed: zod.ZodArray<zod.ZodString>;
            reason: zod.ZodString;
            be_payloads: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        };
        execute(args: {
            qa_id: string;
            child_session_id: string;
            svarog_status: "READY" | "FAIL" | "ESCALATE";
            changed: string[];
            reason: string;
            be_payloads?: string[] | undefined;
        }, context: _opencode_ai_plugin.ToolContext): Promise<_opencode_ai_plugin.ToolResult>;
    };
    qa_loop_finalize: {
        description: string;
        args: {
            final_pass_elapsed_s: zod.ZodOptional<zod.ZodNumber>;
        };
        execute(args: {
            final_pass_elapsed_s?: number | undefined;
        }, context: _opencode_ai_plugin.ToolContext): Promise<_opencode_ai_plugin.ToolResult>;
    };
    qa_loop_undo: {
        description: string;
        args: {};
        execute(args: Record<string, never>, context: _opencode_ai_plugin.ToolContext): Promise<_opencode_ai_plugin.ToolResult>;
    };
};

export { QA_LOOP_DEFAULTS, type QaLoopToolDeps, SEED_MARKER, makeQaLoopTools };
