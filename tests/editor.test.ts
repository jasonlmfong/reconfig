import { describe, expect, it } from "vitest";
import type { SolverResult } from "../src/domain/result";
import {
    canRedo,
    canUndo,
    createInitialState,
    docProblem,
    editorReducer,
    isDirty,
    isLocked,
    isResultStale,
    type EditorAction,
    type EditorState,
} from "../src/editor/state";
import { fixtureB, spider } from "../src/examples/fixtures";
import { solveProblem } from "../src/solver/solve";
import { messages } from "../src/validation/messages";
import { validateProblem } from "../src/validation/problemValidation";
import { buildCanvasModel } from "../src/ui/canvasModel";
import { explainStep, resultChip } from "../src/ui/describe";

const run = (state: EditorState, ...actions: EditorAction[]) =>
    actions.reduce(editorReducer, state);
const start = () => createInitialState(fixtureB());

function solved(
    state: EditorState,
    mode: "budget" | "find-minimum"
): EditorState {
    const s = editorReducer(state, { type: "solveStarted", mode });
    const result = solveProblem(docProblem(s.doc), { mode, budget: s.budget });
    return editorReducer(s, { type: "solveFinished", result });
}

describe("Fixture I — editor behavior", () => {
    it("locks every editing control while a search runs, and Cancel unlocks without a conclusion", () => {
        const running = editorReducer(start(), {
            type: "solveStarted",
            mode: "find-minimum",
        });
        expect(isLocked(running)).toBe(true);
        expect(
            canUndo(
                run(
                    start(),
                    { type: "setProperty", property: "tree" },
                    { type: "solveStarted", mode: "budget" }
                )
            )
        ).toBe(false);
        const blocked: EditorAction[] = [
            { type: "addVertex", x: 1, y: 1 },
            { type: "addEdge", u: "C", v: "D" },
            { type: "deleteVertex", id: "A" },
            { type: "deleteEdge", id: "e1" },
            { type: "deleteSelected" },
            { type: "toggleSelection", role: "source", edgeId: "e4" },
            { type: "clearSelection", role: "both" },
            { type: "setProperty", property: "tree" },
            { type: "renameVertex", id: "A", label: "Z" },
            { type: "renameProject", name: "x" },
            { type: "moveVertex", id: "A", x: 0, y: 0 },
            { type: "setEditMode", mode: "source" },
            { type: "setBudget", budget: 2 },
            { type: "undo" },
            { type: "redo" },
            { type: "newProject" },
            { type: "loadProject", project: spider(2) },
            { type: "canvasVertexTap", id: "A" },
            { type: "canvasEdgeTap", id: "e1" },
            { type: "canvasBackgroundTap", x: 0, y: 0 },
            { type: "solveStarted", mode: "budget" },
        ];
        for (const action of blocked) {
            const next = editorReducer(running, action);
            expect(next.doc, action.type).toBe(running.doc);
            expect(next.positions, action.type).toBe(running.positions);
            expect(next.budget, action.type).toBe(running.budget);
            expect(next.editMode, action.type).toBe(running.editMode);
            expect(next.revision, action.type).toBe(running.revision);
            expect(next.run, action.type).toBe(running.run);
            expect(next.notice?.text, action.type).toBe(
                messages.editingLocked()
            );
        }
        const cancelled: SolverResult = {
            status: "cancelled",
            mode: "find-minimum",
            property: "path",
            sourceSize: 4,
            targetSize: 4,
            exploredStates: 3,
            elapsedMs: 5,
            solverVersion: "0.2.0",
        };
        const after = editorReducer(running, {
            type: "solveFinished",
            result: cancelled,
        });
        expect(isLocked(after)).toBe(false);
        expect(after.budget).toBe(0);
        expect(resultChip(after.result, isResultStale(after)).text).toBe(
            "Solver cancelled. No reachability conclusion was produced."
        );
    });

    it("cascades a host-edge deletion into the source selection, flags validation, and undoes as one step", () => {
        const s = run(start(), { type: "deleteEdge", id: "e2" });
        expect(s.doc.graph.edges.map((e) => e.id)).toEqual([
            "e1",
            "e3",
            "e4",
            "e5",
            "e6",
        ]);
        expect(s.doc.sourceEdgeIds).toEqual(["e1", "e3", "e6"]);
        expect(s.notice?.text).toBe(
            "Edge e2 was removed from the source selection."
        );
        const check = validateProblem(docProblem(s.doc));
        expect(check.canSolve).toBe(false);
        expect(check.sizeMessage).toBe(
            "Source and target must contain the same number of edges (source: 3, target: 4)."
        );

        const undone = editorReducer(s, { type: "undo" });
        expect(undone.doc).toEqual(start().doc);
        expect(undone.doc.graph.edges.map((e) => e.id)).toEqual([
            "e1",
            "e2",
            "e3",
            "e4",
            "e5",
            "e6",
        ]);
        const redone = editorReducer(undone, { type: "redo" });
        expect(redone.doc).toEqual(s.doc);
    });

    it("names both selections when a shared edge is deleted", () => {
        const s = run(start(), { type: "deleteEdge", id: "e1" });
        expect(s.notice?.text).toBe(
            "Edge e1 was removed from the source and target selections."
        );
        expect(s.doc.sourceEdgeIds).not.toContain("e1");
        expect(s.doc.targetEdgeIds).not.toContain("e1");
    });

    it("deleting a vertex removes incident edges with the same cascade, as a single undo step", () => {
        const s = run(start(), { type: "deleteVertex", id: "A" });
        expect(s.doc.graph.vertices.map((v) => v.id)).toEqual([
            "B",
            "C",
            "D",
            "E",
            "F",
        ]);
        expect(s.doc.graph.edges.map((e) => e.id)).toEqual(["e3", "e4", "e6"]);
        expect(s.doc.sourceEdgeIds).toEqual(["e3", "e6"]);
        expect(s.doc.targetEdgeIds).toEqual(["e3", "e4"]);
        expect(s.notice?.text).toBe(
            "Deleted vertex A and its incident edges e1, e2, and e5. Edges e1 and e2 were removed from the source selection. Edges e1 and e5 were removed from the target selection."
        );
        expect(s.past).toHaveLength(1);
        const undone = editorReducer(s, { type: "undo" });
        expect(undone.doc).toEqual(start().doc);
        expect(undone.positions.A).toEqual(start().positions.A);
    });

    it("dragging a node does not mark a result stale and is not in the undo history", () => {
        const s = solved(start(), "budget");
        expect(s.result?.status).toBe("not-reachable");
        expect(isResultStale(s)).toBe(false);
        const dragged = editorReducer(s, {
            type: "moveVertex",
            id: "A",
            x: 999,
            y: 111,
        });
        expect(dragged.positions.A).toEqual({ x: 999, y: 111 });
        expect(isResultStale(dragged)).toBe(false);
        expect(dragged.past).toBe(s.past);
        expect(canUndo(dragged)).toBe(false);
    });

    it("moving the slider marks the result stale", () => {
        const s = solved(
            run(start(), { type: "setBudget", budget: 1 }),
            "budget"
        );
        expect(s.result?.status).toBe("reachable");
        expect(isResultStale(s)).toBe(false);
        const moved = editorReducer(s, { type: "setBudget", budget: 2 });
        expect(isResultStale(moved)).toBe(true);
        expect(resultChip(moved.result, true).text).toBe("Stale — solve again");
        // A stale result is not shown as current: no playback overlay on the canvas.
        expect(
            buildCanvasModel(moved, true).edges.some((e) =>
                e.classes.includes("play-current")
            )
        ).toBe(false);
    });

    it("after Find minimum buffer on Fixture B, the slider shows 1 and playback has started", () => {
        const s = solved(start(), "find-minimum");
        expect(s.budget).toBe(1);
        expect(s.playback).toEqual({ index: 0, playing: true });
        expect(isResultStale(s)).toBe(false);
        expect(resultChip(s.result, false).text).toBe(
            "Minimum buffer: 1 — 3 moves"
        );
    });
});

