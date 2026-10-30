import type { GraphLimits } from "../domain/constants";
import type { Graph } from "../domain/graph";
import type { PropertyId, SelectionRole } from "../domain/problem";
import type { ProjectFile } from "../domain/project";
import type { MoveModelId } from "../domain/moveModel";
import type { SolveMode, SolveProgress, SolverResult } from "../domain/result";
import type { Positions } from "./layout";

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

