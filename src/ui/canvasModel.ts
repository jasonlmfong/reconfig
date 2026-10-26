import type { EditorState } from '../editor/state';
import type { CanvasEdge, CanvasNode } from './GraphCanvas';

/** Maps editor state to plain canvas data: role classes, playback overlay, and selection. */
export function buildCanvasModel(state: EditorState, stale: boolean): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { doc, positions, selection } = state;
  const source = new Set(doc.sourceEdgeIds);
  const target = new Set(doc.targetEdgeIds);
  const result = state.result;
  const step = result?.status === 'reachable' && !stale ? (result.steps[state.playback.index] ?? null) : null;
  const current = step ? new Set(step.configurationEdgeIds) : null;
  const inConfig = new Set<string>();

  const edges = doc.graph.edges.map((e): CanvasEdge => {
    const s = source.has(e.id);
    const t = target.has(e.id);
    const classes = [s && t ? 'role-both' : s ? 'role-source' : t ? 'role-target' : 'role-host'];
    let label = e.id;
    if (current?.has(e.id)) {
      classes.push('play-current');
      inConfig.add(e.u);
      inConfig.add(e.v);
    }
    if (step?.addedEdgeId === e.id) {
      classes.push('play-added');
      label = `+ ${e.id}`;
    }
    if (step?.removedEdgeId === e.id) {
      classes.push('play-removed');
      label = `× ${e.id}`;
    }
    if (selection?.kind === 'edge' && selection.id === e.id) classes.push('selected');
    return { id: e.id, u: e.u, v: e.v, label, classes };
  });

  const nodes = doc.graph.vertices.map((v): CanvasNode => {
    const p = positions[v.id] ?? { x: 0, y: 0 };
    const classes: string[] = [];
    if (inConfig.has(v.id)) classes.push('in-config');
    if (selection?.kind === 'vertex' && selection.id === v.id) classes.push('selected');
    return { id: v.id, label: v.label, x: p.x, y: p.y, classes };
  });

  return { nodes, edges };
}
