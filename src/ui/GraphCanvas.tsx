import cytoscape, { type Core, type EventObject } from "cytoscape";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EDGE_ENCODINGS, PALETTE } from "./encoding";

export interface CanvasNode {
    id: string;
    label: string;
    x: number;
    y: number;
    classes: string[];
}

export interface CanvasEdge {
    id: string;
    u: string;
    v: string;
    label: string;
    classes: string[];
}

export interface GraphCanvasProps {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    locked: boolean;
    onBackgroundTap: (x: number, y: number) => void;
    onNodeTap: (id: string) => void;
    onEdgeTap: (id: string) => void;
    onNodeMoved: (id: string, x: number, y: number) => void;
}

export interface GraphCanvasHandle {
    fit: () => void;
    zoomBy: (factor: number) => void;
}

// Vertex and edge IDs are unique only within their kind, but Cytoscape shares one ID space.
const NODE = "n:";
const EDGE = "e:";

const enc = EDGE_ENCODINGS;

const STYLESHEET = [
    {
        selector: "node",
        style: {
            "background-color": "#ffffff",
            "border-width": 2,
            "border-color": "#333333",
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            "font-size": 14,
            "font-weight": 600,
            color: "#111111",
            width: 36,
            height: 36,
        },
    },
    {
        selector: "node.in-config",
        style: { "border-width": 3, "border-color": "#000000" },
    },
    {
        selector: "node.selected",
        style: {
            "border-color": PALETTE.pending,
            "border-width": 5,
            "border-style": "double",
        },
    },
    {
        selector: "edge",
        style: {
            width: enc.host.width,
            "line-color": enc.host.color,
            "curve-style": "straight",
            label: "data(label)",
            "text-margin-x": "data(mx)",
            "text-margin-y": "data(my)",
            "font-size": 11,
            color: "#222222",
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.9,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
            "arrow-scale": 1.6,
        },
    },
    {
        selector: "edge.role-source",
        style: {
            width: enc.source.width,
            "line-color": enc.source.color,
            "line-style": "solid",
        },
    },
    {
        selector: "edge.role-target",
        style: {
            width: enc.target.width,
            "line-color": enc.target.color,
            "line-style": "dashed",
            "line-dash-pattern": [10, 5],
        },
    },
    {
        selector: "edge.role-both",
        style: {
            width: enc.both.width,
            "line-color": enc.both.color,
            "line-style": "solid",
            "mid-target-arrow-shape": "diamond",
            "mid-target-arrow-color": enc.both.color,
            "mid-target-arrow-fill": "filled",
        },
    },
    {
        selector: "edge.play-current",
        style: {
            "line-outline-width": 3,
            "line-outline-color": PALETTE.current,
        },
    },
    {
        selector: "edge.play-added",
        style: {
            width: enc.added.width,
            "line-color": enc.added.color,
            "line-style": "solid",
            "line-outline-width": 3,
            "line-outline-color": PALETTE.current,
            "font-size": 15,
            "font-weight": 700,
        },
    },
    {
        selector: "edge.play-removed",
        style: {
            width: enc.removed.width,
            "line-color": enc.removed.color,
            "line-style": "dotted",
            "line-outline-width": 0,
            "mid-target-arrow-shape": "none",
            opacity: 0.85,
            "font-size": 15,
            "font-weight": 700,
        },
    },
    {
        selector: "edge.selected",
        style: {
            "underlay-color": PALETTE.pending,
            "underlay-padding": 6,
            "underlay-opacity": 0.6,
        },
    },
] as unknown as cytoscape.StylesheetJson;

