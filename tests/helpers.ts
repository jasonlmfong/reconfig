import { indexGraph, type Edge, type Graph } from "../src/domain/graph";
import { maskFromEdgeIds } from "../src/domain/mask";
import type { MoveModelId } from "../src/domain/moveModel";
import type { Problem, PropertyId } from "../src/domain/problem";
import type { ProjectFile } from "../src/domain/project";
import type { SolverResult } from "../src/domain/result";
import type { GraphProperty } from "../src/properties";
import { MOVE_MODELS } from "../src/moveModels";
import { createSearchContext, type SearchContext } from "../src/solver/search";

export function problemOf(project: ProjectFile): Problem {
    return {
        graph: project.graph,
        property: project.property,
        moveModel: project.moveModel,
        sourceEdgeIds: project.sourceEdgeIds,
        targetEdgeIds: project.targetEdgeIds,
    };
}

export function contextOf(
    problem: Problem,
    property: GraphProperty
): SearchContext {
    const g = indexGraph(problem.graph);
    return createSearchContext(
        g,
        property,
        maskFromEdgeIds(problem.sourceEdgeIds, g),
        maskFromEdgeIds(problem.targetEdgeIds, g),
        MOVE_MODELS[problem.moveModel ?? "token-jumping"]
    );
}

/** Builds a graph with vertices 0..n-1 (IDs `v0`, ...) and edges `e0`, ... from index pairs. */
export function graphFromPairs(n: number, pairs: [number, number][]): Graph {
    return {
        vertices: Array.from({ length: n }, (_, i) => ({
            id: `v${i}`,
            label: `v${i}`,
        })),
        edges: pairs.map(
            ([a, b], i): Edge => ({ id: `e${i}`, u: `v${a}`, v: `v${b}` })
        ),
    };
}

export function idsOfMask(mask: number, graph: Graph): string[] {
    return graph.edges.filter((_, i) => mask & (1 << i)).map((e) => e.id);
}

export function problemFromMasks(
    graph: Graph,
    property: PropertyId,
    s: number,
    t: number,
    moveModel: MoveModelId = "token-jumping"
): Problem {
    return {
        graph,
        property,
        moveModel,
        sourceEdgeIds: idsOfMask(s, graph),
        targetEdgeIds: idsOfMask(t, graph),
    };
}

export function expectReachable(result: SolverResult) {
    if (result.status !== "reachable") {
        throw new Error(
            `expected reachable, got ${result.status}: ${JSON.stringify(result)}`
        );
    }
    return result;
}

/** Deterministic PRNG (mulberry32) for seeded tests. */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Random simple graph on n vertices; when `connected`, starts from a random spanning tree. */
export function randomGraph(
    random: () => number,
    n: number,
    extraEdges: number,
    connected: boolean
): Graph {
    const pairs: [number, number][] = [];
    const has = new Set<string>();
    const add = (a: number, b: number) => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (a === b || has.has(key)) return false;
        has.add(key);
        pairs.push([a, b]);
        return true;
    };
    if (connected) {
        for (let i = 1; i < n; i++) add(i, Math.floor(random() * i));
    }
    let attempts = 0;
    while (extraEdges > 0 && attempts < 500) {
        attempts++;
        if (add(Math.floor(random() * n), Math.floor(random() * n)))
            extraEdges--;
    }
    // Shuffle edge order so canonical order is not structural.
    for (let i = pairs.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    return graphFromPairs(n, pairs);
}

/** All masks of a given size that satisfy the property. */
export function validMasksOfSize(
    problemGraph: Graph,
    property: GraphProperty,
    size: number
): number[] {
    const g = indexGraph(problemGraph);
    const out: number[] = [];
    for (let mask = 1; mask < 1 << g.m; mask++) {
        let c = 0;
        for (let x = mask; x; x &= x - 1) c++;
        if (c === size && property.isValid(mask, g)) out.push(mask);
    }
    return out;
}
