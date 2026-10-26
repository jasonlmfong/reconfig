import type { IndexedGraph } from "../domain/graph";
import { popcount } from "../domain/mask";
import type { GraphProperty } from "../properties/types";
import { maxBudget } from "../properties/types";
import { MOVE_MODELS } from "../moveModels";
import type { MoveModel } from "../moveModels";

const UNKNOWN = 0;
const VALID = 1;

/** Per-solve state shared across budget passes. */
export interface SearchContext {
    readonly graph: IndexedGraph;
    readonly property: GraphProperty;
    readonly moveModel: MoveModel;
    readonly source: number;
    readonly target: number;
    /** |S| = |T|. */
    readonly q: number;
    /** Lazily filled property-validity cache: 0 unknown, 1 valid, 2 invalid. */
    readonly validity: Uint8Array;
    /** BFS arrays allocated on the first pass and reset (not reallocated) by later passes. */
    buffers: { pred: Int32Array; queue: Int32Array } | null;
}

export interface SearchHooks {
    /** Called after bounded batches of expansions. */
    onProgress?: (budget: number, expanded: number, queueSize: number) => void;
    progressInterval?: number;
}

export interface PassResult {
    reachable: boolean;
    /** Masks from source to target inclusive (shortest under the budget), or null. */
    path: number[] | null;
    /** Number of expanded states in this pass. */
    expanded: number;
}

export function createSearchContext(
    graph: IndexedGraph,
    property: GraphProperty,
    source: number,
    target: number,
    moveModel: MoveModel = MOVE_MODELS["token-jumping"]
): SearchContext {
    return {
        graph,
        property,
        moveModel,
        source,
        target,
        q: popcount(source),
        validity: new Uint8Array(1 << graph.m),
        buffers: null,
    };
}

export function isValidCached(ctx: SearchContext, mask: number): boolean {
    let v = ctx.validity[mask];
    if (v === UNKNOWN) {
        v = ctx.property.isValid(mask, ctx.graph) ? VALID : 2;
        ctx.validity[mask] = v;
    }
    return v === VALID;
}

/**
 * Enumerates the legal neighbors of `mask` under budget `b`: stores, then model-permitted
 * direct replacements (removed edge outer loop, added edge inner loop), then retrieves,
 * always scanning edge indices in ascending order. Only neighbors whose size lies in
 * [q - b, q] and that satisfy the property are reported. Return `true` from `visit` to stop.
 */
export function forEachNeighbor(
    ctx: SearchContext,
    mask: number,
    b: number,
    visit: (next: number) => boolean | void
): void {
    const m = ctx.graph.m;
    const q = ctx.q;
    const size = popcount(mask);

    if (size > q - b) {
        for (let i = 0; i < m; i++) {
            const bit = 1 << i;
            if (!(mask & bit)) continue;
            const next = mask ^ bit;
            if (isValidCached(ctx, next) && visit(next) === true) return;
        }
    }

    for (let i = 0; i < m; i++) {
        const out = 1 << i;
        if (!(mask & out)) continue;
        const without = mask ^ out;
        for (let j = 0; j < m; j++) {
            const inn = 1 << j;
            if (mask & inn) continue;
            if (!ctx.moveModel.canReplace(i, j, ctx.graph)) continue;
            const next = without | inn;
            if (isValidCached(ctx, next) && visit(next) === true) return;
        }
    }

    if (size < q) {
        for (let j = 0; j < m; j++) {
            const bit = 1 << j;
            if (mask & bit) continue;
            const next = mask | bit;
            if (isValidCached(ctx, next) && visit(next) === true) return;
        }
    }
}

/**
 * Breadth-first search from source to target over valid configurations F with
 * q - b <= |F| <= q. Returns the shortest sequence under budget b, or a conclusive
 * negative after exhausting every reachable legal configuration.
 */
export function searchAtBudget(
    ctx: SearchContext,
    b: number,
    hooks: SearchHooks = {}
): PassResult {
    const { source, target } = ctx;
    if (source === target)
        return { reachable: true, path: [source], expanded: 0 };

    const states = 1 << ctx.graph.m;
    ctx.buffers ??= {
        pred: new Int32Array(states),
        queue: new Int32Array(states),
    };
    const { pred, queue } = ctx.buffers;
    pred.fill(-1);
    let head = 0;
    let tail = 0;
    pred[source] = source;
    queue[tail++] = source;

    const interval = hooks.progressInterval ?? 2048;
    let expanded = 0;
    let found = false;
    let current = source;

    const visit = (next: number): boolean => {
        if (pred[next] !== -1) return false;
        pred[next] = current;
        if (next === target) {
            found = true;
            return true;
        }
        queue[tail++] = next;
        return false;
    };

    while (head < tail) {
        current = queue[head++];
        expanded++;
        forEachNeighbor(ctx, current, b, visit);
        if (found) break;
        if (hooks.onProgress && expanded % interval === 0) {
            hooks.onProgress(b, expanded, tail - head);
        }
    }

    if (!found) return { reachable: false, path: null, expanded };

    const path: number[] = [];
    for (let x = target; ; x = pred[x]) {
        path.push(x);
        if (x === source) break;
    }
    path.reverse();
    return { reachable: true, path, expanded };
}

export interface MinimumResult {
    /** Minimum sufficient budget, or null when no budget up to maxBudget(q) works. */
    budget: number | null;
    pass: PassResult | null;
    /** Expansions across all passes. */
    totalExpanded: number;
    budgetsSearched: number[];
}

/** Searches budgets 0, 1, ..., maxBudget(q) in ascending order and stops at the first success. */
export function findMinimumBuffer(
    ctx: SearchContext,
    hooks: SearchHooks = {}
): MinimumResult {
    const upper = maxBudget(ctx.property, ctx.q);
    let total = 0;
    const budgetsSearched: number[] = [];
    for (let b = 0; b <= upper; b++) {
        const base = total;
        const pass = searchAtBudget(ctx, b, {
            progressInterval: hooks.progressInterval,
            onProgress: hooks.onProgress
                ? (budget, expanded, queueSize) =>
                      hooks.onProgress!(budget, base + expanded, queueSize)
                : undefined,
        });
        total += pass.expanded;
        budgetsSearched.push(b);
        if (pass.reachable)
            return { budget: b, pass, totalExpanded: total, budgetsSearched };
    }
    return { budget: null, pass: null, totalExpanded: total, budgetsSearched };
}

/** Every configuration reachable from `start` under budget b (used for exhaustive comparisons). */
export function reachableSet(
    ctx: SearchContext,
    start: number,
    b: number
): Int32Array {
    const states = 1 << ctx.graph.m;
    const seen = new Uint8Array(states);
    const queue = new Int32Array(states);
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    const visit = (next: number): boolean => {
        if (!seen[next]) {
            seen[next] = 1;
            queue[tail++] = next;
        }
        return false;
    };
    while (head < tail) forEachNeighbor(ctx, queue[head++], b, visit);
    return queue.slice(0, tail);
}
