import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { indexGraph, type Graph } from "../src/domain/graph";
import { popcount } from "../src/domain/mask";
import type { MoveModelId } from "../src/domain/moveModel";
import type { PropertyId } from "../src/domain/problem";
import { maxBudget, PROPERTIES, type GraphProperty } from "../src/properties";
import { MOVE_MODELS } from "../src/moveModels";
import { createSearchContext, reachableSet } from "../src/solver/search";
import { solveProblem } from "../src/solver/solve";
import { verifySequence } from "../src/verify/verifySequence";
import {
    expectReachable,
    graphFromPairs,
    problemFromMasks,
    validMasksOfSize,
} from "./helpers";

/** `[source, target, minimum buffer, moves]`; unreachable pairs use -1 for both. */
type Pair = [number, number, number, number];

interface AtlasEntry {
    atlasIndex: number;
    n: number;
    edges: [number, number][];
    results: {
        property: PropertyId;
        moveModel: MoveModelId;
        q: number;
        pairs: number;
        histogram: Record<string, number>;
        explicit: Pair[];
        sampled: Pair[];
    }[];
}

interface RandomEntry {
    n: number;
    edges: [number, number][];
    results: {
        property: PropertyId;
        moveModel: MoveModelId;
        q: number;
        pairs: Pair[];
    }[];
}

const golden = JSON.parse(
    gunzipSync(
        readFileSync(
            new URL("../reference/golden/golden-v1.json.gz", import.meta.url)
        )
    ).toString("utf8")
) as {
    format: string;
    version: number;
    atlas: AtlasEntry[];
    random: RandomEntry[];
};

const GOLDEN_PROPERTIES = ["path", "tree", "forest"] as const;
const GOLDEN_MODELS = ["token-jumping", "token-sliding"] as const;

/**
 * Recomputes the minimum-buffer histogram over all unordered pairs of size-q configurations using
 * the TypeScript solver's BFS: at each budget, label components by exhaustive reachability.
 * Pairs still apart at the largest budget are counted under `inf`.
 */
function histogramTs(
    graph: Graph,
    property: GraphProperty,
    model: MoveModelId,
    q: number
): { pairs: number; histogram: Record<string, number> } {
    const g = indexGraph(graph);
    const top = validMasksOfSize(graph, property, q);
    const histogram: Record<string, number> = {};
    let samePrev = 0;
    const total = (top.length * (top.length - 1)) / 2;
    for (let b = 0; b < q && samePrev < total; b++) {
        const label = new Map<number, number>();
        for (const s of top) {
            if (label.has(s)) continue;
            const ctx = createSearchContext(
                g,
                property,
                s,
                s,
                MOVE_MODELS[model]
            );
            for (const x of reachableSet(ctx, s, b)) {
                if (popcount(x) === q) label.set(x, s);
            }
        }
        const groups = new Map<number, number>();
        for (const s of top)
            groups.set(label.get(s)!, (groups.get(label.get(s)!) ?? 0) + 1);
        let same = 0;
        for (const size of groups.values()) same += (size * (size - 1)) / 2;
        if (same > samePrev) histogram[String(b)] = same - samePrev;
        samePrev = same;
    }
    if (samePrev < total) histogram.inf = total - samePrev;
    return { pairs: total, histogram };
}

function checkPair(
    graph: Graph,
    property: PropertyId,
    model: MoveModelId,
    [s, t, minimum, moves]: Pair
) {
    const problem = problemFromMasks(graph, property, s, t, model);
    if (minimum < 0) {
        const r = solveProblem(problem, { mode: "find-minimum", budget: 0 });
        expect(r.status === "not-reachable" && r.bufferResult).toBe("infinite");
        const upper = maxBudget(PROPERTIES[property], popcount(s));
        expect(
            solveProblem(problem, { mode: "budget", budget: upper }).status
        ).toBe("not-reachable");
        return;
    }
    const min = expectReachable(
        solveProblem(problem, { mode: "find-minimum", budget: 0 })
    );
    expect(min.budget).toBe(minimum);
    expect(min.moveCount).toBe(moves);
    expect(verifySequence(problem, min)).toEqual({ ok: true, errors: [] });
    if (minimum > 0) {
        expect(
            solveProblem(problem, { mode: "budget", budget: minimum - 1 })
                .status
        ).toBe("not-reachable");
    }
    const atMin = expectReachable(
        solveProblem(problem, { mode: "budget", budget: minimum })
    );
    expect(atMin.moveCount).toBe(moves);
}

