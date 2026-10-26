import { SCHEMA_VERSION } from '../domain/constants';
import type { Edge, Vertex } from '../domain/graph';
import type { PropertyId } from '../domain/problem';
import type { ProjectFile } from '../domain/project';

function project(
  projectName: string,
  vertices: Vertex[],
  edges: Edge[],
  property: PropertyId,
  sourceEdgeIds: string[],
  targetEdgeIds: string[],
): ProjectFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectName,
    graph: { vertices, edges },
    property,
    sourceEdgeIds,
    targetEdgeIds,
    bufferBudget: 0,
  };
}

const v = (id: string, x: number, y: number, label = id): Vertex => ({ id, label, x, y });
const e = (id: string, u: string, w: string): Edge => ({ id, u, v: w });

/** Fixture B: the connected six-vertex path instance that needs exactly one buffer slot. */
export function fixtureB(): ProjectFile {
  return project(
    'One-buffer path (Fixture B)',
    [v('A', 200, 150), v('B', 380, 150), v('C', 500, 70), v('D', 290, 430), v('E', 80, 70), v('F', 290, 300)],
    [e('e1', 'A', 'F'), e('e2', 'A', 'E'), e('e3', 'B', 'C'), e('e4', 'D', 'F'), e('e5', 'A', 'B'), e('e6', 'B', 'F')],
    'path',
    ['e1', 'e2', 'e3', 'e6'],
    ['e1', 'e3', 'e4', 'e5'],
  );
}

/** Fixture A: source equals target. */
export function fixtureA(): ProjectFile {
  const b = fixtureB();
  return { ...b, projectName: 'Same source and target (Fixture A)', targetEdgeIds: [...b.sourceEdgeIds] };
}

/** Two distinct triangles in K4 illustrate a cycle instance with no reconfiguration sequence. */
export function cycleUnreachable(): ProjectFile {
  return project(
    'Cycles in K4 (no budget works)',
    [v('A', 220, 130), v('B', 430, 130), v('C', 430, 350), v('D', 220, 350)],
    [e('e1', 'A', 'B'), e('e2', 'B', 'C'), e('e3', 'C', 'A'), e('e4', 'A', 'D'), e('e5', 'D', 'B'), e('e6', 'C', 'D')],
    'cycle',
    ['e1', 'e2', 'e3'],
    ['e1', 'e4', 'e5'],
  );
}

/** Fixture C: the source is a three-edge star, which is not a path. */
export function fixtureC(): ProjectFile {
  return project(
    'Invalid path: star source (Fixture C)',
    [v('O', 300, 250), v('A', 160, 250), v('B', 440, 250), v('C', 300, 110), v('D', 160, 400)],
    [e('e1', 'O', 'A'), e('e2', 'O', 'B'), e('e3', 'O', 'C'), e('e4', 'A', 'D')],
    'path',
    ['e1', 'e2', 'e3'],
    ['e1', 'e2', 'e4'],
  );
}

/**
 * Fixture G: spider with center c and three legs of m edges. Source is legs 1 and 3, target
 * is legs 2 and 3. Minimum buffer m - 1 under Path.
 */
export function spider(m: number): ProjectFile {
  const cx = 400;
  const cy = 300;
  const step = 110;
  const legs = [
    { prefix: 'a', dx: -1, dy: 0 },
    { prefix: 'b', dx: 0, dy: -1 },
    { prefix: 'd', dx: 1, dy: 0 },
  ];
  const vertices: Vertex[] = [v('c', cx, cy)];
  const edges: Edge[] = [];
  const legEdges: string[][] = [];
  let k = 1;
  for (const leg of legs) {
    const ids: string[] = [];
    let prev = 'c';
    for (let i = 1; i <= m; i++) {
      const id = `${leg.prefix}${i}`;
      vertices.push(v(id, cx + leg.dx * step * i, cy + leg.dy * step * i));
      const edgeId = `e${k++}`;
      edges.push(e(edgeId, prev, id));
      ids.push(edgeId);
      prev = id;
    }
    legEdges.push(ids);
  }
  return project(
    `Spider with legs of ${m} (Fixture G)`,
    vertices,
    edges,
    'path',
    [...legEdges[0], ...legEdges[2]],
    [...legEdges[1], ...legEdges[2]],
  );
}