/** Thin Cytoscape adapter: plain data in, plain events out. */
export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
    function GraphCanvas(props, ref) {
        const containerRef = useRef<HTMLDivElement>(null);
        const cyRef = useRef<Core | null>(null);
        const handlers = useRef(props);
        handlers.current = props;
        const fittedOnce = useRef(false);

        useImperativeHandle(ref, () => ({
            fit: () => fitGraph(cyRef.current),
            zoomBy: (factor: number) => {
                const cy = cyRef.current;
                if (!cy) return;
                cy.zoom({
                    level: cy.zoom() * factor,
                    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
                });
            },
        }));

        useEffect(() => {
            const cy = cytoscape({
                container: containerRef.current,
                style: STYLESHEET,
                layout: { name: "preset" },
                minZoom: 0.2,
                maxZoom: 4,
                boxSelectionEnabled: false,
                autounselectify: true,
            });
            cy.on("tap", (evt: EventObject) => {
                if (evt.target === cy)
                    handlers.current.onBackgroundTap(
                        evt.position.x,
                        evt.position.y
                    );
            });
            cy.on("tap", "node", (evt: EventObject) =>
                handlers.current.onNodeTap(evt.target.id().slice(NODE.length))
            );
            cy.on("tap", "edge", (evt: EventObject) =>
                handlers.current.onEdgeTap(evt.target.id().slice(EDGE.length))
            );
            cy.on("dragfree", "node", (evt: EventObject) => {
                const p = evt.target.position();
                handlers.current.onNodeMoved(
                    evt.target.id().slice(NODE.length),
                    p.x,
                    p.y
                );
            });
            cy.on("position", "node", (evt: EventObject) =>
                offsetLabels(evt.target.connectedEdges())
            );
            cyRef.current = cy;
            // Keep the renderer in sync with its container; fit once the container first has a real size.
            let sized = false;
            const observer = new ResizeObserver(() => {
                cy.resize();
                if (
                    !sized &&
                    cy.width() > 0 &&
                    cy.height() > 0 &&
                    cy.nodes().length > 0
                ) {
                    sized = true;
                    fitGraph(cy);
                }
            });
            if (containerRef.current) observer.observe(containerRef.current);
            return () => {
                observer.disconnect();
                cy.destroy();
                cyRef.current = null;
            };
        }, []);

        useEffect(() => {
            const cy = cyRef.current;
            if (!cy) return;
            const nodeIds = new Set(props.nodes.map((n) => NODE + n.id));
            const edgeIds = new Set(props.edges.map((e) => EDGE + e.id));
            cy.batch(() => {
                cy.edges().forEach((e) => {
                    if (!edgeIds.has(e.id())) e.remove();
                });
                cy.nodes().forEach((n) => {
                    if (!nodeIds.has(n.id())) n.remove();
                });
                for (const n of props.nodes) {
                    let el = cy.getElementById(NODE + n.id);
                    if (el.empty()) {
                        el = cy.add({
                            group: "nodes",
                            data: { id: NODE + n.id, label: n.label },
                            position: { x: n.x, y: n.y },
                        });
                    } else {
                        if (el.data("label") !== n.label)
                            el.data("label", n.label);
                        const p = el.position();
                        if (!el.grabbed() && (p.x !== n.x || p.y !== n.y))
                            el.position({ x: n.x, y: n.y });
                    }
                    el.classes(n.classes);
                }
                for (const e of props.edges) {
                    let el = cy.getElementById(EDGE + e.id);
                    const source = NODE + e.u;
                    const target = NODE + e.v;
                    if (
                        !el.empty() &&
                        (el.data("source") !== source ||
                            el.data("target") !== target)
                    ) {
                        el.remove();
                        el = cy.collection();
                    }
                    if (el.empty()) {
                        el = cy.add({
                            group: "edges",
                            data: {
                                id: EDGE + e.id,
                                source,
                                target,
                                label: e.label,
                                mx: 0,
                                my: 0,
                            },
                        });
                    } else if (el.data("label") !== e.label) {
                        el.data("label", e.label);
                    }
                    el.classes(e.classes);
                }
                offsetLabels(cy.edges());
            });
            if (!fittedOnce.current && props.nodes.length > 0) {
                fittedOnce.current = true;
                fitGraph(cy);
            }
        }, [props.nodes, props.edges]);

        useEffect(() => {
            cyRef.current?.autoungrabify(props.locked);
        }, [props.locked]);

        return (
            <div
                ref={containerRef}
                className="graph-canvas"
                role="group"
                aria-label="Graph canvas (pointer editing). Use the Graph elements panel to edit with the keyboard."
            />
        );
    }
);

/** Shifts each edge label perpendicular to its edge so midpoint markers stay visible. */
function offsetLabels(edges: cytoscape.EdgeCollection): void {
    edges.forEach((edge) => {
        const a = edge.source().position();
        const b = edge.target().position();
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len;
        let ny = dx / len;
        if (ny > 0 || (ny === 0 && nx > 0)) {
            nx = -nx;
            ny = -ny;
        }
        const distance = 7 + Math.abs(nx) * 14 + Math.abs(ny) * 8;
        edge.data({ mx: nx * distance, my: ny * distance });
    });
}

function fitGraph(cy: Core | null): void {
    if (!cy) return;
    if (cy.elements().length === 0) {
        cy.reset();
        return;
    }
    cy.fit(undefined, 50);
    if (cy.zoom() > 1.6)
        cy.zoom({
            level: 1.6,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
    cy.center();
}