describe("editor history and staleness", () => {
    it("problem changes are undoable and invalidate results; labels and positions do not", () => {
        const base = solved(
            run(start(), { type: "setBudget", budget: 1 }),
            "budget"
        );
        const renamed = editorReducer(base, {
            type: "renameVertex",
            id: "A",
            label: "Alpha",
        });
        expect(renamed.doc.graph.vertices[0].label).toBe("Alpha");
        expect(isResultStale(renamed)).toBe(false);
        expect(canUndo(renamed)).toBe(true);
        expect(
            editorReducer(renamed, { type: "undo" }).doc.graph.vertices[0].label
        ).toBe("A");

        for (const action of [
            { type: "setProperty", property: "tree" },
            { type: "toggleSelection", role: "target", edgeId: "e6" },
            { type: "addEdge", u: "C", v: "D" },
            { type: "addVertex", x: 5, y: 5 },
        ] as EditorAction[]) {
            const next = editorReducer(base, action);
            expect(isResultStale(next), action.type).toBe(true);
            expect(canUndo(next), action.type).toBe(true);
        }
    });

    it("New, Load Example, and Import clear the history", () => {
        const edited = run(
            start(),
            { type: "setProperty", property: "tree" },
            { type: "undo" }
        );
        expect(canRedo(edited)).toBe(true);
        for (const action of [
            { type: "newProject" },
            { type: "loadProject", project: spider(3) },
        ] as EditorAction[]) {
            const next = editorReducer(edited, action);
            expect(next.past).toEqual([]);
            expect(next.future).toEqual([]);
            expect(next.result).toBeNull();
        }
    });

    it("enforces caps when adding vertices and edges", () => {
        let s = createInitialState();
        for (let i = 0; i < 12; i++)
            s = editorReducer(s, { type: "addVertex", x: i * 10, y: 0 });
        expect(s.doc.graph.vertices).toHaveLength(12);
        s = editorReducer(s, { type: "addVertex", x: 0, y: 0 });
        expect(s.doc.graph.vertices).toHaveLength(12);
        expect(s.notice?.text).toBe(
            "Graph limit reached: supports at most 12 vertices and 22 edges."
        );

        const ids = s.doc.graph.vertices.map((v) => v.id);
        let count = 0;
        for (let i = 0; i < ids.length && count < 23; i++) {
            for (let j = i + 1; j < ids.length && count < 23; j++) {
                s = editorReducer(s, { type: "addEdge", u: ids[i], v: ids[j] });
                count++;
            }
        }
        expect(s.doc.graph.edges).toHaveLength(22);
        expect(s.notice?.text).toBe(
            "Graph limit reached: supports at most 12 vertices and 22 edges."
        );
    });

    it("host-mode canvas taps add vertices and join two clicked vertices; duplicates are refused", () => {
        let s = start();
        s = run(
            s,
            { type: "canvasVertexTap", id: "C" },
            { type: "canvasVertexTap", id: "D" }
        );
        expect(s.doc.graph.edges.at(-1)).toEqual({ id: "e7", u: "C", v: "D" });
        expect(s.selection).toBeNull();
        s = run(
            s,
            { type: "canvasVertexTap", id: "A" },
            { type: "canvasVertexTap", id: "B" }
        );
        expect(s.doc.graph.edges).toHaveLength(7);
        expect(s.notice?.text).toBe(
            "Vertices A and B are already joined by edge e5."
        );
        s = run(s, { type: "canvasBackgroundTap", x: 50, y: 60 });
        expect(s.doc.graph.vertices.at(-1)).toEqual({ id: "G", label: "G" });
        expect(s.positions.G).toEqual({ x: 50, y: 60 });
        s = run(
            s,
            { type: "canvasEdgeTap", id: "e7" },
            { type: "deleteSelected" }
        );
        expect(s.doc.graph.edges.map((e) => e.id)).not.toContain("e7");
    });

    it("source/target modes toggle edges in canonical order", () => {
        let s = run(
            start(),
            { type: "setEditMode", mode: "source" },
            { type: "canvasEdgeTap", id: "e2" }
        );
        expect(s.doc.sourceEdgeIds).toEqual(["e1", "e3", "e6"]);
        s = editorReducer(s, { type: "canvasEdgeTap", id: "e2" });
        expect(s.doc.sourceEdgeIds).toEqual(["e1", "e2", "e3", "e6"]);
        s = run(
            s,
            { type: "setEditMode", mode: "target" },
            { type: "canvasEdgeTap", id: "e2" }
        );
        expect(s.doc.targetEdgeIds).toEqual(["e1", "e2", "e3", "e4", "e5"]);
        // Clicking the background in selection modes never edits the host graph.
        expect(
            editorReducer(s, { type: "canvasBackgroundTap", x: 0, y: 0 }).doc
        ).toBe(s.doc);
    });

    it("clamps the budget to 0..q-1 when the source shrinks", () => {
        let s = run(start(), { type: "setBudget", budget: 3 });
        expect(s.budget).toBe(3);
        s = editorReducer(s, {
            type: "toggleSelection",
            role: "source",
            edgeId: "e2",
        });
        expect(s.budget).toBe(2);
        s = editorReducer(s, { type: "setBudget", budget: 99 });
        expect(s.budget).toBe(2);
    });
});

