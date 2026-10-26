import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { indexGraph } from "../src/domain/graph";
import { maskFromEdgeIds } from "../src/domain/mask";
import { fixtureB, fixtureC } from "../src/examples/fixtures";
import {
    cycleProperty,
    forestProperty,
    maxBudget,
    pathProperty,
    PROPERTIES,
    treeProperty,
    type GraphProperty,
} from "../src/properties";
import { validateProblem } from "../src/validation/problemValidation";
import { graphFromPairs, problemOf, randomGraph, rng } from "./helpers";

// v0-v1-v2-v3 path, v1-v4 branch, v2-v4 chord (triangle v1 v2 v4), v5-v6 separate, v7 isolated.
const g = graphFromPairs(8, [
    [0, 1],
    [1, 2],
    [2, 3],
    [1, 4],
    [2, 4],
    [5, 6],
]);
const ig = indexGraph(g);
const mask = (...ids: number[]) => ids.reduce((m, i) => m | (1 << i), 0);

describe("path property", () => {
    it("accepts a single edge and simple paths", () => {
        expect(pathProperty.isValid(mask(0), ig)).toBe(true);
        expect(pathProperty.isValid(mask(0, 1, 2), ig)).toBe(true);
        expect(pathProperty.isValid(mask(0, 3, 4, 2), ig)).toBe(true); // v0-v1-v4-v2-v3
        expect(pathProperty.explainInvalid(mask(0, 1, 2), ig)).toBeNull();
    });

    it("rejects empty, branching, cyclic, and disconnected selections with reasons", () => {
        expect(pathProperty.isValid(0, ig)).toBe(false);
        expect(pathProperty.explainInvalid(0, ig)).toBe(
            "no edges are selected"
        );
        expect(pathProperty.isValid(mask(0, 1, 3), ig)).toBe(false);
        expect(pathProperty.explainInvalid(mask(0, 1, 3), ig)).toBe(
            "vertex v1 has degree 3"
        );
        expect(pathProperty.isValid(mask(1, 3, 4), ig)).toBe(false);
        expect(pathProperty.explainInvalid(mask(1, 3, 4), ig)).toBe(
            "selected edges contain a cycle"
        );
        expect(pathProperty.isValid(mask(0, 5), ig)).toBe(false);
        expect(pathProperty.explainInvalid(mask(0, 5), ig)).toBe(
            "selected edges are disconnected"
        );
    });
});

describe("tree property", () => {
    it("accepts single edges, paths, and branching trees", () => {
        expect(treeProperty.isValid(mask(5), ig)).toBe(true);
        expect(treeProperty.isValid(mask(0, 1, 3), ig)).toBe(true);
        expect(treeProperty.isValid(mask(0, 1, 2, 3), ig)).toBe(true);
    });

    it("rejects empty, cyclic, and disconnected selections", () => {
        expect(treeProperty.isValid(0, ig)).toBe(false);
        expect(treeProperty.explainInvalid(mask(1, 3, 4), ig)).toBe(
            "selected edges contain a cycle"
        );
        expect(treeProperty.explainInvalid(mask(0, 5), ig)).toBe(
            "selected edges are disconnected"
        );
        // Disconnected and containing a cycle: the cycle is reported.
        expect(treeProperty.explainInvalid(mask(1, 3, 4, 5), ig)).toBe(
            "selected edges contain a cycle"
        );
    });

    it("ignores isolated host vertices (v7 never matters)", () => {
        expect(ig.n).toBe(8);
        expect(treeProperty.isValid(mask(0), ig)).toBe(true);
    });
});

describe("forest property", () => {
    it("accepts any non-empty acyclic selection, including disconnected ones", () => {
        expect(forestProperty.isValid(mask(0), ig)).toBe(true);
        expect(forestProperty.isValid(mask(0, 5), ig)).toBe(true);
        expect(forestProperty.isValid(mask(0, 1, 3), ig)).toBe(true);
        expect(forestProperty.explainInvalid(mask(0, 5), ig)).toBeNull();
    });

    it("rejects empty and cyclic selections with reasons", () => {
        expect(forestProperty.isValid(0, ig)).toBe(false);
        expect(forestProperty.explainInvalid(0, ig)).toBe(
            "no edges are selected"
        );
        expect(forestProperty.isValid(mask(1, 3, 4, 5), ig)).toBe(false);
        expect(forestProperty.explainInvalid(mask(1, 3, 4, 5), ig)).toBe(
            "selected edges contain a cycle"
        );
    });
});

describe("cycle property", () => {
    it("accepts a simple cycle", () => {
        expect(cycleProperty.isValid(mask(1, 3, 4), ig)).toBe(true); // v1-v2-v4
        expect(cycleProperty.explainInvalid(mask(1, 3, 4), ig)).toBeNull();
    });

    it("rejects empty, short, open, branching, and disconnected selections with reasons", () => {
        expect(cycleProperty.explainInvalid(0, ig)).toBe(
            "no edges are selected"
        );
        expect(cycleProperty.explainInvalid(mask(0, 1), ig)).toBe(
            "a cycle needs at least three edges"
        );
        expect(cycleProperty.explainInvalid(mask(0, 1, 2), ig)).toBe(
            "vertex v0 has degree 1"
        );
        expect(cycleProperty.explainInvalid(mask(0, 1, 3, 4), ig)).toBe(
            "vertex v0 has degree 1"
        );
        expect(cycleProperty.isValid(mask(1, 3, 4, 5), ig)).toBe(false);
    });

    it("rejects two disjoint cycles", () => {
        const two = indexGraph(
            graphFromPairs(6, [
                [0, 1],
                [1, 2],
                [2, 0],
                [3, 4],
                [4, 5],
                [5, 3],
            ])
        );
        expect(cycleProperty.isValid(0b111111, two)).toBe(false);
        expect(cycleProperty.explainInvalid(0b111111, two)).toBe(
            "selected edges are disconnected"
        );
        expect(cycleProperty.isValid(0b000111, two)).toBe(true);
    });
});

