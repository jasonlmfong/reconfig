import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { indexGraph, type Graph } from "../src/domain/graph";
import { popcount } from "../src/domain/mask";
import type { MoveModelId } from "../src/domain/moveModel";
import type { Problem, PropertyId } from "../src/domain/problem";
import {
    cycleUnreachable,
    disconnectedPaths,
    fixtureA,
    fixtureB,
    spider,
    stressInstance,
} from "../src/examples/fixtures";
import {
    cycleProperty,
    forestProperty,
    maxBudget,
    pathProperty,
    PROPERTIES,
    treeProperty,
    type GraphProperty,
} from "../src/properties";
import { MOVE_MODELS } from "../src/moveModels";
import {
    createSearchContext,
    forEachNeighbor,
    searchAtBudget,
} from "../src/solver/search";
import { solveProblem } from "../src/solver/solve";
import { verifySequence } from "../src/verify/verifySequence";
import {
    contextOf,
    expectReachable,
    graphFromPairs,
    problemFromMasks,
    problemOf,
    randomGraph,
    rng,
    validMasksOfSize,
} from "./helpers";

const PROPS: Readonly<Record<PropertyId, GraphProperty>> = PROPERTIES;

function solveAt(problem: Problem, budget: number, options = {}) {
    return solveProblem(problem, { mode: "budget", budget }, options);
}

function findMin(problem: Problem, options = {}) {
    return solveProblem(problem, { mode: "find-minimum", budget: 0 }, options);
}

/**
 * Independent BFS over edge-index sets with its own property and adjacency checks; returns the
 * shortest number of moves within budget b, or -1.
 */
function naiveDistance(problem: Problem, b: number): number {
    const ends = problem.graph.edges.map((e) => [e.u, e.v] as const);
    const index = new Map(problem.graph.edges.map((e, i) => [e.id, i]));
    const sliding = problem.moveModel === "token-sliding";
    const adjacent = (i: number, j: number) =>
        ends[i].some((w) => ends[j].includes(w));
    const valid = (set: number[]): boolean => {
        if (set.length === 0) return false;
        const deg = new Map<string, number>();
        const parent = new Map<string, string>();
        const find = (x: string): string => {
            while (parent.get(x) !== x) x = parent.get(x)!;
            return x;
        };
        let merges = 0;
        for (const i of set) {
            for (const w of ends[i]) {
                deg.set(w, (deg.get(w) ?? 0) + 1);
                if (!parent.has(w)) parent.set(w, w);
            }
            const ra = find(ends[i][0]);
            const rc = find(ends[i][1]);
            if (ra !== rc) {
                parent.set(ra, rc);
                merges++;
            }
        }
        const connected = merges === deg.size - 1;
        const acyclic = merges === set.length;
        const degrees = [...deg.values()];
        switch (problem.property) {
            case "forest":
                return acyclic;
            case "tree":
                return acyclic && connected;
            case "path":
                return acyclic && connected && degrees.every((d) => d <= 2);
            case "cycle":
                return (
                    connected &&
                    set.length >= 3 &&
                    degrees.every((d) => d === 2)
                );
        }
    };
    const key = (s: number[]) => [...s].sort((x, y) => x - y).join(",");
    const start = problem.sourceEdgeIds.map((id) => index.get(id)!);
    const goal = key(problem.targetEdgeIds.map((id) => index.get(id)!));
    const q = start.length;
    const m = ends.length;
    const dist = new Map<string, number>([[key(start), 0]]);
    let frontier = [start];
    if (key(start) === goal) return 0;
    while (frontier.length > 0) {
        const next: number[][] = [];
        for (const s of frontier) {
            const d = dist.get(key(s))!;
            const inSet = new Set(s);
            const candidates: number[][] = [];
            for (const i of s) candidates.push(s.filter((x) => x !== i));
            for (let j = 0; j < m; j++)
                if (!inSet.has(j)) candidates.push([...s, j]);
            for (const i of s) {
                for (let j = 0; j < m; j++) {
                    if (!inSet.has(j) && (!sliding || adjacent(i, j)))
                        candidates.push([...s.filter((x) => x !== i), j]);
                }
            }
            for (const c of candidates) {
                if (c.length < q - b || c.length > q || !valid(c)) continue;
                const k = key(c);
                if (dist.has(k)) continue;
                dist.set(k, d + 1);
                if (k === goal) return d + 1;
                next.push(c);
            }
        }
        frontier = next;
    }
    return -1;
}

