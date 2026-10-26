import type { Graph } from '../domain/graph';

export interface Point {
  x: number;
  y: number;
}

export type Positions = Record<string, Point>;

/** Uses stored coordinates where present and places the remaining vertices on a circle. */
export function positionsFor(graph: Graph): Positions {
  const positions: Positions = {};
  const missing = graph.vertices.filter((v) => v.x === undefined || v.y === undefined);
  for (const v of graph.vertices) {
    if (v.x !== undefined && v.y !== undefined) positions[v.id] = { x: v.x, y: v.y };
  }
  const radius = Math.max(120, 40 * missing.length);
  missing.forEach((v, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, missing.length) - Math.PI / 2;
    positions[v.id] = { x: 400 + radius * Math.cos(angle), y: 300 + radius * Math.sin(angle) };
  });
  return positions;
}