describe("maxBudget", () => {
    it("is q - 1 for properties that reject the empty configuration and q otherwise", () => {
        expect(maxBudget(pathProperty, 4)).toBe(3);
        expect(maxBudget(treeProperty, 1)).toBe(0);
        expect(maxBudget({ allowsEmpty: true }, 4)).toBe(4);
        expect(maxBudget(pathProperty, 0)).toBe(0);
    });
});

describe("fast and explanatory validators agree", () => {
    it("isValid(mask) === (explainInvalid(mask) === null) on random graphs and masks", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 2, max: 8 }),
                fc.integer({ min: 0, max: 10 }),
                fc.boolean(),
                fc.integer(),
                (n, extra, connected, seed) => {
                    const random = rng(seed);
                    const graph = randomGraph(random, n, extra, connected);
                    const indexed = indexGraph(graph);
                    for (let k = 0; k < 30; k++) {
                        const m = Math.floor(random() * (1 << indexed.m));
                        for (const p of Object.values(PROPERTIES)) {
                            expect(p.isValid(m, indexed), p.id).toBe(
                                p.explainInvalid(m, indexed) === null
                            );
                        }
                    }
                }
            ),
            { numRuns: 200, seed: 99 }
        );
    });
});

describe("problem validation", () => {
    it("Fixture B is valid and solvable", () => {
        const check = validateProblem(problemOf(fixtureB()));
        expect(check.canSolve).toBe(true);
        expect(check.q).toBe(4);
        expect(check.issues).toEqual([]);
    });

    it("Fixture C: a three-edge star source is not a path; solving is disabled", () => {
        const check = validateProblem(problemOf(fixtureC()));
        expect(check.canSolve).toBe(false);
        expect(check.source.valid).toBe(false);
        expect(check.source.message).toBe(
            "Source must be a valid path: vertex O has degree 3."
        );
        expect(check.target.valid).toBe(true);
    });

    it("Fixture C under Tree is valid", () => {
        const check = validateProblem({
            ...problemOf(fixtureC()),
            property: "tree",
        });
        expect(check.canSolve).toBe(true);
    });

    it("Fixture D: unequal sizes disable solving with a clear message", () => {
        const check = validateProblem({
            ...problemOf(fixtureB()),
            targetEdgeIds: ["e1", "e3", "e5"],
        });
        expect(check.canSolve).toBe(false);
        expect(check.sizeMessage).toBe(
            "Source and target must contain the same number of edges (source: 4, target: 3)."
        );
    });

    it("requires non-empty selections", () => {
        const p = problemOf(fixtureB());
        expect(
            validateProblem({ ...p, sourceEdgeIds: [], targetEdgeIds: [] })
                .emptyMessage
        ).toBe("Select at least one edge for the source and target.");
        expect(validateProblem({ ...p, sourceEdgeIds: [] }).emptyMessage).toBe(
            "Select at least one edge for the source."
        );
        expect(validateProblem({ ...p, targetEdgeIds: [] }).canSolve).toBe(
            false
        );
    });

    it("reports disconnected selections in the §8 wording", () => {
        const p = problemOf(fixtureB());
        const check = validateProblem({
            ...p,
            sourceEdgeIds: ["e2", "e3"],
            targetEdgeIds: ["e1", "e2"],
        });
        expect(check.source.message).toBe(
            "Source must be a valid path: selected edges are disconnected."
        );
    });

    it("enforces the graph caps", () => {
        const big = graphFromPairs(13, [[0, 1]]);
        const check = validateProblem({
            graph: big,
            property: "path",
            sourceEdgeIds: ["e0"],
            targetEdgeIds: ["e0"],
        });
        expect(check.canSolve).toBe(false);
        expect(check.graphIssues[0].message).toBe(
            "Graph limit reached: supports at most 12 vertices and 22 edges."
        );
    });

    it("rejects unknown and duplicate selection IDs", () => {
        const p = problemOf(fixtureB());
        expect(
            validateProblem({ ...p, sourceEdgeIds: ["e1", "e1", "e3", "e6"] })
                .canSolve
        ).toBe(false);
        expect(
            validateProblem({ ...p, sourceEdgeIds: ["e1", "e2", "e3", "zz"] })
                .canSolve
        ).toBe(false);
    });

    it("masks follow the canonical edge order", () => {
        const p = problemOf(fixtureB());
        const indexed = indexGraph(p.graph);
        expect(maskFromEdgeIds(["e1", "e2", "e3", "e6"], indexed)).toBe(
            0b100111
        );
    });

    it("blocks a selection that isValid rejects even when explainInvalid accepts it", () => {
        const inconsistent: GraphProperty = {
            ...pathProperty,
            isValid: () => false,
        };
        const check = validateProblem(
            problemOf(fixtureB()),
            undefined,
            inconsistent
        );
        expect(check.canSolve).toBe(false);
        expect(check.source.message).toBe(
            "Source must be a valid path: the solver rejects this selection."
        );
    });

    it("rejects prototype keys as property or move model IDs", () => {
        const p = problemOf(fixtureB());
        expect(
            validateProblem({ ...p, property: "constructor" as never }).canSolve
        ).toBe(false);
        expect(
            validateProblem({ ...p, moveModel: "toString" as never }).canSolve
        ).toBe(false);
    });
});