describe("Fixture A — same source and target", () => {
    it.each(["path", "tree"] as const)(
        "is reachable with zero moves (%s)",
        (property) => {
            const problem = { ...problemOf(fixtureA()), property };
            for (let b = 0; b <= 3; b++) {
                const r = expectReachable(solveAt(problem, b));
                expect(r.moveCount).toBe(0);
                expect(r.steps).toHaveLength(1);
                expect(r.steps[0].moveType).toBe("initial");
                expect(r.steps[0].configurationEdgeIds).toEqual([
                    "e1",
                    "e2",
                    "e3",
                    "e6",
                ]);
            }
            const min = expectReachable(findMin(problem));
            expect(min.budget).toBe(0);
            expect(min.isMinimum).toBe(true);
            expect(min.moveCount).toBe(0);
            expect(min.steps).toHaveLength(1);
        }
    );
});

describe("Fixture B — six-vertex path needing one buffer slot", () => {
    const problem = problemOf(fixtureB());

    it("is not reachable at budget 0, exhaustively", () => {
        const r = solveAt(problem, 0);
        expect(r.status).toBe("not-reachable");
        if (r.status !== "not-reachable") return;
        expect(r.budget).toBe(0);
        expect(r.bufferResult).toBeUndefined();
        // The source is isolated under TJ: only the source itself is expanded.
        expect(r.exploredStates).toBe(1);
    });

    it.each([1, 2, 3])("is reachable in 3 moves at budget %i", (b) => {
        const r = expectReachable(solveAt(problem, b));
        expect(r.budget).toBe(b);
        expect(r.moveCount).toBe(3);
        expect(r.isMinimum).toBeUndefined();
        expect(verifySequence(problem, r)).toEqual({ ok: true, errors: [] });
    });

    it("returns the unique shortest sequence at budget 1", () => {
        const r = expectReachable(solveAt(problem, 1));
        expect(r.steps).toEqual([
            {
                index: 1,
                moveType: "initial",
                configurationEdgeIds: ["e1", "e2", "e3", "e6"],
                bufferOccupancy: 0,
            },
            {
                index: 2,
                moveType: "buffer-store",
                removedEdgeId: "e2",
                configurationEdgeIds: ["e1", "e3", "e6"],
                bufferOccupancy: 1,
            },
            {
                index: 3,
                moveType: "token-jump",
                removedEdgeId: "e6",
                addedEdgeId: "e5",
                configurationEdgeIds: ["e1", "e3", "e5"],
                bufferOccupancy: 1,
            },
            {
                index: 4,
                moveType: "buffer-retrieve",
                addedEdgeId: "e4",
                configurationEdgeIds: ["e1", "e3", "e4", "e5"],
                bufferOccupancy: 0,
            },
        ]);
        expect(r.steps.map((s) => s.bufferOccupancy)).toEqual([0, 1, 1, 0]);
        expect(r.sourceSize).toBe(4);
        expect(r.targetSize).toBe(4);
    });

    it("finds minimum buffer 1 with 3 moves", () => {
        const r = expectReachable(findMin(problem));
        expect(r.mode).toBe("find-minimum");
        expect(r.budget).toBe(1);
        expect(r.isMinimum).toBe(true);
        expect(r.moveCount).toBe(3);
        expect(r.solverVersion).toBe("0.2.0");
        // Cumulative: one expansion at budget 0 plus the budget-1 pass.
        const pass1 = solveAt(problem, 1);
        expect(r.exploredStates).toBe(1 + pass1.exploredStates);
    });

    it("rejects an out-of-range budget as invalid input", () => {
        const r = solveAt(problem, 4);
        expect(r.status).toBe("invalid-input");
        const r2 = solveAt(problem, 0.5);
        expect(r2.status).toBe("invalid-input");
    });

    it("has exactly three valid 4-edge paths that pairwise differ by four edges", () => {
        const masks = validMasksOfSize(problem.graph, pathProperty, 4);
        expect(masks).toHaveLength(3);
    });
});

