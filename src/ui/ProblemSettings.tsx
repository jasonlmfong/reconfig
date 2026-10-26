import { useEffect, useState, type Dispatch } from "react";
import { MAX_LABEL_LENGTH } from "../domain/constants";
import { describeEdge } from "../domain/graph";
import type { PropertyId } from "../domain/problem";
import type { MoveModelId } from "../domain/moveModel";
import type { EditMode, EditorAction, EditorState } from "../editor/state";
import { PROPERTIES } from "../properties";
import { MOVE_MODELS } from "../moveModels";
import { messages } from "../validation/messages";

const MODES: { id: EditMode; label: string }[] = [
    { id: "host", label: "Host Graph" },
    { id: "source", label: "Source" },
    { id: "target", label: "Target" },
];

export function ProblemSettings({
    state,
    dispatch,
    locked,
}: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
    locked: boolean;
}) {
    return (
        <section className="card" aria-labelledby="settings-heading">
            <h2 id="settings-heading">Problem</h2>
            <fieldset className="field" disabled={locked}>
                <legend>Property</legend>
                <div className="segmented">
                    {(Object.keys(PROPERTIES) as PropertyId[]).map((id) => (
                        <label
                            key={id}
                            className={
                                state.doc.property === id ? "active" : undefined
                            }
                        >
                            <input
                                type="radio"
                                name="property"
                                value={id}
                                checked={state.doc.property === id}
                                onChange={() =>
                                    dispatch({
                                        type: "setProperty",
                                        property: id,
                                    })
                                }
                            />
                            {PROPERTIES[id].name}
                        </label>
                    ))}
                </div>
            </fieldset>
            <fieldset className="field" disabled={locked}>
                <legend>Edit mode</legend>
                <div className="segmented">
                    {MODES.map((m) => (
                        <label
                            key={m.id}
                            className={`${state.editMode === m.id ? "active" : ""} mode-${m.id}`}
                        >
                            <input
                                type="radio"
                                name="edit-mode"
                                value={m.id}
                                checked={state.editMode === m.id}
                                onChange={() =>
                                    dispatch({
                                        type: "setEditMode",
                                        mode: m.id,
                                    })
                                }
                            />
                            {m.label}
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="field">
                <label className="field-label" htmlFor="move-model">
                    Move model
                </label>
                <select
                    id="move-model"
                    value={state.doc.moveModel}
                    disabled={locked}
                    onChange={(e) =>
                        dispatch({
                            type: "setMoveModel",
                            moveModel: e.target.value as MoveModelId,
                        })
                    }
                >
                    {(Object.keys(MOVE_MODELS) as MoveModelId[]).map((id) => (
                        <option key={id} value={id}>
                            {MOVE_MODELS[id].name}
                        </option>
                    ))}
                </select>
                <p className="hint">
                    {MOVE_MODELS[state.doc.moveModel].description} Every
                    intermediate selection must remain a valid{" "}
                    {PROPERTIES[state.doc.property].noun}.
                </p>
                {state.doc.property === "cycle" && (
                    <p className="hint">{messages.cycleNoMoves()}</p>
                )}
            </div>
            {state.editMode === "host" && (
                <SelectedElement
                    state={state}
                    dispatch={dispatch}
                    locked={locked}
                />
            )}
        </section>
    );
}

function SelectedElement({
    state,
    dispatch,
    locked,
}: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
    locked: boolean;
}) {
    const sel = state.selection;
    const vertex =
        sel?.kind === "vertex"
            ? state.doc.graph.vertices.find((v) => v.id === sel.id)
            : undefined;
    const [draft, setDraft] = useState(vertex?.label ?? "");
    useEffect(() => setDraft(vertex?.label ?? ""), [vertex?.id, vertex?.label]);

    if (!sel) {
        return (
            <p className="hint">
                Select a vertex or edge to rename or delete it.
            </p>
        );
    }
    if (sel.kind === "edge") {
        return (
            <div className="selected-element">
                <div>
                    Selected edge{" "}
                    <strong>{describeEdge(state.doc.graph, sel.id)}</strong>
                </div>
                <button
                    type="button"
                    className="danger"
                    disabled={locked}
                    onClick={() => dispatch({ type: "deleteSelected" })}
                >
                    Delete edge
                </button>
            </div>
        );
    }
    if (!vertex) return null;
    const commit = () => {
        if (draft.trim() !== vertex.label)
            dispatch({ type: "renameVertex", id: vertex.id, label: draft });
    };
    return (
        <div className="selected-element">
            <label>
                Selected vertex <span className="muted">(ID {vertex.id})</span>
                <input
                    aria-label="Vertex label"
                    value={draft}
                    disabled={locked}
                    maxLength={MAX_LABEL_LENGTH}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter")
                            (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setDraft(vertex.label);
                    }}
                />
            </label>
            <p className="hint">
                Click another vertex to join them with an edge.
            </p>
            <button
                type="button"
                className="danger"
                disabled={locked}
                onClick={() => dispatch({ type: "deleteSelected" })}
            >
                Delete vertex
            </button>
        </div>
    );
}
