import {
    DEFAULT_LIMITS,
    type GraphLimits,
} from "../domain/constants";
import { canonicalSelection } from "../domain/problem";
import type { Graph } from "../domain/graph";
import type { ProjectFile } from "../domain/project";
import { maxBudget, PROPERTIES } from "../properties";
import { positionsFor, type Positions } from "./layout";
import type { Doc, EditorState, Notice } from "./types";

export function emptyDoc(): Doc {
    return {
        projectName: "Untitled project",
        graph: { vertices: [], edges: [] },
        property: "path",
        moveModel: "token-jumping",
        sourceEdgeIds: [],
        targetEdgeIds: [],
    };
}

export function createInitialState(
    project?: ProjectFile,
    limits: GraphLimits = DEFAULT_LIMITS
): EditorState {
    const doc = emptyDoc();
    const positions: Positions = {};
    const base: EditorState = {
        doc,
        positions,
        past: [],
        future: [],
        editMode: "host",
        budget: 0,
        revision: 0,
        selection: null,
        notice: null,
        run: { status: "idle", mode: null, progress: null },
        result: null,
        resultRevision: -1,
        playback: { index: 0, playing: false },
        limits,
        savedDoc: doc,
        savedPositions: positions,
    };
    return project ? applyProject(base, project) : base;
}

export function applyProject(
    state: EditorState,
    project: ProjectFile,
    notice: Notice | null = null
): EditorState {
    const graph: Graph = {
        vertices: project.graph.vertices.map((v) => ({
            id: v.id,
            label: v.label,
        })),
        edges: project.graph.edges.map((e) => ({ id: e.id, u: e.u, v: e.v })),
    };
    const doc: Doc = {
        projectName: project.projectName,
        graph,
        property: project.property,
        moveModel: project.moveModel ?? "token-jumping",
        sourceEdgeIds: canonicalSelection(project.sourceEdgeIds, graph),
        targetEdgeIds: canonicalSelection(project.targetEdgeIds, graph),
    };
    const positions = positionsFor(project.graph);
    const upper = maxBudget(PROPERTIES[doc.property], doc.sourceEdgeIds.length);
    return {
        ...state,
        doc,
        positions,
        past: [],
        future: [],
        budget: Math.min(
            upper,
            Math.max(0, Math.floor(project.bufferBudget ?? 0))
        ),
        revision: state.revision + 1,
        selection: null,
        notice,
        result: null,
        resultRevision: -1,
        playback: { index: 0, playing: false },
        savedDoc: doc,
        savedPositions: positions,
    };
}