describe("Fixture D — unequal sizes", () => {
    it("is invalid input and never searched", () => {
        const p = problemOf(fixtureB());
        const problem = { ...p, targetEdgeIds: ["e1", "e3", "e5"] };
        for (const r of [solveAt(problem, 0), findMin(problem)]) {
            expect(r.status).toBe("invalid-input");
            if (r.status !== "invalid-input") continue;
            expect(r.exploredStates).toBe(0);
            expect(r.errors.map((e) => e.message)).toContain(
                "Source and target must contain the same number of edges (source: 4, target: 3)."
            );
        }
    });
});

describe("Fixture E — trees on connected hosts need no buffer", () => {
    it("reaches every equal-size tree pair at budget 0 using only token jumps", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 3, max: 7 }),
                fc.integer({ min: 0, max: 5 }),
                fc.integer(),
                (n, extra, seed) => {
                    const random = rng(seed);
                    const graph = randomGraph(random, n, extra, true);
                    const q = 1 + Math.floor(random() * (n - 1));
                    const trees = validMasksOfSize(graph, treeProperty, q);
                    const s = trees[Math.floor(random() * trees.length)];
                    const t = trees[Math.floor(random() * trees.length)];
                    const problem = problemFromMasks(graph, "tree", s, t);
                    const r = expectReachable(solveAt(problem, 0));
                    expect(
                        r.steps
                            .slice(1)
                            .every((step) => step.moveType === "token-jump")
                    ).toBe(true);
                    expect(verifySequence(problem, r).ok).toBe(true);
                    const min = expectReachable(findMin(problem));
                    expect(min.budget).toBe(0);
                    expect(min.moveCount).toBe(r.moveCount);
                }
            ),
            { numRuns: 200, seed: 20261026 }
        );
    });
});

function expectMinimum(
    problem: Problem,
    expectedMin: number,
    expectedMoves: number | null,
    options = {}
) {
    for (let b = 0; b < expectedMin; b++) {
        expect(solveAt(problem, b, options).status).toBe("not-reachable");
    }
    const atMin = expectReachable(solveAt(problem, expectedMin, options));
    if (expectedMoves !== null) expect(atMin.moveCount).toBe(expectedMoves);
    const min = expectReachable(findMin(problem, options));
    expect(min.budget).toBe(expectedMin);
    expect(min.moveCount).toBe(atMin.moveCount);
    expect(verifySequence(problem, min).ok).toBe(true);
}

describe("Fixture G — spider path buffer scaling", () => {
    it.each([
        [2, 1, 3],
        [3, 2, 5],
    ])("m = %i needs minimum buffer %i with %i moves", (m, min, moves) => {
        const project = spider(m);
        expect(project.graph.vertices).toHaveLength(3 * m + 1);
        expect(project.graph.edges).toHaveLength(3 * m);
        expectMinimum(problemOf(project), min, moves);
    });

    it("m = 4 (caps overridden) follows the m - 1 pattern", () => {
        const problem = problemOf(spider(4));
        expect(solveAt(problem, 0).status).toBe("invalid-input");
        expectMinimum(problem, 3, null, {
            limits: { maxVertices: 13, maxEdges: 18 },
        });
    });
});

describe("Fixture H — disconnected host", () => {
    it.each([
        [2, "path"],
        [2, "tree"],
        [3, "path"],
        [3, "tree"],
    ] as const)("k = %i under %s needs minimum buffer k - 1", (k, property) => {
        const problem = problemOf(disconnectedPaths(k, property));
        expectMinimum(problem, k - 1, 2 * k - 1);
    });
});

describe("maximum caps — two K3,3 (12 vertices, 18 edges)", () => {
    it.each(["tree", "path"] as const)(
        "needs minimum buffer q - 1 = 4 under %s, with budgets 0..3 exhausted",
        (property) => {
            const project = stressInstance(property);
            expect(project.graph.vertices).toHaveLength(12);
            expect(project.graph.edges).toHaveLength(18);
            const problem = problemOf(project);
            expectMinimum(problem, 4, null);
            const min = expectReachable(findMin(problem));
            // Shrink to one edge (4 stores), jump across components (1), grow back (4).
            expect(min.moveCount).toBe(9);
        }
    );
});