/** Fixture H: two disjoint paths of k edges; source is one path, target the other. */
export function disconnectedPaths(k: number, property: PropertyId = 'path'): ProjectFile {
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const source: string[] = [];
  const target: string[] = [];
  let n = 1;
  for (const [row, prefix, list] of [
    [0, 'p', source],
    [1, 'r', target],
  ] as const) {
    for (let i = 0; i <= k; i++) vertices.push(v(`${prefix}${i}`, 150 + 130 * i, 180 + 220 * row));
    for (let i = 0; i < k; i++) {
      const id = `e${n++}`;
      edges.push(e(id, `${prefix}${i}`, `${prefix}${i + 1}`));
      list.push(id);
    }
  }
  return project(`Disconnected paths, k = ${k} (Fixture H)`, vertices, edges, property, source, target);
}

/** A 3×3 grid with two non-path trees of four edges; Tree on a connected host needs no buffer. */
export function gridTrees(): ProjectFile {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  const vertices = labels.map((id, i) => v(id, 200 + 150 * (i % 3), 120 + 150 * Math.floor(i / 3)));
  const edges: Edge[] = [];
  let n = 1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) edges.push(e(`e${n++}`, labels[3 * r + c], labels[3 * r + c + 1]));
  }
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) edges.push(e(`e${n++}`, labels[3 * r + c], labels[3 * (r + 1) + c]));
  }
  const id = (a: string, b: string) => edges.find((x) => (x.u === a && x.v === b) || (x.u === b && x.v === a))!.id;
  return project(
    'Tree on a 3×3 grid (budget 0)',
    vertices,
    edges,
    'tree',
    [id('A', 'B'), id('B', 'C'), id('B', 'E'), id('E', 'H')],
    [id('D', 'E'), id('E', 'F'), id('B', 'E'), id('F', 'I')],
  );
}

/**
 * Maximum-cap stress instance: two disjoint copies of K3,3 (12 vertices, 18 edges). Source and
 * target are spanning trees of different components, so Find minimum buffer must exhaust budgets
 * 0..3 before succeeding at q - 1 = 4.
 */
export function stressInstance(property: PropertyId = 'tree'): ProjectFile {
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const spanning: string[][] = [];
  let n = 1;
  ['ABCDEF', 'GHIJKL'].forEach((letters, c) => {
    const left = letters.slice(0, 3).split('');
    const right = letters.slice(3).split('');
    // Staggered columns give every K3,3 edge a distinct midpoint, so edge labels do not collide.
    left.forEach((id, i) => vertices.push(v(id, 140 + 40 * i + 470 * c, 110 + 150 * i)));
    right.forEach((id, i) => vertices.push(v(id, 400 - 40 * i + 470 * c, 160 + 150 * i)));
    const ids: Record<string, string> = {};
    for (const a of left) {
      for (const b of right) {
        const id = `e${n++}`;
        edges.push(e(id, a, b));
        ids[a + b] = id;
      }
    }
    // A Hamiltonian path L0-R0-L1-R1-L2-R2 is both a valid path and a spanning tree.
    const [l0, l1, l2] = left;
    const [r0, r1, r2] = right;
    spanning.push([ids[l0 + r0], ids[l1 + r0], ids[l1 + r1], ids[l2 + r1], ids[l2 + r2]]);
  });
  return project('Stress: two K3,3 (12 vertices / 18 edges)', vertices, edges, property, spanning[0], spanning[1]);
}
export interface ExampleEntry {
  id: string;
  title: string;
  build: () => ProjectFile;
}

export const EXAMPLES: readonly ExampleEntry[] = [
  { id: 'fixture-b', title: 'One-buffer path (Fixture B)', build: fixtureB },
  { id: 'cycle-unreachable', title: 'Cycles in K4 (no budget works)', build: cycleUnreachable },
  { id: 'fixture-a', title: 'Same source and target (Fixture A)', build: fixtureA },
  { id: 'fixture-c', title: 'Invalid star source (Fixture C)', build: fixtureC },
  { id: 'spider-2', title: 'Spider, legs of 2 (Fixture G)', build: () => spider(2) },
  { id: 'spider-3', title: 'Spider, legs of 3 (Fixture G)', build: () => spider(3) },
  { id: 'disconnected-2', title: 'Disconnected paths, k = 2 (Fixture H)', build: () => disconnectedPaths(2) },
  { id: 'disconnected-3', title: 'Disconnected paths, k = 3 (Fixture H)', build: () => disconnectedPaths(3) },
  { id: 'grid-tree', title: 'Tree on a 3×3 grid (budget 0)', build: gridTrees },
  { id: 'stress', title: 'Stress: two K3,3, Tree (12 vertices / 18 edges)', build: () => stressInstance('tree') },
  { id: 'stress-path', title: 'Stress: two K3,3, Path (12 vertices / 18 edges)', build: () => stressInstance('path') },
];
