import {
    DEFAULT_LIMITS,
    MAX_LABEL_LENGTH,
    MAX_PROJECT_NAME_LENGTH,
    SCHEMA_VERSION,
    type GraphLimits,
} from "../domain/constants";
import { describeEdge, vertexLabel, type Graph } from "../domain/graph";
import {
    canonicalSelection,
    problemFingerprint,
    type Problem,
    type PropertyId,
    type SelectionRole,
} from "../domain/problem";
import type { ProjectFile } from "../domain/project";
import type { MoveModelId } from "../domain/moveModel";
import type { SolveMode, SolveProgress, SolverResult } from "../domain/result";
import { maxBudget, PROPERTIES } from "../properties";
import { joinList, messages } from "../validation/messages";
import { nextEdgeId, nextVertexId } from "./ids";
import { positionsFor, type Positions } from "./layout";

export type EditMode = "host" | "source" | "target";

/** The undoable part of the editor: everything that defines the problem, plus labels. */
export interface Doc {
    projectName: string;
    /** Vertices carry only id and label; positions live outside the history. */
    graph: Graph;
    property: PropertyId;
    moveModel: MoveModelId;
    sourceEdgeIds: string[];
    targetEdgeIds: string[];
}

export interface Notice {
    kind: "info" | "warning" | "error";
    text: string;
    details?: string[];
}

export type CanvasSelection =
    | { kind: "vertex"; id: string }
    | { kind: "edge"; id: string }
    | null;

export interface RunState {
    status: "idle" | "running";
    mode: SolveMode | null;
    progress: SolveProgress | null;
}

export interface PlaybackState {
    /** Zero-based index into the result's steps. */
    index: number;
    playing: boolean;
}

export interface EditorState {
    doc: Doc;
    positions: Positions;
    past: Doc[];
    future: Doc[];
    editMode: EditMode;
    budget: number;
    /** Incremented whenever the problem or the budget changes; results record the revision they belong to. */
    revision: number;
    selection: CanvasSelection;
    notice: Notice | null;
    run: RunState;
    result: SolverResult | null;
    resultRevision: number;
    playback: PlaybackState;
    limits: GraphLimits;
    /** Document and layout as last loaded, created, or exported; used to warn before discarding edits. */
    savedDoc: Doc;
    savedPositions: Positions;
}

export type EditorAction =
    | { type: "addVertex"; x: number; y: number }
    | { type: "addEdge"; u: string; v: string }
    | { type: "deleteVertex"; id: string }
    | { type: "deleteEdge"; id: string }
    | { type: "deleteSelected" }
    | { type: "toggleSelection"; role: SelectionRole; edgeId: string }
    | { type: "clearSelection"; role: SelectionRole | "both" }
    | { type: "setProperty"; property: PropertyId }
    | { type: "setMoveModel"; moveModel: MoveModelId }
    | { type: "renameVertex"; id: string; label: string }
    | { type: "renameProject"; name: string }
    | { type: "moveVertex"; id: string; x: number; y: number }
    | { type: "setEditMode"; mode: EditMode }
    | { type: "setBudget"; budget: number }
    | { type: "undo" }
    | { type: "redo" }
    | { type: "newProject" }
    | { type: "loadProject"; project: ProjectFile; notice?: Notice }
    | { type: "canvasVertexTap"; id: string }
    | { type: "canvasEdgeTap"; id: string }
    | { type: "canvasBackgroundTap"; x: number; y: number }
    | { type: "clearCanvasSelection" }
    | { type: "selectElement"; selection: CanvasSelection }
    | { type: "markSaved" }
    | { type: "setNotice"; notice: Notice | null }
    | { type: "solveStarted"; mode: SolveMode }
    | { type: "solveProgress"; progress: SolveProgress }
    | { type: "solveFinished"; result: SolverResult }
    | { type: "playbackPlay" }
    | { type: "playbackPause" }
    | { type: "playbackNext" }
    | { type: "playbackPrev" }
    | { type: "playbackReset" }
    | { type: "playbackGoto"; index: number }
    | { type: "playbackTick" };

const HISTORY_LIMIT = 200;

/** Actions refused while a search runs (§4.4). */
const LOCKED_ACTIONS: ReadonlySet<EditorAction["type"]> = new Set<
    EditorAction["type"]
>([
    "addVertex",
    "addEdge",
    "deleteVertex",
    "deleteEdge",
    "deleteSelected",
    "toggleSelection",
    "clearSelection",
    "setProperty",
    "setMoveModel",
    "renameVertex",
    "renameProject",
    "moveVertex",
    "setEditMode",
    "setBudget",
    "undo",
    "redo",
    "newProject",
    "loadProject",
    "canvasVertexTap",
    "canvasEdgeTap",
    "canvasBackgroundTap",
    "selectElement",
    "solveStarted",
]);

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