describe("not reachable under any budget (stub property)", () => {
    // Valid only for exactly the source and target: no move is ever legal.
    const stub: GraphProperty = {
        id: "path",
        name: "Stub",
        noun: "stub configuration",
        allowsEmpty: false,
        isValid: (mask) => mask === 0b0011 || mask === 0b1100,
        explainInvalid: (mask) =>
            mask === 0b0011 || mask === 0b1100
                ? null
                : "not a stub configuration",
    };
    const problem: Problem = {
        graph: {
            vertices: ["a", "b", "c", "d", "e"].map((id) => ({
                id,
                label: id,
            })),
            edges: [
                { id: "x1", u: "a", v: "b" },
                { id: "x2", u: "b", v: "c" },
                { id: "x3", u: "c", v: "d" },
                { id: "x4", u: "d", v: "e" },
            ],
        },
        property: "path",
        sourceEdgeIds: ["x1", "x2"],
        targetEdgeIds: ["x3", "x4"],
    };

    it("reports bufferResult infinite after exhausting every budget", () => {
        const r = findMin(problem, { property: stub });
        expect(r.status).toBe("not-reachable");
        if (r.status !== "not-reachable") return;
        expect(r.bufferResult).toBe("infinite");
        expect(r.budget).toBeUndefined();
        expect(r.mode).toBe("find-minimum");
        // Budgets 0 and 1 each expand only the source.
        expect(r.exploredStates).toBe(2);
    });

    it("is never produced for path or tree", () => {
        for (const property of ["path", "tree"] as const) {
            const r = findMin({ ...problem, property });
            expect(r.status).toBe("reachable");
        }
    });
});

describe("Cycle instances with no feasible budget", () => {
    it("exhausts every budget and reports no budget works", () => {
        const problem = problemOf(cycleUnreachable());
        for (let budget = 0; budget <= 2; budget++) {
            const atBudget = solveAt(problem, budget);
            expect(atBudget.status, JSON.stringify(atBudget)).toBe(
                "not-reachable"
            );
        }
        const result = findMin(problem);
        expect(result.status).toBe("not-reachable");
        if (result.status !== "not-reachable") return;
        expect(result.mode).toBe("find-minimum");
        expect(result.bufferResult).toBe("infinite");
        expect(result.exploredStates).toBeGreaterThan(0);
    });
});

