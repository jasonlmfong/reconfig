import { MASK_BIT_LIMIT } from './constants';

export interface Vertex {
  id: string;
  label: string;
  x?: number;
  y?: number;
}

/** Undirected host edge. Endpoints are `u`/`v` to avoid confusion with source/target configurations. */
export interface Edge {
  id: string;
  u: string;
  v: string;
}

/** The order of `edges` is the canonical edge order: bit i of a mask is `edges[i]`. */
export interface Graph {
  vertices: Vertex[];
  edges: Edge[];
}

/** Integer-indexed view of a host graph used by properties, the solver, and the verifier. */
export interface IndexedGraph {
  readonly n: number;
  readonly m: number;
  readonly edgeU: Int32Array;
  readonly edgeV: Int32Array;
  readonly vertexIds: readonly string[];
  readonly vertexLabels: readonly string[];
  readonly edgeIds: readonly string[];
  readonly vertexIndex: ReadonlyMap<string, number>;
  readonly edgeIndex: ReadonlyMap<string, number>;
}

export function indexGraph(graph: Graph): IndexedGraph {
  if (graph.edges.length > MASK_BIT_LIMIT) {
    throw new Error(`Host has ${graph.edges.length} edges; the mask representation supports at most ${MASK_BIT_LIMIT}.`);
  }
  const vertexIndex = new Map<string, number>();
  graph.vertices.forEach((v, i) => vertexIndex.set(v.id, i));
  const edgeIndex = new Map<string, number>();
  const edgeU = new Int32Array(graph.edges.length);
  const edgeV = new Int32Array(graph.edges.length);
  graph.edges.forEach((e, i) => {
    const u = vertexIndex.get(e.u);
    const v = vertexIndex.get(e.v);
    if (u === undefined || v === undefined) {
      throw new Error(`Edge ${e.id} references an unknown vertex.`);
    }
    edgeU[i] = u;
    edgeV[i] = v;
    edgeIndex.set(e.id, i);
  });
  return {
    n: graph.vertices.length,
    m: graph.edges.length,
    edgeU,
    edgeV,
    vertexIds: graph.vertices.map((v) => v.id),
    vertexLabels: graph.vertices.map((v) => v.label),
    edgeIds: graph.edges.map((e) => e.id),
    vertexIndex,
    edgeIndex,
  };
}

export function vertexLabel(graph: Graph, id: string): string {
  return graph.vertices.find((v) => v.id === id)?.label ?? id;
}

/** Human-readable edge description, e.g. `e2 (A–E)`. */
export function describeEdge(graph: Graph, edgeId: string): string {
  const e = graph.edges.find((x) => x.id === edgeId);
  if (!e) return edgeId;
  return `${edgeId} (${vertexLabel(graph, e.u)}–${vertexLabel(graph, e.v)})`;
}
