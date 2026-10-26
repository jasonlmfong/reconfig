import { describeEdge, type Graph } from "../domain/graph";
import type { PropertyId } from "../domain/problem";
import type { SolverResult, Step } from "../domain/result";
import { messages } from "../validation/messages";

/** Renders a selected configuration: a vertex sequence for paths, an edge list otherwise. */
export function describeConfiguration(
    graph: Graph,
    edgeIds: string[],
    property: PropertyId
): string {
    if (edgeIds.length === 0) return "(empty)";
    const label = new Map(graph.vertices.map((v) => [v.id, v.label]));
    const order = new Map(graph.vertices.map((v, i) => [v.id, i]));
    const edges = edgeIds
        .map((id) => graph.edges.find((e) => e.id === id))
        .filter((e) => e !== undefined);
    if (property === "path") {
        const adj = new Map<string, string[]>();
        for (const e of edges) {
            adj.set(e.u, [...(adj.get(e.u) ?? []), e.v]);
            adj.set(e.v, [...(adj.get(e.v) ?? []), e.u]);
        }
        const ends = [...adj.entries()]
            .filter(([, n]) => n.length === 1)
            .map(([v]) => v);
        if (
            ends.length === 2 &&
            [...adj.values()].every((n) => n.length <= 2)
        ) {
            ends.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
            const seq = [ends[0]];
            let prev = "";
            let cur = ends[0];
            while (seq.length <= edges.length) {
                const next = (adj.get(cur) ?? []).find((x) => x !== prev);
                if (next === undefined) break;
                seq.push(next);
                prev = cur;
                cur = next;
            }
            if (seq.length === edges.length + 1)
                return seq.map((v) => label.get(v) ?? v).join("–");
        }
    }
    return edges
        .map((e) => `${label.get(e.u) ?? e.u}–${label.get(e.v) ?? e.v}`)
        .join(", ");
}

export function moveTypeLabel(step: Step): string {
    switch (step.moveType) {
        case "initial":
            return "Initial";
        case "token-jump":
            return "Token Jumping";
        case "token-slide":
            return "Token Sliding";
        case "buffer-store":
            return "Buffer-store";
        case "buffer-retrieve":
            return "Buffer-retrieve";
    }
}

export function stepTitle(step: Step): string {
    switch (step.moveType) {
        case "initial":
            return "Initial configuration";
        case "token-jump":
            return `Token Jumping: replace ${step.removedEdgeId} with ${step.addedEdgeId}`;
        case "token-slide":
            return `Token Sliding: slide ${step.removedEdgeId} to ${step.addedEdgeId}`;
        case "buffer-store":
            return `Buffer-store ${step.removedEdgeId}`;
        case "buffer-retrieve":
            return `Buffer-retrieve ${step.addedEdgeId}`;
    }
}

/** Plain-language explanation of a step that always names the changed edges. */
export function explainStep(
    step: Step,
    graph: Graph,
    property: PropertyId,
    total: number
): string {
    const config = describeConfiguration(
        graph,
        step.configurationEdgeIds,
        property
    );
    const noun = property;
    const tokens = `${step.bufferOccupancy} token${step.bufferOccupancy === 1 ? "" : "s"}`;
    const position = `Step ${step.index} of ${total}.`;
    switch (step.moveType) {
        case "initial":
            return `${position} Start at the source: selected ${noun} is ${config}; the buffer is empty.`;
        case "token-jump":
            return `${position} Token Jumping: remove ${describeEdge(graph, step.removedEdgeId!)} and add ${describeEdge(graph, step.addedEdgeId!)} in one move. Selected ${noun} is ${config}; the buffer still holds ${tokens}.`;
        case "token-slide":
            return `${position} Token Sliding: slide the token from ${describeEdge(graph, step.removedEdgeId!)} to adjacent edge ${describeEdge(graph, step.addedEdgeId!)}. Selected ${noun} is ${config}; the buffer still holds ${tokens}.`;
        case "buffer-store":
            return `${position} Buffer-store: remove ${describeEdge(graph, step.removedEdgeId!)} and hold its token in the buffer. Selected ${noun} is ${config}; the buffer holds ${tokens}.`;
        case "buffer-retrieve":
            return `${position} Buffer-retrieve: place a buffered token on ${describeEdge(graph, step.addedEdgeId!)}. Selected ${noun} is ${config}; the buffer holds ${tokens}.`;
    }
}

export type ChipTone =
    | "neutral"
    | "success"
    | "negative"
    | "warning"
    | "running"
    | "stale";

export interface ChipView {
    tone: ChipTone;
    icon: string;
    text: string;
    detail?: string;
}

/** Result chip text (§4.1). */
export function resultChip(
    result: SolverResult | null,
    stale: boolean
): ChipView {
    if (!result) return { tone: "neutral", icon: "○", text: "No result yet" };
    if (stale)
        return {
            tone: "stale",
            icon: "↻",
            text: "Stale — solve again",
            detail: "The problem or budget changed after this result.",
        };
    switch (result.status) {
        case "reachable":
            return result.mode === "find-minimum"
                ? {
                      tone: "success",
                      icon: "✓",
                      text: `Minimum buffer: ${result.budget} — ${plural(result.moveCount, "move")}`,
                  }
                : {
                      tone: "success",
                      icon: "✓",
                      text: `Reachable at budget ${result.budget} — ${plural(result.moveCount, "move")}`,
                  };
        case "not-reachable": {
            const cycle =
                result.property === "cycle"
                    ? messages.cycleNoMoves()
                    : undefined;
            if (result.mode === "find-minimum") {
                return {
                    tone: "negative",
                    icon: "∞",
                    text: messages.noBudgetWorks(),
                    detail: cycle ?? "Every budget was searched exhaustively.",
                };
            }
            return {
                tone: "negative",
                icon: "⊘",
                text: messages.notReachableAtBudget(
                    result.budget ?? 0,
                    result.exploredStates
                ),
                detail: cycle,
            };
        }
        case "cancelled":
            return { tone: "warning", icon: "!", text: messages.cancelled() };
        case "internal-error":
            return result.message === messages.workerFailed()
                ? { tone: "warning", icon: "!", text: messages.workerFailed() }
                : {
                      tone: "warning",
                      icon: "!",
                      text: "Internal error — no reachability conclusion was produced.",
                      detail: result.message,
                  };
        case "invalid-input":
            return {
                tone: "warning",
                icon: "!",
                text: "Invalid input — the solver did not run.",
                detail: result.errors.map((e) => e.message).join(" "),
            };
    }
}

export function plural(n: number, word: string): string {
    return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

export function formatMs(ms: number): string {
    if (ms < 1) return "< 1 ms";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}