function applyProject(
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

export function editorReducer(
    state: EditorState,
    action: EditorAction
): EditorState {
    if (state.run.status === "running" && LOCKED_ACTIONS.has(action.type)) {
        return {
            ...state,
            notice: { kind: "warning", text: messages.editingLocked() },
        };
    }
    const next = reduce(state, action);
    if (next === state) return state;
    return finalize(state, next, action);
}

function finalize(
    prev: EditorState,
    next: EditorState,
    action: EditorAction
): EditorState {
    const q = next.doc.sourceEdgeIds.length;
    const upper = maxBudget(PROPERTIES[next.doc.property], q);
    const budget = Math.min(upper, Math.max(0, Math.floor(next.budget)));
    const changed =
        budget !== prev.budget ||
        (prev.doc !== next.doc &&
            problemFingerprint(docProblem(prev.doc)) !==
                problemFingerprint(docProblem(next.doc)));
    const revision = changed ? next.revision + 1 : next.revision;
    let out: EditorState = { ...next, budget, revision };
    if (action.type === "solveFinished") {
        out.resultRevision = revision;
    } else if (changed && out.playback.playing) {
        out.playback = { ...out.playback, playing: false };
    }
    const sel = out.selection;
    if (sel) {
        const exists =
            sel.kind === "vertex"
                ? out.doc.graph.vertices.some((v) => v.id === sel.id)
                : out.doc.graph.edges.some((e) => e.id === sel.id);
        if (!exists || out.editMode !== "host")
            out = { ...out, selection: null };
    }
    return out;
}

function reduce(state: EditorState, action: EditorAction): EditorState {
    switch (action.type) {
        case "addVertex":
            return addVertex(state, action.x, action.y);
        case "addEdge":
            return addEdge(state, action.u, action.v);
        case "deleteVertex":
            return deleteVertex(state, action.id);
        case "deleteEdge":
            return deleteEdge(state, action.id);
        case "deleteSelected": {
            const sel = state.selection;
            if (!sel) return state;
            return sel.kind === "vertex"
                ? deleteVertex(state, sel.id)
                : deleteEdge(state, sel.id);
        }
        case "toggleSelection":
            return toggleSelection(state, action.role, action.edgeId);
        case "clearSelection": {
            const doc = state.doc;
            const clearSource =
                action.role !== "target" && doc.sourceEdgeIds.length > 0;
            const clearTarget =
                action.role !== "source" && doc.targetEdgeIds.length > 0;
            if (!clearSource && !clearTarget) return state;
            return commit(state, {
                ...doc,
                sourceEdgeIds: clearSource ? [] : doc.sourceEdgeIds,
                targetEdgeIds: clearTarget ? [] : doc.targetEdgeIds,
            });
        }
        case "setProperty":
            if (
                state.doc.property === action.property ||
                !PROPERTIES[action.property]
            )
                return state;
            return commit(state, { ...state.doc, property: action.property });
        case "setMoveModel":
            if (state.doc.moveModel === action.moveModel) return state;
            return commit(state, { ...state.doc, moveModel: action.moveModel });
        case "renameVertex": {
            const label = action.label.trim().slice(0, MAX_LABEL_LENGTH);
            const vertex = state.doc.graph.vertices.find(
                (v) => v.id === action.id
            );
            if (!vertex || vertex.label === label) return state;
            if (label === "")
                return {
                    ...state,
                    notice: {
                        kind: "error",
                        text: "Vertex labels cannot be empty.",
                    },
                };
            const vertices = state.doc.graph.vertices.map((v) =>
                v.id === action.id ? { ...v, label } : v
            );
            return commit(state, {
                ...state.doc,
                graph: { ...state.doc.graph, vertices },
            });
        }
        case "renameProject": {
            const name = action.name.slice(0, MAX_PROJECT_NAME_LENGTH);
            if (name === state.doc.projectName) return state;
            return commit(state, { ...state.doc, projectName: name });
        }
        case "moveVertex": {
            const p = state.positions[action.id];
            if (p && p.x === action.x && p.y === action.y) return state;
            return {
                ...state,
                positions: {
                    ...state.positions,
                    [action.id]: { x: action.x, y: action.y },
                },
            };
        }
        case "setEditMode":
            if (state.editMode === action.mode) return state;
            return { ...state, editMode: action.mode, selection: null };
        case "setBudget":
            if (state.budget === action.budget) return state;
            return { ...state, budget: action.budget };
        case "undo": {
            if (state.past.length === 0) return state;
            const doc = state.past[state.past.length - 1];
            return {
                ...state,
                doc,
                past: state.past.slice(0, -1),
                future: [state.doc, ...state.future],
                notice: null,
            };
        }
        case "redo": {
            if (state.future.length === 0) return state;
            const [doc, ...future] = state.future;
            return {
                ...state,
                doc,
                past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
                future,
                notice: null,
            };
        }
        case "newProject":
            return {
                ...createInitialState(undefined, state.limits),
                editMode: state.editMode,
                revision: state.revision + 1,
            };
        case "loadProject":
            return applyProject(state, action.project, action.notice ?? null);
        case "canvasVertexTap": {
            if (state.editMode !== "host") return state;
            const sel = state.selection;
            if (sel?.kind === "vertex") {
                if (sel.id === action.id) return { ...state, selection: null };
                return addEdge(
                    { ...state, selection: null },
                    sel.id,
                    action.id
                );
            }
            return { ...state, selection: { kind: "vertex", id: action.id } };
        }
        case "canvasEdgeTap": {
            if (state.editMode === "host") {
                const sel = state.selection;
                const same = sel?.kind === "edge" && sel.id === action.id;
                return {
                    ...state,
                    selection: same ? null : { kind: "edge", id: action.id },
                };
            }
            return toggleSelection(state, state.editMode, action.id);
        }
        case "canvasBackgroundTap":
            if (state.selection) return { ...state, selection: null };
            if (state.editMode !== "host") return state;
            return addVertex(state, action.x, action.y);
        case "clearCanvasSelection":
            return state.selection ? { ...state, selection: null } : state;
        case "selectElement":
            return { ...state, editMode: "host", selection: action.selection };
        case "markSaved":
            return {
                ...state,
                savedDoc: state.doc,
                savedPositions: state.positions,
            };
        case "setNotice":
            return { ...state, notice: action.notice };
        case "solveStarted":
            return {
                ...state,
                run: { status: "running", mode: action.mode, progress: null },
                result: null,
                playback: { index: 0, playing: false },
                notice: null,
                selection: null,
            };
        case "solveProgress":
            if (state.run.status !== "running") return state;
            return {
                ...state,
                run: { ...state.run, progress: action.progress },
            };
        case "solveFinished": {
            const result = action.result;
            const reachable = result.status === "reachable";
            return {
                ...state,
                run: { status: "idle", mode: null, progress: null },
                result,
                budget:
                    reachable && result.mode === "find-minimum"
                        ? result.budget
                        : state.budget,
                playback: {
                    index: 0,
                    playing: reachable && result.steps.length > 1,
                },
            };
        }
        default:
            return reducePlayback(state, action);
    }
}

function reducePlayback(state: EditorState, action: EditorAction): EditorState {
    const result = state.result;
    if (!result || result.status !== "reachable" || isResultStale(state))
        return state;
    const last = result.steps.length - 1;
    const pb = state.playback;
    switch (action.type) {
        case "playbackPlay":
            if (last === 0) return state;
            return {
                ...state,
                playback: {
                    index: pb.index >= last ? 0 : pb.index,
                    playing: true,
                },
            };
        case "playbackPause":
            return pb.playing
                ? { ...state, playback: { ...pb, playing: false } }
                : state;
        case "playbackNext":
            return {
                ...state,
                playback: {
                    index: Math.min(last, pb.index + 1),
                    playing: false,
                },
            };
        case "playbackPrev":
            return {
                ...state,
                playback: { index: Math.max(0, pb.index - 1), playing: false },
            };
        case "playbackReset":
            return { ...state, playback: { index: 0, playing: false } };
        case "playbackGoto":
            return {
                ...state,
                playback: {
                    index: Math.min(last, Math.max(0, action.index)),
                    playing: false,
                },
            };
        case "playbackTick": {
            if (!pb.playing) return state;
            const index = Math.min(last, pb.index + 1);
            return { ...state, playback: { index, playing: index < last } };
        }
        default:
            return state;
    }
}

function commit(
    state: EditorState,
    doc: Doc,
    extra: Partial<EditorState> = {}
): EditorState {
    return {
        ...state,
        notice: null,
        ...extra,
        doc,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
    };
}

function limitNotice(state: EditorState): EditorState {
    return {
        ...state,
        notice: {
            kind: "error",
            text: messages.graphLimit(
                state.limits.maxVertices,
                state.limits.maxEdges
            ),
        },
    };
}

function addVertex(state: EditorState, x: number, y: number): EditorState {
    const graph = state.doc.graph;
    if (graph.vertices.length >= state.limits.maxVertices)
        return limitNotice(state);
    // Skip IDs that still have a stored position so undoing a deletion restores the old layout.
    const id = nextVertexId(graph, Object.keys(state.positions));
    return commit(
        state,
        {
            ...state.doc,
            graph: {
                ...graph,
                vertices: [...graph.vertices, { id, label: id }],
            },
        },
        { positions: { ...state.positions, [id]: { x, y } }, selection: null }
    );
}

function addEdge(state: EditorState, u: string, v: string): EditorState {
    const graph = state.doc.graph;
    if (u === v) return state;
    if (
        !graph.vertices.some((x) => x.id === u) ||
        !graph.vertices.some((x) => x.id === v)
    )
        return state;
    const existing = graph.edges.find(
        (e) => (e.u === u && e.v === v) || (e.u === v && e.v === u)
    );
    if (existing) {
        return {
            ...state,
            notice: {
                kind: "warning",
                text: `Vertices ${vertexLabel(graph, u)} and ${vertexLabel(graph, v)} are already joined by edge ${existing.id}.`,
            },
        };
    }
    if (graph.edges.length >= state.limits.maxEdges) return limitNotice(state);
    const id = nextEdgeId(graph);
    return commit(
        state,
        {
            ...state.doc,
            graph: { ...graph, edges: [...graph.edges, { id, u, v }] },
        },
        { selection: null }
    );
}

/** Notice text for selections removed by a cascade, e.g. "Edge e4 was removed from the source and target selections." */
export function cascadeNotice(
    fromSource: string[],
    fromTarget: string[]
): string | null {
    const phrase = (ids: string[]) =>
        ids.length === 1 ? `Edge ${ids[0]} was` : `Edges ${joinList(ids)} were`;
    const sameIds =
        fromSource.length === fromTarget.length &&
        fromSource.every((id) => fromTarget.includes(id));
    if (fromSource.length > 0 && sameIds) {
        return `${phrase(fromSource)} removed from the source and target selections.`;
    }
    const parts: string[] = [];
    if (fromSource.length > 0)
        parts.push(`${phrase(fromSource)} removed from the source selection.`);
    if (fromTarget.length > 0)
        parts.push(`${phrase(fromTarget)} removed from the target selection.`);
    return parts.length > 0 ? parts.join(" ") : null;
}

function deleteEdge(state: EditorState, id: string): EditorState {
    const doc = state.doc;
    const edge = doc.graph.edges.find((e) => e.id === id);
    if (!edge) return state;
    const fromSource = doc.sourceEdgeIds.includes(id) ? [id] : [];
    const fromTarget = doc.targetEdgeIds.includes(id) ? [id] : [];
    const cascade = cascadeNotice(fromSource, fromTarget);
    const text = cascade ?? `Deleted edge ${describeEdge(doc.graph, id)}.`;
    return commit(
        state,
        {
            ...doc,
            graph: {
                ...doc.graph,
                edges: doc.graph.edges.filter((e) => e.id !== id),
            },
            sourceEdgeIds: doc.sourceEdgeIds.filter((x) => x !== id),
            targetEdgeIds: doc.targetEdgeIds.filter((x) => x !== id),
        },
        {
            notice: { kind: cascade ? "warning" : "info", text },
            selection: null,
        }
    );
}

function deleteVertex(state: EditorState, id: string): EditorState {
    const doc = state.doc;
    const vertex = doc.graph.vertices.find((v) => v.id === id);
    if (!vertex) return state;
    const incident = doc.graph.edges
        .filter((e) => e.u === id || e.v === id)
        .map((e) => e.id);
    const fromSource = doc.sourceEdgeIds.filter((x) => incident.includes(x));
    const fromTarget = doc.targetEdgeIds.filter((x) => incident.includes(x));
    const cascade = cascadeNotice(fromSource, fromTarget);
    let text = `Deleted vertex ${vertex.label}`;
    if (incident.length === 1) text += ` and its incident edge ${incident[0]}`;
    else if (incident.length > 1)
        text += ` and its incident edges ${joinList(incident)}`;
    text += ".";
    if (cascade) text += ` ${cascade}`;
    return commit(
        state,
        {
            ...doc,
            graph: {
                vertices: doc.graph.vertices.filter((v) => v.id !== id),
                edges: doc.graph.edges.filter((e) => !incident.includes(e.id)),
            },
            sourceEdgeIds: doc.sourceEdgeIds.filter(
                (x) => !incident.includes(x)
            ),
            targetEdgeIds: doc.targetEdgeIds.filter(
                (x) => !incident.includes(x)
            ),
        },
        {
            notice: { kind: cascade ? "warning" : "info", text },
            selection: null,
        }
    );
}

function toggleSelection(
    state: EditorState,
    role: SelectionRole,
    edgeId: string
): EditorState {
    const doc = state.doc;
    if (!doc.graph.edges.some((e) => e.id === edgeId)) return state;
    const key = role === "source" ? "sourceEdgeIds" : "targetEdgeIds";
    const current = doc[key];
    const ids = current.includes(edgeId)
        ? current.filter((x) => x !== edgeId)
        : canonicalSelection([...current, edgeId], doc.graph);
    return commit(state, { ...doc, [key]: ids });
}

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
