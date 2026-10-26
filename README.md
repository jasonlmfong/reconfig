# ReconfigLab

A browser-based workbench for **subgraph reconfiguration** on small graphs. You build a host graph, mark a source and a target edge set, choose a property (**Path**, **Tree**, **Cycle**, or **Forest**), a move model (**Token Jumping** or **Token Sliding**), and a **buffer budget**. An exact solver tells you whether the target can be reached and plays back a shortest move sequence when it can. **Find minimum buffer** reports the smallest budget that works.

Everything runs locally in the browser, there is no backend.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit, property, golden, editor, and import/export tests
npm run bench        # solver benchmarks (Vitest 5 bench fixture)
npm run build        # type-check + production build (solver runs in its own worker chunk)
npm run golden       # regenerate reference/golden/golden-v1.json.gz (needs Python 3 + networkx)
```

## Using the workbench

1. **Load example…** or **New**. The app opens a six-vertex path that needs one buffer slot.
2. **Host Graph** mode: click empty canvas to add a vertex, click two vertices to join them, and select a vertex or edge, then press `Delete` to remove it. Rename a vertex from the left panel. Drag vertices to rearrange them. The collapsible **Graph elements** panel offers the same editing from the keyboard: add vertices and edges, select or delete them, and tick source/target checkboxes.
3. **Source** / **Target** modes: click edges to toggle them in that configuration.
4. Choose a **property** and a **move model**. Live validation explains what's wrong, for example `Source must be a valid path: vertex B has degree 3.`
5. Set the **buffer budget** slider and press **Solve**, or press **Find minimum buffer**. While a search runs, editing is locked and only **Cancel** (plus zoom and pan) stays active.
6. Step through the sequence with Previous / Play / Pause / Next / Reset, or click a step. The buffer tray shows the token count, and each step explanation shows the edges that changed.
7. **Export** saves the project as JSON. **Export result** saves the verified result with an input fingerprint.

Shortcuts: `Ctrl+Z` / `Ctrl+Y` (undo/redo), `Delete` (remove selection), `Esc` (clear selection).

**Visual encoding**: host edges are thin gray, source-only edges are solid blue, target-only edges are dashed vermillion, and edges in both are reddish purple with a midpoint diamond. During playback the current configuration gets a black outline, an added edge is thick bluish-green with a `+ id` label, and a removed edge is a dotted gray ghost with a `× id` label.

### Solver guarantees

- State = bit mask over the canonical `edges` array order. Validity is cached per mask in a `Uint8Array` that is shared across budget passes. The visited/predecessor and queue `Int32Array`s are allocated once per solve and reset for each pass.
- Neighbor order is fixed: stores, then direct replacements allowed by the selected move model (removed edge outer loop, added edge inner loop), then retrieves, always scanning edge indices in ascending order. Results are therefore deterministic.
- **Solve at budget b** runs a BFS over valid configurations with `q − b ≤ |F| ≤ q`, so it returns the shortest sequence, or a conclusive `not-reachable` after exhausting the search.
- **Find minimum buffer** runs that BFS for `b = 0, 1, …, maxBudget(q)` and stops at the first success. `exploredStates` is cumulative across passes.
- `SolverClient` checks every result's mode (and, in budget mode, its budget) against the request, and checks every reachable result with `verifySequence` on the main thread before it is shown. A failure becomes `internal-error`. Cancellation and worker crashes never produce `not-reachable`. `isMinimum` cannot be replayed; it rests on the exhaustive lower-budget passes.
- Live validation enables Solve only when both the explanatory check (`explainInvalid`) and the search's own `isValid` accept the source and target.

## Benchmarks

`npm run bench`, Node 22. Mean time per solve:

| Case                                                             | States explored |    Mean |
| ---------------------------------------------------------------- | --------------: | ------: |
| Fixture B, find minimum                                          |               6 | 0.08 ms |
| Spider m = 3, find minimum                                       |              14 |  0.3 ms |
| Max caps: two K3,3, Tree, find minimum (budgets 0..4 exhaustive) |             958 |  1.9 ms |
| Max caps: 3×4 grid + diagonal, Tree q = 11, budget 10            |          13,153 |   21 ms |
| Slowest of 60 seeded random 12-vertex / 18-edge instances        |          18,273 |   22 ms |
