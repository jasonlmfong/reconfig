# Python reference implementation

An independent check of the TypeScript solver (handoff §9). It deliberately uses different algorithms:

| Concern           | TypeScript app                       | This reference                                                                                                      |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Property validity | hand-written union-find on bit masks | `networkx.is_tree` / `is_forest` + degree check                                                                     |
| Move models       | `MoveModel.canReplace` per edge pair | precomputed replacement partners per edge (any edge for Token Jumping, edges sharing an endpoint for Token Sliding) |
| Minimum buffer    | BFS per budget, ascending            | budgets swept upward while **union-find** maintains components of the configuration graph                           |
| Move counts       | BFS predecessor chain                | plain BFS over Python ints (only for recorded pairs)                                                                |

## Run

```bash
pip install -r reference/requirements.txt
python reference/generate_golden.py            # writes reference/golden/golden-v1.json.gz (~45 s)
```

The output is deterministic: seeded sampling and a gzip header with `mtime = 0`.

## Golden file format

```jsonc
{
  "format": "reconfiglab-golden", "version": 1, "seed": 20261026,
  "atlas": [{
    "atlasIndex": 52, "n": 5, "edges": [[0, 1], [0, 2]],   // bit i of a mask is edges[i]
    "results": [{
      "property": "path", "moveModel": "token-jumping", "q": 3,
      "pairs": 45,                        // unordered pairs S != T of size-q configurations
      "histogram": { "0": 45 },           // minimum buffer -> number of pairs; "inf" = no budget works
      "explicit": [[s, t, b, moves]],     // pairs with minimum buffer > 0 (seeded sample of 40 if more),
                                          // plus up to 3 unreachable pairs as [s, t, -1, -1]
      "sampled":  [[s, t, 0, moves]]      // up to 3 seeded pairs with minimum buffer 0
    }]
  }],
  "random": [{ "n": 7, "edges": [[0, 1]], "results": [{ "property": "tree", "moveModel": "token-sliding", "q": 4, "pairs": [[s, t, b, moves]] }] }]
}
```

`atlas` covers every non-isomorphic graph with 1–6 vertices and at least one edge, including disconnected graphs, for Path, Tree, and Forest under Token Jumping and Token Sliding. It includes every `q` that has at least two valid configurations. Cycle is omitted: a simple cycle has no legal neighbor under either model, so every Cycle pair is trivially unreachable. `tests/golden.test.ts` consumes this file.
