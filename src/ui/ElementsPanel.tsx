import { useState, type Dispatch } from "react";
import { describeEdge } from "../domain/graph";
import type { EditorAction, EditorState } from "../editor/state";
import type { Point } from "../editor/layout";

/** Keyboard-accessible alternative to canvas editing: add, select, delete, and assign edges. */
export function ElementsPanel({
    state,
    dispatch,
    locked,
}: {
    state: EditorState;
    dispatch: Dispatch<EditorAction>;
    locked: boolean;
}) {
    const { graph, sourceEdgeIds, targetEdgeIds } = state.doc;
    const [u, setU] = useState("");
    const [v, setV] = useState("");
    const has = (id: string) => graph.vertices.some((x) => x.id === id);
    const from = has(u) ? u : "";
    const to = has(v) ? v : "";
    const source = new Set(sourceEdgeIds);
    const target = new Set(targetEdgeIds);
    const taken = graph.vertices.flatMap((x) =>
        state.positions[x.id] ? [state.positions[x.id]] : []
    );

    return (
        <section className="card elements" aria-labelledby="elements-heading">
            <details>
                <summary>
                    <h2 id="elements-heading">Graph elements</h2>
                </summary>
                <fieldset className="field" disabled={locked}>
                    <div className="button-row">
                        <button
                            type="button"
                            onClick={() =>
                                dispatch({
                                    type: "addVertex",
                                    ...freeSpot(taken),
                                })
                            }
                        >
                            Add vertex
                        </button>
                    </div>
                    <div className="add-edge">
                        <select
                            aria-label="First endpoint"
                            value={from}
                            onChange={(e) => setU(e.target.value)}
                        >
                            <option value="">Vertex…</option>
                            {graph.vertices.map((x) => (
                                <option key={x.id} value={x.id}>
                                    {x.label}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="Second endpoint"
                            value={to}
                            onChange={(e) => setV(e.target.value)}
                        >
                            <option value="">Vertex…</option>
                            {graph.vertices.map((x) => (
                                <option key={x.id} value={x.id}>
                                    {x.label}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={!from || !to || from === to}
                            onClick={() =>
                                dispatch({ type: "addEdge", u: from, v: to })
                            }
                        >
                            Add edge
                        </button>
                    </div>
                    {graph.vertices.length > 0 && (
                        <table className="elements-table">
                            <caption>Vertices</caption>
                            <tbody>
                                {graph.vertices.map((x) => (
                                    <tr key={x.id}>
                                        <th scope="row">{x.label}</th>
                                        <td>
                                            <button
                                                type="button"
                                                aria-label={`Select vertex ${x.label}`}
                                                onClick={() =>
                                                    dispatch({
                                                        type: "selectElement",
                                                        selection: {
                                                            kind: "vertex",
                                                            id: x.id,
                                                        },
                                                    })
                                                }
                                            >
                                                Select
                                            </button>
                                        </td>
                                        <td>
                                            <button
                                                type="button"
                                                className="danger"
                                                aria-label={`Delete vertex ${x.label}`}
                                                onClick={() =>
                                                    dispatch({
                                                        type: "deleteVertex",
                                                        id: x.id,
                                                    })
                                                }
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {graph.edges.length > 0 && (
                        <table className="elements-table">
                            <caption>Edges</caption>
                            <thead>
                                <tr>
                                    <th scope="col">Edge</th>
                                    <th scope="col">Source</th>
                                    <th scope="col">Target</th>
                                    <th scope="col">
                                        <span className="visually-hidden">
                                            Delete
                                        </span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {graph.edges.map((e) => {
                                    const name = describeEdge(graph, e.id);
                                    return (
                                        <tr key={e.id}>
                                            <th scope="row">{name}</th>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    aria-label={`${name} in source`}
                                                    checked={source.has(e.id)}
                                                    onChange={() =>
                                                        dispatch({
                                                            type: "toggleSelection",
                                                            role: "source",
                                                            edgeId: e.id,
                                                        })
                                                    }
                                                />
                                            </td>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    aria-label={`${name} in target`}
                                                    checked={target.has(e.id)}
                                                    onChange={() =>
                                                        dispatch({
                                                            type: "toggleSelection",
                                                            role: "target",
                                                            edgeId: e.id,
                                                        })
                                                    }
                                                />
                                            </td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="danger"
                                                    aria-label={`Delete edge ${name}`}
                                                    onClick={() =>
                                                        dispatch({
                                                            type: "deleteEdge",
                                                            id: e.id,
                                                        })
                                                    }
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </fieldset>
            </details>
        </section>
    );
}

/** First point on a coarse grid that is not close to an existing vertex. */
function freeSpot(taken: Point[]): Point {
    for (let row = 0; ; row++) {
        for (let col = 0; col < 6; col++) {
            const p = { x: 120 + col * 110, y: 100 + row * 110 };
            if (taken.every((t) => Math.hypot(t.x - p.x, t.y - p.y) > 60))
                return p;
        }
    }
}