describe("general correctness invariants on seeded random instances", () => {
    const cases: { problem: Problem; q: number }[] = [];
    const random = rng(7);
    const properties: PropertyId[] = ["path", "tree", "forest", "cycle"];
    const models: MoveModelId[] = ["token-jumping", "token-sliding"];
    while (cases.length < 240) {
        const n = 3 + Math.floor(random() * 5);
        const connected = random() < 0.6;
        const graph: Graph = randomGraph(
            random,
            n,
            Math.floor(random() * 6),
            connected
        );
        if (graph.edges.length === 0) continue;
        const property = properties[Math.floor(random() * properties.length)];
        const moveModel = models[Math.floor(random() * models.length)];
        const q = 1 + Math.floor(random() * Math.min(4, graph.edges.length));
        const masks = validMasksOfSize(graph, PROPS[property], q);
        if (masks.length === 0) continue;
        const s = masks[Math.floor(random() * masks.length)];
        const t = masks[Math.floor(random() * masks.length)];
        cases.push({
            problem: problemFromMasks(graph, property, s, t, moveModel),
            q,
        });
    }

    it("covers every property and move model", () => {
        const kinds = new Set(
            cases.map(
                ({ problem }) => `${problem.property} ${problem.moveModel}`
            )
        );
        expect(kinds.size).toBe(8);
    });

    it("returns verified, shortest, monotone, deterministic results", () => {
        for (const { problem, q } of cases) {
            const upper = maxBudget(PROPS[problem.property], q);
            let prevMoves: number | null = null;
            let firstReachable: number | null = null;
            for (let b = 0; b <= upper; b++) {
                const r = solveAt(problem, b);
                const naive = naiveDistance(problem, b);
                if (r.status === "reachable") {
                    if (firstReachable === null) firstReachable = b;
                    expect(verifySequence(problem, r)).toEqual({
                        ok: true,
                        errors: [],
                    });
                    expect(r.moveCount).toBe(naive);
                    for (const step of r.steps) {
                        expect(step.bufferOccupancy).toBeGreaterThanOrEqual(0);
                        expect(step.bufferOccupancy).toBeLessThanOrEqual(b);
                        expect(step.bufferOccupancy).toBe(
                            q - step.configurationEdgeIds.length
                        );
                        if (problem.moveModel === "token-sliding")
                            expect(step.moveType).not.toBe("token-jump");
                        else expect(step.moveType).not.toBe("token-slide");
                    }
                    if (prevMoves !== null)
                        expect(r.moveCount).toBeLessThanOrEqual(prevMoves);
                    prevMoves = r.moveCount;
                    // Determinism, including after a JSON round trip of the input.
                    const again = solveAt(
                        JSON.parse(JSON.stringify(problem)) as Problem,
                        b
                    );
                    expect(again.status === "reachable" && again.steps).toEqual(
                        r.steps
                    );
                } else {
                    expect(r.status).toBe("not-reachable");
                    expect(naive).toBe(-1);
                    // Monotonicity: once reachable, always reachable.
                    expect(firstReachable).toBeNull();
                }
            }
            // Under Token Jumping every Path/Tree/Forest instance is reachable at q - 1.
            if (
                problem.moveModel === "token-jumping" &&
                problem.property !== "cycle"
            )
                expect(firstReachable).not.toBeNull();
            const min = findMin(problem);
            if (firstReachable === null) {
                expect(min.status === "not-reachable" && min.bufferResult).toBe(
                    "infinite"
                );
            } else {
                expect(expectReachable(min).budget).toBe(firstReachable);
            }
        }
    });
});

describe("Token Sliding", () => {
    // a-b-c-d path: x1 = ab, x2 = bc, x3 = cd; y1 = ef is a separate component.
    const graph = graphFromPairs(6, [
        [0, 1],
        [1, 2],
        [2, 3],
        [4, 5],
    ]);

    it("slides a single edge along the host and reports token-slide moves", () => {
        const problem = problemFromMasks(
            graph,
            "path",
            0b0001,
            0b0100,
            "token-sliding"
        );
        const r = expectReachable(solveAt(problem, 0));
        expect(r.moveCount).toBe(2);
        expect(r.moveModel).toBe("token-sliding");
        expect(
            r.steps
                .slice(1)
                .map((s) => [s.moveType, s.removedEdgeId, s.addedEdgeId])
        ).toEqual([
            ["token-slide", "e0", "e1"],
            ["token-slide", "e1", "e2"],
        ]);
        expect(verifySequence(problem, r)).toEqual({ ok: true, errors: [] });
        // Token Jumping reaches the same target in one move.
        expect(
            expectReachable(
                solveAt({ ...problem, moveModel: "token-jumping" }, 0)
            ).moveCount
        ).toBe(1);
    });

    it("only generates replacements between edges that share an endpoint", () => {
        const g = indexGraph(graph);
        const ctx = createSearchContext(
            g,
            forestProperty,
            0b0001,
            0b0001,
            MOVE_MODELS["token-sliding"]
        );
        const out: number[] = [];
        forEachNeighbor(ctx, 0b0001, 0, (x) => {
            out.push(x);
        });
        expect(out).toEqual([0b0010]);
    });

    it("cannot cross components with one token (q = 1 has no buffer), so no budget works", () => {
        const problem = problemFromMasks(
            graph,
            "forest",
            0b0001,
            0b1000,
            "token-sliding"
        );
        const r = findMin(problem);
        expect(r.status === "not-reachable" && r.bufferResult).toBe("infinite");
        expect(
            expectReachable(findMin({ ...problem, moveModel: "token-jumping" }))
                .budget
        ).toBe(0);
    });

    it("can cross components with a buffer slot because retrieves are unrestricted", () => {
        // Two tokens: {ab, bc} to {cd, ef} under Forest.
        const problem = problemFromMasks(
            graph,
            "forest",
            0b0011,
            0b1100,
            "token-sliding"
        );
        expect(solveAt(problem, 0).status).toBe("not-reachable");
        const min = expectReachable(findMin(problem));
        expect(min.budget).toBe(1);
        expect(
            min.steps.some(
                (s) =>
                    s.moveType === "buffer-retrieve" && s.addedEdgeId === "e3"
            )
        ).toBe(true);
        expect(verifySequence(problem, min)).toEqual({ ok: true, errors: [] });
    });
});