describe("unsaved changes, IDs, and keyboard selection", () => {
    it("tracks unsaved edits to the document and the layout until exported", () => {
        const s = start();
        expect(isDirty(s)).toBe(false);
        const edited = editorReducer(s, {
            type: "setProperty",
            property: "tree",
        });
        expect(isDirty(edited)).toBe(true);
        expect(isDirty(editorReducer(edited, { type: "undo" }))).toBe(false);
        const dragged = editorReducer(s, {
            type: "moveVertex",
            id: "A",
            x: 1,
            y: 2,
        });
        expect(dragged.past).toHaveLength(0);
        expect(isDirty(dragged)).toBe(true);
        expect(isDirty(editorReducer(dragged, { type: "markSaved" }))).toBe(
            false
        );
        expect(isDirty(editorReducer(dragged, { type: "newProject" }))).toBe(
            false
        );
    });

    it("does not reuse a deleted vertex ID, so undo restores the original position", () => {
        let s = run(
            start(),
            { type: "deleteVertex", id: "A" },
            { type: "addVertex", x: 5, y: 5 }
        );
        const added = s.doc.graph.vertices.at(-1)!;
        expect(added.id).not.toBe("A");
        s = run(s, { type: "undo" }, { type: "undo" });
        expect(s.doc.graph.vertices.map((v) => v.id)).toContain("A");
        expect(s.positions.A).toEqual(start().positions.A);
    });

    it("selectElement switches to Host Graph mode and selects; it is locked while solving", () => {
        const s = run(
            start(),
            { type: "setEditMode", mode: "source" },
            { type: "selectElement", selection: { kind: "vertex", id: "B" } }
        );
        expect(s.editMode).toBe("host");
        expect(s.selection).toEqual({ kind: "vertex", id: "B" });
        const running = editorReducer(start(), {
            type: "solveStarted",
            mode: "budget",
        });
        expect(
            editorReducer(running, {
                type: "selectElement",
                selection: { kind: "edge", id: "e1" },
            }).selection
        ).toBeNull();
    });

    it("clamps an out-of-range saved budget on first load", () => {
        expect(
            createInitialState({ ...fixtureB(), bufferBudget: 99 }).budget
        ).toBe(3);
    });
});

