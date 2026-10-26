import {
    useCallback,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import { MAX_IMPORT_BYTES, SOLVER_VERSION } from "../domain/constants";
import { problemFingerprint } from "../domain/problem";
import { serializeProject } from "../domain/project";
import type { SolveMode, SolverResult } from "../domain/result";
import {
    canRedo,
    canUndo,
    createInitialState,
    docProblem,
    editorReducer,
    isDirty,
    isLocked,
    isResultStale,
    toProjectFile,
    type EditorState,
} from "../editor/state";
import { EXAMPLES, fixtureB } from "../examples/fixtures";
import { failedRunResult, SolverClient } from "../solver/client";
import { parseProjectText } from "../validation/importProject";
import { messages } from "../validation/messages";
import { validateProblem } from "../validation/problemValidation";
import { BufferTray } from "./BufferTray";
import { buildCanvasModel } from "./canvasModel";
import { explainStep } from "./describe";
import { ElementsPanel } from "./ElementsPanel";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { Legend } from "./Legend";
import { NoticeBar } from "./NoticeBar";
import { ProblemSettings } from "./ProblemSettings";
import { SolveCluster } from "./SolveCluster";
import { SourceTargetEditor } from "./SourceTargetEditor";
import { Statistics } from "./Statistics";
import { StepTimeline } from "./StepTimeline";
import { TopBar } from "./TopBar";

const PLAYBACK_INTERVAL_MS = 1100;

const MODE_HINTS: Record<EditorState["editMode"], string> = {
    host: "Host Graph mode: click empty space to add a vertex · click two vertices to join them · select an element and press Delete to remove it · drag vertices to rearrange.",
    source: "Source mode: click edges to add them to or remove them from the source configuration.",
    target: "Target mode: click edges to add them to or remove them from the target configuration.",
};

function slug(name: string): string {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "reconfiglab-project"
    );
}

function download(filename: string, text: string): void {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isTextInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
    );
}

