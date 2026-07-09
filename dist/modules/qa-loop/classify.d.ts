import { ScenarioKind } from './types.js';

/**
 * §5 kind taxonomy + §7 mutation/expected-outcome rules over a scenario's raw text block.
 *
 * - kind: `negative` (asserts a rejection/block) › `sanity` (smoke/baseline) › `feature` (default).
 * - mutating: an HTTP POST/PUT/PATCH/DELETE, an SQL write, or a write-ish step verb.
 * - expectsSuccess: false ONLY when the scenario asserts the mutation is BLOCKED (negative-blocked);
 *   the §7 mutation guard strips a scenario iff `mutating && expectsSuccess` — a negative-blocked
 *   mutating scenario stays in the dispatch set (the write never lands, AC19), while a mutating
 *   scenario expected to succeed is stripped (AC20).
 */
declare function classifyScenario(block: string): {
    kind: ScenarioKind;
    mutating: boolean;
    expectsSuccess: boolean;
};

export { classifyScenario };
