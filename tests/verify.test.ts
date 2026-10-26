import { describe, expect, it } from "vitest";
import type { ReachableResult, SolverResult, Step } from "../src/domain/result";
import { fixtureB } from "../src/examples/fixtures";
import { pathProperty, type GraphProperty } from "../src/properties";
import { solveProblem } from "../src/solver/solve";
import { verifySequence } from "../src/verify/verifySequence";
import {
    expectReachable,
    graphFromPairs,
    problemFromMasks,
    problemOf,
} from "./helpers";

const problem = problemOf(fixtureB());
const good = expectReachable(
    solveProblem(problem, { mode: "budget", budget: 1 })
);

function tamper(mutate: (r: ReachableResult) => void): ReachableResult {
    const copy = JSON.parse(JSON.stringify(good)) as ReachableResult;
    mutate(copy);
    return copy;
}

function errorsOf(result: SolverResult): string[] {
    return verifySequence(problem, result).errors;
}

describe("verifySequence", () => {
    it("accepts a correct sequence", () => {
        expect(verifySequence(problem, good)).toEqual({ ok: true, errors: [] });
    });

    it("passes non-reachable results trivially (nothing to replay)", () => {
        const r = solveProblem(problem, { mode: "budget", budget: 0 });
        expect(r.status).toBe("not-reachable");
        expect(verifySequence(problem, r).ok).toBe(true);
    });

    it("rejects a sequence that does not start at the source", () => {
        const r = tamper((x) => x.steps.shift());
        expect(
            errorsOf(r).some((e) => e.includes("does not start at the source"))
        ).toBe(true);
    });

    it("rejects a sequence that does not end at the target", () => {
        const r = tamper((x) => {
            x.steps.pop();
            x.moveCount = x.steps.length - 1;
        });
        expect(errorsOf(r)).toContain("sequence does not end at the target");
    });

    it("rejects a configuration outside the budget bounds", () => {
        const r = tamper((x) => {
            x.budget = 0;
        });
        expect(errorsOf(r).some((e) => e.includes("outside 4..4"))).toBe(true);
    });

    it("rejects wrong buffer occupancy", () => {
        const r = tamper((x) => {
            x.steps[1].bufferOccupancy = 0;
        });
        expect(errorsOf(r)).toContain("step 2: buffer occupancy 0, expected 1");
    });

    it("rejects an invalid intermediate configuration", () => {
        const r = tamper((x) => {
            // {e2, e3, e6} is disconnected.
            x.steps[1] = {
                index: 2,
                moveType: "buffer-store",
                removedEdgeId: "e1",
                configurationEdgeIds: ["e2", "e3", "e6"],
                bufferOccupancy: 1,
            };
        });
        expect(errorsOf(r)).toContain(
            "step 2: configuration is not a valid path"
        );
    });

    it("rejects moves that change more than allowed or mislabel edges", () => {
        const swapped = tamper((x) => {
            const s = x.steps[2] as Step;
            s.removedEdgeId = "e5";
            s.addedEdgeId = "e6";
        });
        expect(errorsOf(swapped)).toContain(
            "step 3: token jump names the wrong edges"
        );

        const jump = tamper((x) => {
            // Two edges change in a "store".
            x.steps[1].configurationEdgeIds = ["e1", "e3"];
            x.steps[1].bufferOccupancy = 2;
        });
        expect(
            errorsOf(jump).some((e) =>
                e.startsWith(
                    "step 2: buffer store must remove exactly one edge"
                )
            )
        ).toBe(true);

        const wrongType = tamper((x) => {
            x.steps[3].moveType = "token-jump";
        });
        expect(errorsOf(wrongType)).toContain(
            "step 4: token jump must remove one edge and add one edge"
        );
    });

    it("rejects inconsistent metadata", () => {
        expect(errorsOf(tamper((x) => (x.moveCount = 2)))).toContain(
            "moveCount 2 does not equal steps.length - 1 (3)"
        );
        expect(errorsOf(tamper((x) => (x.steps[2].index = 7)))).toContain(
            "step 3: index is 7, expected 3"
        );
        expect(errorsOf(tamper((x) => (x.isMinimum = true)))).toContain(
            "isMinimum is only valid in find-minimum mode"
        );
        expect(
            errorsOf(tamper((x) => (x.steps[0].moveType = "buffer-store")))
        ).toContain("step 1: first step must be 'initial'");
        expect(
            errorsOf(
                tamper(
                    (x) =>
                        (x.steps[2].configurationEdgeIds = ["e1", "e3", "e9"])
                )
            )
        ).toContain("step 3: edge e9 is not a host edge");
        expect(errorsOf(tamper((x) => (x.budget = 9)))).toContain(
            "budget 9 is outside 0..3"
        );
    });

    it("rejects an empty sequence", () => {
        expect(errorsOf(tamper((x) => (x.steps = [])))).toContain(
            "sequence is empty"
        );
    });
});