export function App() {
    const [state, dispatch] = useReducer(editorReducer, undefined, () =>
        createInitialState(fixtureB())
    );
    const clientRef = useRef<SolverClient | null>(null);
    const solvingRef = useRef(false);
    const canvasRef = useRef<GraphCanvasHandle>(null);
    const [fitRequest, setFitRequest] = useState(0);

    const problem = useMemo(() => docProblem(state.doc), [state.doc]);
    const check = useMemo(
        () => validateProblem(problem, state.limits),
        [problem, state.limits]
    );
    const locked = isLocked(state);
    const stale = isResultStale(state);
    const reachable =
        state.result?.status === "reachable" ? state.result : null;
    const playbackActive = reachable !== null && !stale;
    const currentStep = playbackActive
        ? (reachable.steps[state.playback.index] ?? null)
        : null;

    const canvasModel = useMemo(
        () => buildCanvasModel(state, stale),
        [
            state.doc,
            state.positions,
            state.selection,
            state.result,
            state.playback.index,
            stale,
        ]
    );

    useEffect(() => {
        if (fitRequest > 0) canvasRef.current?.fit();
    }, [fitRequest]);

    useEffect(() => {
        if (!state.playback.playing) return;
        const timer = setInterval(
            () => dispatch({ type: "playbackTick" }),
            PLAYBACK_INTERVAL_MS
        );
        return () => clearInterval(timer);
    }, [state.playback.playing]);

    useEffect(() => () => clientRef.current?.dispose(), []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (isTextInput(e.target)) return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            if (mod && key === "z" && !e.shiftKey) {
                e.preventDefault();
                dispatch({ type: "undo" });
            } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
                e.preventDefault();
                dispatch({ type: "redo" });
            } else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                dispatch({ type: "deleteSelected" });
            } else if (e.key === "Escape") {
                dispatch({ type: "clearCanvasSelection" });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const dirty = isDirty(state);
    const confirmDiscard = useCallback(
        (what: string) =>
            !dirty ||
            window.confirm(
                `${what} Unsaved changes will be lost — export first to keep them.`
            ),
        [dirty]
    );

    const runSolve = useCallback(
        async (mode: SolveMode) => {
            // The ref closes the gap before React re-renders with the locked state.
            if (!check.canSolve || locked || solvingRef.current) return;
            solvingRef.current = true;
            const request = { mode, budget: state.budget };
            dispatch({ type: "solveStarted", mode });
            let result: SolverResult;
            try {
                const client = (clientRef.current ??= new SolverClient());
                result = await client.solve(problem, request, (progress) =>
                    dispatch({ type: "solveProgress", progress })
                );
            } catch {
                // Every started run must end with a terminal, non-conclusive result so the editor unlocks.
                result = failedRunResult(problem, request);
            }
            solvingRef.current = false;
            dispatch({ type: "solveFinished", result });
        },
        [check.canSolve, locked, problem, state.budget]
    );

    const onImportFile = useCallback(
        async (file: File) => {
            if (file.size > MAX_IMPORT_BYTES) {
                dispatch({
                    type: "setNotice",
                    notice: {
                        kind: "error",
                        text: messages.importFailed(
                            `file is larger than ${Math.round(MAX_IMPORT_BYTES / 1024)} KB.`
                        ),
                    },
                });
                return;
            }
            const outcome = parseProjectText(await file.text(), state.limits);
            if (!outcome.ok) {
                dispatch({
                    type: "setNotice",
                    notice: {
                        kind: "error",
                        text: `Import failed: ${outcome.errors.length} problem${outcome.errors.length === 1 ? "" : "s"} found in ${file.name}. Nothing was changed.`,
                        details: outcome.errors.map(
                            (e) => `${e.field}: ${e.message}`
                        ),
                    },
                });
                return;
            }
            if (!confirmDiscard("Import this project?")) return;
            const notes: string[] = [];
            if (outcome.discardedLastResult)
                notes.push(
                    "The saved solver result was discarded; solve again to see results."
                );
            if (outcome.budgetClamped)
                notes.push(
                    `The saved buffer budget was clamped to ${outcome.project.bufferBudget}.`
                );
            dispatch({
                type: "loadProject",
                project: outcome.project,
                notice: {
                    kind: "info",
                    text: `Imported “${outcome.project.projectName}”.`,
                    details: notes,
                },
            });
            setFitRequest((n) => n + 1);
        },
        [confirmDiscard, state.limits]
    );

    return (
        <div className="app">
            <TopBar
                projectName={state.doc.projectName}
                vertexCount={state.doc.graph.vertices.length}
                edgeCount={state.doc.graph.edges.length}
                maxVertices={state.limits.maxVertices}
                maxEdges={state.limits.maxEdges}
                locked={locked}
                canUndo={canUndo(state)}
                canRedo={canRedo(state)}
                canExportResult={state.result !== null && !stale && !locked}
                onRenameProject={(name) =>
                    dispatch({ type: "renameProject", name })
                }
                onNew={() => {
                    if (!confirmDiscard("Start a new project?")) return;
                    dispatch({ type: "newProject" });
                    setFitRequest((n) => n + 1);
                }}
                onLoadExample={(id) => {
                    const example = EXAMPLES.find((x) => x.id === id);
                    if (!example || !confirmDiscard(`Load “${example.title}”?`))
                        return;
                    dispatch({ type: "loadProject", project: example.build() });
                    setFitRequest((n) => n + 1);
                }}
                onImportFile={(file) => void onImportFile(file)}
                onExportProject={() => {
                    download(
                        `${slug(state.doc.projectName)}.json`,
                        serializeProject(toProjectFile(state))
                    );
                    dispatch({ type: "markSaved" });
                }}
                onExportResult={() => {
                    if (!state.result || stale) return;
                    const payload = {
                        kind: "reconfiglab-result",
                        solverVersion: SOLVER_VERSION,
                        inputFingerprint: problemFingerprint(problem),
                        result: state.result,
                    };
                    download(
                        `${slug(state.doc.projectName)}-result.json`,
                        `${JSON.stringify(payload, null, 2)}\n`
                    );
                }}
                onUndo={() => dispatch({ type: "undo" })}
                onRedo={() => dispatch({ type: "redo" })}
            />
            <NoticeBar
                notice={state.notice}
                onDismiss={() => dispatch({ type: "setNotice", notice: null })}
            />
            <main className="workbench">
                <aside className="panel left" aria-label="Settings">
                    <ProblemSettings
                        state={state}
                        dispatch={dispatch}
                        locked={locked}
                    />
                    <SourceTargetEditor
                        state={state}
                        dispatch={dispatch}
                        check={check}
                        locked={locked}
                    />
                    <ElementsPanel
                        state={state}
                        dispatch={dispatch}
                        locked={locked}
                    />
                    <SolveCluster
                        state={state}
                        canSolve={check.canSolve}
                        onBudgetChange={(budget) =>
                            dispatch({ type: "setBudget", budget })
                        }
                        onSolve={() => void runSolve("budget")}
                        onFindMinimum={() => void runSolve("find-minimum")}
                        onCancel={() => clientRef.current?.cancel()}
                    />
                </aside>
                <section className="canvas-area" aria-label="Graph">
                    <div
                        className={`mode-hint mode-${state.editMode} ${locked ? "locked" : ""}`}
                    >
                        {locked
                            ? messages.editingLocked()
                            : MODE_HINTS[state.editMode]}
                    </div>
                    <div className="canvas-wrap">
                        <GraphCanvas
                            ref={canvasRef}
                            nodes={canvasModel.nodes}
                            edges={canvasModel.edges}
                            locked={locked}
                            onBackgroundTap={(x, y) =>
                                dispatch({ type: "canvasBackgroundTap", x, y })
                            }
                            onNodeTap={(id) =>
                                dispatch({ type: "canvasVertexTap", id })
                            }
                            onEdgeTap={(id) =>
                                dispatch({ type: "canvasEdgeTap", id })
                            }
                            onNodeMoved={(id, x, y) =>
                                dispatch({ type: "moveVertex", id, x, y })
                            }
                        />
                        <div
                            className="canvas-controls"
                            role="toolbar"
                            aria-label="View"
                        >
                            <button
                                type="button"
                                onClick={() => canvasRef.current?.zoomBy(1.25)}
                                aria-label="Zoom in"
                            >
                                +
                            </button>
                            <button
                                type="button"
                                onClick={() => canvasRef.current?.zoomBy(0.8)}
                                aria-label="Zoom out"
                            >
                                −
                            </button>
                            <button
                                type="button"
                                onClick={() => canvasRef.current?.fit()}
                            >
                                Fit
                            </button>
                        </div>
                    </div>
                    <Legend />
                </section>
                <aside className="panel right" aria-label="Results">
                    <Statistics result={state.result} stale={stale} />
                    <BufferTray
                        step={currentStep}
                        budget={
                            reachable && !stale
                                ? reachable.budget
                                : state.budget
                        }
                        active={playbackActive}
                        moveModel={state.doc.moveModel}
                        explanation={
                            currentStep && reachable
                                ? explainStep(
                                      currentStep,
                                      state.doc.graph,
                                      state.doc.property,
                                      reachable.steps.length
                                  )
                                : null
                        }
                    />
                    <StepTimeline
                        result={reachable}
                        playback={state.playback}
                        dispatch={dispatch}
                        active={playbackActive}
                    />
                </aside>
            </main>
            <footer className="footer">
                Runs entirely in your browser — nothing is uploaded. Exact
                solver v{SOLVER_VERSION} · up to {state.limits.maxVertices}{" "}
                vertices and {state.limits.maxEdges} edges.
            </footer>
        </div>
    );
}