describe("Forest", () => {
    it("needs no buffer under Token Jumping, even on disconnected hosts (equal-size forests form matroid bases)", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 2, max: 7 }),
                fc.integer({ min: 0, max: 6 }),
                fc.boolean(),
                fc.integer(),
                (n, extra, connected, seed) => {
                    const random = rng(seed);
                    const graph = randomGraph(random, n, extra, connected);
                    if (graph.edges.length === 0) return;
                    const q =
                        1 +
                        Math.floor(random() * Math.min(4, graph.edges.length));
                    const forests = validMasksOfSize(graph, forestProperty, q);
                    if (forests.length === 0) return;
                    const s = forests[Math.floor(random() * forests.length)];
                    const t = forests[Math.floor(random() * forests.length)];
                    const problem = problemFromMasks(graph, "forest", s, t);
                    const min = expectReachable(findMin(problem));
                    expect(min.budget).toBe(0);
                    expect(verifySequence(problem, min).ok).toBe(true);
                }
            ),
            { numRuns: 150, seed: 4242 }
        );
    });
});

describe("Cycle", () => {
    it("has no legal neighbor from any cycle, under either model and any budget", () => {
        // K5: plenty of cycles of every length 3..5.
        const pairs: [number, number][] = [];
        for (let i = 0; i < 5; i++)
            for (let j = i + 1; j < 5; j++) pairs.push([i, j]);
        const g = indexGraph(graphFromPairs(5, pairs));
        for (let mask = 1; mask < 1 << g.m; mask++) {
            if (!cycleProperty.isValid(mask, g)) continue;
            const q = popcount(mask);
            for (const model of Object.values(MOVE_MODELS)) {
                const ctx = createSearchContext(
                    g,
                    cycleProperty,
                    mask,
                    mask,
                    model
                );
                for (let b = 0; b <= maxBudget(cycleProperty, q); b++) {
                    forEachNeighbor(ctx, mask, b, () => {
                        throw new Error(
                            `cycle ${mask} has a neighbor under ${model.id} at budget ${b}`
                        );
                    });
                }
            }
        }
    });
});

describe("progress reporting", () => {
    it("reports progress with budget, expansions, queue size, and elapsed time", () => {
        const problem = problemOf(spider(3));
        const updates: { budget: number; expandedStates: number }[] = [];
        const r = findMin(problem, {
            progressInterval: 1,
            onProgress: (p: { budget: number; expandedStates: number }) =>
                updates.push(p),
        });
        expect(r.status).toBe("reachable");
        expect(updates.length).toBeGreaterThan(0);
        const budgets = updates.map((u) => u.budget);
        expect(budgets).toEqual([...budgets].sort((a, b) => a - b));
        // Cumulative counts never decrease.
        for (let i = 1; i < updates.length; i++) {
            expect(updates[i].expandedStates).toBeGreaterThanOrEqual(
                updates[i - 1].expandedStates
            );
        }
    });
});

describe("searchAtBudget", () => {
    it("validity cache is shared across passes and passes use fresh visited state", () => {
        const problem = problemOf(fixtureB());
        const ctx = contextOf(problem, pathProperty);
        const a = searchAtBudget(ctx, 0);
        const b = searchAtBudget(ctx, 1);
        const c = searchAtBudget(ctx, 0);
        expect(a.reachable).toBe(false);
        expect(b.reachable).toBe(true);
        expect(c).toEqual(a);
        expect(indexGraph(problem.graph).m).toBe(6);
    });
});