describe("verifySequence — move models", () => {
    // a-b-c-d path: e0 = ab, e1 = bc, e2 = cd.
    const graph = graphFromPairs(4, [
        [0, 1],
        [1, 2],
        [2, 3],
    ]);
    const sliding = problemFromMasks(
        graph,
        "path",
        0b001,
        0b100,
        "token-sliding"
    );
    const slid = expectReachable(
        solveProblem(sliding, { mode: "budget", budget: 0 })
    );

    it("accepts a Token Sliding sequence", () => {
        expect(
            slid.steps.slice(1).every((s) => s.moveType === "token-slide")
        ).toBe(true);
        expect(verifySequence(sliding, slid)).toEqual({ ok: true, errors: [] });
    });

    it("rejects a slide between edges that share no endpoint", () => {
        const jumpy: ReachableResult = {
            ...slid,
            moveCount: 1,
            steps: [
                slid.steps[0],
                {
                    index: 2,
                    moveType: "token-slide",
                    removedEdgeId: "e0",
                    addedEdgeId: "e2",
                    configurationEdgeIds: ["e2"],
                    bufferOccupancy: 0,
                },
            ],
        };
        expect(verifySequence(sliding, jumpy).errors).toContain(
            "step 2: token slide does not use adjacent edges under the selected move model"
        );
    });

    it("rejects a token jump under Token Sliding and a token slide under Token Jumping", () => {
        const asJump: ReachableResult = {
            ...slid,
            steps: slid.steps.map((s) =>
                s.moveType === "token-slide"
                    ? { ...s, moveType: "token-jump" }
                    : s
            ),
        };
        expect(verifySequence(sliding, asJump).errors).toContain(
            "step 2: token jump is not allowed by Token Sliding + extra buffer"
        );
        const jumping = { ...sliding, moveModel: "token-jumping" as const };
        expect(
            verifySequence(jumping, { ...slid, moveModel: "token-jumping" })
                .errors
        ).toContain(
            "step 2: token slide does not use adjacent edges under the selected move model"
        );
    });

    it("rejects a result labelled with a different move model", () => {
        expect(
            verifySequence({ ...sliding, moveModel: "token-jumping" }, slid)
                .errors
        ).toContain(
            "result move model token-sliding does not match problem move model token-jumping"
        );
    });
});

describe("verifySequence — independence from the solver property code", () => {
    it("catches a solver run with a broken property implementation", () => {
        // A property that accepts everything lets the search take shortcuts through non-paths.
        const broken: GraphProperty = {
            ...pathProperty,
            isValid: (mask) => mask !== 0,
            explainInvalid: () => null,
        };
        const r = expectReachable(
            solveProblem(
                problem,
                { mode: "budget", budget: 0 },
                { property: broken }
            )
        );
        expect(r.moveCount).toBeLessThan(3);
        const report = verifySequence(problem, r);
        expect(report.ok).toBe(false);
        expect(
            report.errors.some((e) => e.endsWith("is not a valid path"))
        ).toBe(true);
    });

    it.each(["tree", "forest", "cycle"] as const)(
        "recomputes %s membership itself",
        (property) => {
            const graph = graphFromPairs(4, [
                [0, 1],
                [1, 2],
                [2, 0],
                [2, 3],
            ]);
            // Source = target = the triangle, which is only a valid cycle.
            const p = problemFromMasks(graph, property, 0b0111, 0b0111);
            const fake: ReachableResult = {
                status: "reachable",
                mode: "budget",
                property,
                moveModel: "token-jumping",
                sourceSize: 3,
                targetSize: 3,
                exploredStates: 0,
                elapsedMs: 0,
                solverVersion: "0.2.0",
                budget: 0,
                moveCount: 0,
                steps: [
                    {
                        index: 1,
                        moveType: "initial",
                        configurationEdgeIds: ["e0", "e1", "e2"],
                        bufferOccupancy: 0,
                    },
                ],
            };
            expect(verifySequence(p, fake).ok).toBe(property === "cycle");
        }
    );
});
