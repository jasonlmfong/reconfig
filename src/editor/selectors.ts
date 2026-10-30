import { SCHEMA_VERSION } from "../domain/constants";
import type { Problem } from "../domain/problem";
import type { ProjectFile } from "../domain/project";
import { maxBudget, PROPERTIES } from "../properties";
import type { Doc, EditorState } from "./types";

// ---------- Selectors ----------

export function docProblem(doc: Doc): Problem {
    return {
        graph: doc.graph,
        property: doc.property,
        moveModel: doc.moveModel,
        sourceEdgeIds: doc.sourceEdgeIds,
        targetEdgeIds: doc.targetEdgeIds,
    };
}

export function isLocked(state: EditorState): boolean {
    return state.run.status === "running";
}

/** True when the document or layout differs from what was last loaded, created, or exported. */
export function isDirty(state: EditorState): boolean {
    return (
        state.doc !== state.savedDoc || state.positions !== state.savedPositions
    );
}

export function isResultStale(state: EditorState): boolean {
    return state.result !== null && state.resultRevision !== state.revision;
}

export function canUndo(state: EditorState): boolean {
    return !isLocked(state) && state.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
    return !isLocked(state) && state.future.length > 0;
}

export function budgetUpperBound(state: EditorState): number {
    return maxBudget(
        PROPERTIES[state.doc.property],
        state.doc.sourceEdgeIds.length
    );
}

export function toProjectFile(state: EditorState): ProjectFile {
    const { doc, positions } = state;
    return {
        schemaVersion: SCHEMA_VERSION,
        projectName: doc.projectName,
        graph: {
            vertices: doc.graph.vertices.map((v) => {
                const p = positions[v.id];
                return p
                    ? { id: v.id, label: v.label, x: p.x, y: p.y }
                    : { id: v.id, label: v.label };
            }),
            edges: doc.graph.edges.map((e) => ({ id: e.id, u: e.u, v: e.v })),
        },
        property: doc.property,
        moveModel: doc.moveModel,
        sourceEdgeIds: [...doc.sourceEdgeIds],
        targetEdgeIds: [...doc.targetEdgeIds],
        bufferBudget: state.budget,
    };
}
