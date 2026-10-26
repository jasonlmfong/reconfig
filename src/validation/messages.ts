import { MAX_EDGES, MAX_VERTICES } from "../domain/constants";
import type { SelectionRole } from "../domain/problem";

/** User-facing message builders (§8). Keep wording here so tests and UI agree. */
export const messages = {
    graphLimit: (maxVertices = MAX_VERTICES, maxEdges = MAX_EDGES) =>
        `Graph limit reached: supports at most ${maxVertices} vertices and ${maxEdges} edges.`,
    invalidConfiguration: (role: SelectionRole, noun: string, reason: string) =>
        `${capitalize(role)} must be a valid ${noun}: ${reason}.`,
    sizeMismatch: (source: number, target: number) =>
        `Source and target must contain the same number of edges (source: ${source}, target: ${target}).`,
    selectBoth: () => "Select at least one edge for the source and target.",
    selectOne: (role: SelectionRole) =>
        `Select at least one edge for the ${role}.`,
    importFailed: (detail: string) => `Import failed: ${detail}`,
    notReachableAtBudget: (budget: number, explored: number) =>
        `Not reachable at budget ${budget} — search complete (${explored.toLocaleString("en-US")} state${explored === 1 ? "" : "s"} explored). Try a larger budget or Find minimum buffer.`,
    noBudgetWorks: () => "No budget works under this model.",
    cycleNoMoves: () =>
        "No single store, retrieve, jump, or slide turns a simple cycle into a different one, so distinct cycles are never reachable under any budget.",
    editingLocked: () =>
        "Editing is locked while the solver runs. Cancel to edit.",
    cancelled: () =>
        "Solver cancelled. No reachability conclusion was produced.",
    workerFailed: () =>
        "Solver stopped unexpectedly. Try again; the result is not a proof of unreachability.",
};

export function capitalize(s: string): string {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** Joins items as `a`, `a and b`, or `a, b, and c`. */
export function joinList(items: string[]): string {
    if (items.length <= 1) return items.join("");
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