describe("playback", () => {
    it("plays from the first entry to the end, then stops; buffer reads 0 → 1 → 1 → 0", () => {
        let s = solved(
            run(start(), { type: "setBudget", budget: 1 }),
            "budget"
        );
        expect(s.playback).toEqual({ index: 0, playing: true });
        const buffers: number[] = [];
        const explanations: string[] = [];
        for (let i = 0; i < 6; i++) {
            const r = s.result!;
            if (r.status !== "reachable") throw new Error("expected reachable");
            const step = r.steps[s.playback.index];
            buffers.push(step.bufferOccupancy);
            explanations.push(
                explainStep(step, s.doc.graph, s.doc.property, r.steps.length)
            );
            if (!s.playback.playing) break;
            s = editorReducer(s, { type: "playbackTick" });
        }
        expect(buffers).toEqual([0, 1, 1, 0]);
        expect(s.playback).toEqual({ index: 3, playing: false });
        expect(explanations[1]).toContain("remove e2 (A–E)");
        expect(explanations[2]).toContain("remove e6 (B–F) and add e5 (A–B)");
        expect(explanations[3]).toContain("e4 (D–F)");

        const model = buildCanvasModel(s, false);
        const e4 = model.edges.find((e) => e.id === "e4")!;
        expect(e4.classes).toContain("play-added");
        expect(e4.label).toBe("+ e4");

        s = run(s, { type: "playbackPrev" });
        expect(s.playback.index).toBe(2);
        const e6 = buildCanvasModel(s, false).edges.find((e) => e.id === "e6")!;
        expect(e6.classes).toContain("play-removed");
        expect(e6.label).toBe("× e6");
        s = run(s, { type: "playbackReset" });
        expect(s.playback).toEqual({ index: 0, playing: false });
        s = run(s, { type: "playbackGoto", index: 99 });
        expect(s.playback.index).toBe(3);
        s = run(s, { type: "playbackPlay" });
        expect(s.playback).toEqual({ index: 0, playing: true });
    });

    it("ignores playback controls for a stale result", () => {
        const s = run(
            solved(run(start(), { type: "setBudget", budget: 1 }), "budget"),
            { type: "setBudget", budget: 2 }
        );
        expect(isResultStale(s)).toBe(true);
        expect(s.playback.playing).toBe(false);
        expect(editorReducer(s, { type: "playbackNext" })).toBe(s);
    });
});