describe("golden comparison with the Python reference", () => {
    it("loads a well-formed golden file", () => {
        expect(golden.format).toBe("reconfiglab-golden");
        expect(golden.version).toBe(1);
        // Every non-isomorphic graph with 1..6 vertices and at least one edge.
        expect(golden.atlas).toHaveLength(202);
        expect(golden.random.length).toBeGreaterThanOrEqual(40);
    });

    it("recomputes every atlas histogram exactly (all graphs up to 6 vertices, every property and model)", () => {
        for (const entry of golden.atlas) {
            const graph = graphFromPairs(entry.n, entry.edges);
            for (const property of GOLDEN_PROPERTIES) {
                const qs: number[] = [];
                for (let q = 1; q <= entry.edges.length; q++) {
                    if (
                        validMasksOfSize(graph, PROPERTIES[property], q)
                            .length >= 2
                    )
                        qs.push(q);
                }
                for (const model of GOLDEN_MODELS) {
                    const label = `atlas ${entry.atlasIndex} ${property} ${model}`;
                    const expected = entry.results.filter(
                        (r) => r.property === property && r.moveModel === model
                    );
                    expect(
                        expected.map((r) => r.q),
                        label
                    ).toEqual(qs);
                    for (const r of expected) {
                        const ts = histogramTs(
                            graph,
                            PROPERTIES[property],
                            model,
                            r.q
                        );
                        expect(ts, `${label} q=${r.q}`).toEqual({
                            pairs: r.pairs,
                            histogram: r.histogram,
                        });
                    }
                }
            }
        }
    });

    it("agrees on every recorded b* > 0 and unreachable pair and every sampled b* = 0 pair", () => {
        const seen = new Set<string>();
        for (const entry of golden.atlas) {
            const graph = graphFromPairs(entry.n, entry.edges);
            for (const r of entry.results) {
                for (const pair of [...r.explicit, ...r.sampled]) {
                    checkPair(graph, r.property, r.moveModel, pair);
                    seen.add(
                        `${r.property} ${r.moveModel} ${pair[2] < 0 ? "inf" : pair[2] > 0 ? "positive" : "zero"}`
                    );
                }
            }
        }
        for (const kind of [
            "path token-jumping positive",
            "tree token-sliding positive",
            "forest token-sliding positive",
            "forest token-sliding inf",
        ]) {
            expect(seen).toContain(kind);
        }
    });

    it("confirms no host with five or fewer vertices needs any buffer under Token Jumping", () => {
        for (const entry of golden.atlas.filter((e) => e.n <= 5)) {
            for (const r of entry.results.filter(
                (x) => x.moveModel === "token-jumping"
            )) {
                expect(Object.keys(r.histogram)).toEqual(["0"]);
            }
        }
    });

    it("agrees on seeded random graphs with 7 and 8 vertices", () => {
        let pairs = 0;
        let positive = 0;
        for (const entry of golden.random) {
            expect([7, 8]).toContain(entry.n);
            const graph = graphFromPairs(entry.n, entry.edges);
            for (const r of entry.results) {
                for (const pair of r.pairs) {
                    checkPair(graph, r.property, r.moveModel, pair);
                    pairs++;
                    if (pair[2] > 0) positive++;
                }
            }
        }
        expect(pairs).toBeGreaterThan(100);
        expect(positive).toBeGreaterThan(0);
    });
});
