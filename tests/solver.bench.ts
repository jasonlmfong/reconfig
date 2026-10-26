import { expect, test } from 'vitest';
import type { Edge, Vertex } from '../src/domain/graph';
import type { Problem, PropertyId } from '../src/domain/problem';
import type { SolverResult } from '../src/domain/result';
import { disconnectedPaths, fixtureB, spider, stressInstance } from '../src/examples/fixtures';
import { pathProperty, treeProperty } from '../src/properties';
import { solveProblem } from '../src/solver/solve';
import { problemFromMasks, problemOf, randomGraph, rng, validMasksOfSize } from './helpers';

/** 3×4 grid plus one diagonal: 12 vertices, 18 edges. Source/target are two Hamiltonian paths. */
function gridAtCaps(property: PropertyId): Problem {
  const vertices: Vertex[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) vertices.push({ id: `r${r}c${c}`, label: `${r}${c}` });
  const edges: Edge[] = [];
  const add = (a: string, b: string) => edges.push({ id: `e${edges.length + 1}`, u: a, v: b });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) add(`r${r}c${c}`, `r${r}c${c + 1}`);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) add(`r${r}c${c}`, `r${r + 1}c${c}`);
  add('r0c0', 'r1c1');
  const id = (a: string, b: string) => edges.find((e) => (e.u === a && e.v === b) || (e.u === b && e.v === a))!.id;
  const walk = (cells: string[]) => cells.slice(1).map((cell, i) => id(cells[i], cell));
  const rows = ['r0c0', 'r0c1', 'r0c2', 'r0c3', 'r1c3', 'r1c2', 'r1c1', 'r1c0', 'r2c0', 'r2c1', 'r2c2', 'r2c3'];
  const cols = ['r0c0', 'r1c0', 'r2c0', 'r2c1', 'r1c1', 'r0c1', 'r0c2', 'r1c2', 'r2c2', 'r2c3', 'r1c3', 'r0c3'];
  return { graph: { vertices, edges }, property, sourceEdgeIds: walk(rows), targetEdgeIds: walk(cols) };
}

const findMin = (problem: Problem) => solveProblem(problem, { mode: 'find-minimum', budget: 0 });
const solveAt = (problem: Problem, budget: number) => solveProblem(problem, { mode: 'budget', budget });

const RUN = { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 };

const cases: { name: string; run: () => SolverResult }[] = [
  { name: 'Fixture B — find minimum', run: () => findMin(problemOf(fixtureB())) },
  { name: 'Spider m = 3 — find minimum', run: () => findMin(problemOf(spider(3))) },
  { name: 'Disconnected paths k = 3 — find minimum', run: () => findMin(problemOf(disconnectedPaths(3))) },
  { name: 'Caps: two K3,3, Tree — find minimum (budgets 0..4)', run: () => findMin(problemOf(stressInstance('tree'))) },
  { name: 'Caps: two K3,3, Path — find minimum (budgets 0..4)', run: () => findMin(problemOf(stressInstance('path'))) },
  { name: 'Caps: grid + diagonal, Tree q = 11 — solve at budget 0', run: () => solveAt(gridAtCaps('tree'), 0) },
  { name: 'Caps: grid + diagonal, Tree q = 11 — solve at budget 10', run: () => solveAt(gridAtCaps('tree'), 10) },
  { name: 'Caps: grid + diagonal, Path q = 11 — find minimum', run: () => findMin(gridAtCaps('path')) },
];

for (const c of cases) {
  test(c.name, async ({ bench }) => {
    const result = c.run();
    expect(result.status).toBe('reachable');
    if (result.status === 'reachable') {
      console.log(`${c.name}: ${result.exploredStates.toLocaleString('en-US')} states explored; ${result.moveCount} moves at budget ${result.budget}`);
    }
    await bench(c.name, () => void c.run()).run(RUN);
  });
}

test('Caps: seeded random sweep (12 vertices, 18 edges) — slowest instance', async ({ bench }) => {
  const random = rng(18);
  let worst: { ms: number; label: string; run: () => SolverResult } | null = null;
  for (let i = 0; i < 60; i++) {
    const connected = i % 3 !== 0;
    const graph = randomGraph(random, 12, connected ? 7 : 18, connected);
    if (graph.edges.length !== 18) continue;
    const property: PropertyId = i % 2 === 0 ? 'tree' : 'path';
    const props = { tree: treeProperty, path: pathProperty };
    const q = 5 + Math.floor(random() * 6);
    const masks = validMasksOfSize(graph, props[property], q);
    if (masks.length < 2) continue;
    const s = masks[Math.floor(random() * masks.length)];
    const t = masks[Math.floor(random() * masks.length)];
    const problem = problemFromMasks(graph, property, s, t);
    for (const [label, run] of [
      [`#${i} ${property} q=${q} find minimum`, () => findMin(problem)],
      [`#${i} ${property} q=${q} budget ${q - 1}`, () => solveAt(problem, q - 1)],
    ] as const) {
      const started = performance.now();
      const result = run();
      const ms = performance.now() - started;
      expect(result.status).toBe('reachable');
      if (!worst || ms > worst.ms) worst = { ms, label: `${label}: ${result.exploredStates.toLocaleString('en-US')} states`, run };
    }
  }
  expect(worst).not.toBeNull();
  console.log(`Slowest random max-cap instance: ${worst!.label} (${worst!.ms.toFixed(1)} ms first run)`);
  await bench('slowest random max-cap instance', () => void worst!.run()).run(RUN);
});
