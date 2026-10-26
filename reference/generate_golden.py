"""Generates the golden data used by tests/golden.test.ts (handoff section 9).

Usage:
    python reference/generate_golden.py [--out reference/golden/golden-v1.json.gz]

Sections:
* ``atlas``: every non-isomorphic graph with 1..6 vertices and at least one edge (networkx graph
  atlas, disconnected graphs included), every property and move model, every q with at least two
  valid configurations. Per (graph, property, model, q): the histogram of minimum buffers over all
  unordered pairs S != T (key ``inf`` counts pairs unreachable under every budget), the pairs
  whose minimum buffer is above 0 (explicit; a seeded sample when there are more than
  MAX_EXPLICIT), up to INF_SAMPLES unreachable pairs, and a seeded sample of pairs whose minimum
  buffer is 0. Recorded pairs also carry the BFS shortest move count at the minimum budget.
* ``random``: seeded random graphs with 7 and 8 vertices, sampled pairs with their minimum buffer
  and move count.

Pairs are ``[sourceMask, targetMask, minimumBuffer, moves]``; bit i of a mask is ``edges[i]``.
Unreachable pairs use ``-1`` for both minimumBuffer and moves.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import random
import sys
import time
from collections import Counter, defaultdict
from typing import Dict, List, Sequence, Tuple

from networkx.generators.atlas import graph_atlas_g

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reconfig_reference import (  # noqa: E402
    MOVE_MODELS,
    PROPERTIES,
    Edge,
    Partners,
    bfs_distances,
    canonical_edges,
    minimum_buffers,
    replacement_partners,
    valid_by_size,
)

SEED = 20261026
ZERO_SAMPLES = 3
MAX_EXPLICIT = 40
INF_SAMPLES = 3
RANDOM_GRAPHS = 40
MAX_RANDOM_EDGES = 12


def moves_for(pairs: List[Tuple[int, int, int]], layers: Dict[int, List[int]], q: int, partners: Partners) -> Dict[Tuple[int, int], int]:
    valid = set()
    for layer in layers.values():
        valid.update(layer)
    by_start: Dict[Tuple[int, int], List[int]] = defaultdict(list)
    for s, t, b in pairs:
        if b >= 0:
            by_start[(s, b)].append(t)
    out: Dict[Tuple[int, int], int] = {(s, t): -1 for s, t, b in pairs if b < 0}
    for (s, b), targets in by_start.items():
        dist = bfs_distances(s, b, q, valid, partners)
        for t in targets:
            out[(s, t)] = dist[t]
    return out


def unreachable_sample(top: List[int], roots: Dict[int, int], rnd: random.Random, count: int) -> List[Tuple[int, int, int]]:
    """Up to ``count`` seeded pairs whose endpoints lie in different components at the largest budget."""
    groups: Dict[int, List[int]] = defaultdict(list)
    for x in sorted(top):
        groups[roots[x]].append(x)
    members = [groups[r] for r in sorted(groups)]
    if len(members) < 2:
        return []
    picks = set()
    for _ in range(count):
        a, b = rnd.sample(range(len(members)), 2)
        s, t = rnd.choice(members[a]), rnd.choice(members[b])
        picks.add((min(s, t), max(s, t), -1))
    return sorted(picks)


def analyse_atlas_graph(edges: Sequence[Edge], prop: str, model: str, rnd: random.Random) -> List[dict]:
    partners = replacement_partners(edges, model)
    layers = valid_by_size(edges, prop)
    results = []
    for q in sorted(layers):
        top = layers[q]
        if len(top) < 2:
            continue
        mb, roots = minimum_buffers(layers, q, partners)
        expected = len(top) * (len(top) - 1) // 2
        unreachable = expected - len(mb)
        # Under Token Jumping every pair is reachable at budget q - 1 (handoff section 3.5).
        assert model != "token-jumping" or unreachable == 0, (edges, prop, q, len(mb), expected)
        histogram: Dict[str, int] = {str(b): c for b, c in sorted(Counter(mb.values()).items())}
        if unreachable:
            histogram["inf"] = unreachable
        explicit = sorted((s, t, b) for (s, t), b in mb.items() if b > 0)
        if len(explicit) > MAX_EXPLICIT:
            explicit = sorted(rnd.sample(explicit, MAX_EXPLICIT))
        explicit += unreachable_sample(top, roots, rnd, INF_SAMPLES) if unreachable else []
        zero = sorted((s, t) for (s, t), b in mb.items() if b == 0)
        sampled = sorted(rnd.sample(zero, min(ZERO_SAMPLES, len(zero))))
        moves = moves_for(explicit + [(s, t, 0) for s, t in sampled], layers, q, partners)
        results.append(
            {
                "property": prop,
                "moveModel": model,
                "q": q,
                "pairs": expected,
                "histogram": histogram,
                "explicit": [[s, t, b, moves[(s, t)]] for s, t, b in explicit],
                "sampled": [[s, t, 0, moves[(s, t)]] for s, t in sampled],
            }
        )
    return results


def random_graph(rnd: random.Random, n: int) -> List[Edge]:
    all_pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    m = rnd.randint(n - 2, MAX_RANDOM_EDGES)
    chosen = rnd.sample(all_pairs, m)
    rnd.shuffle(chosen)
    return [tuple(e) for e in chosen]  # type: ignore[misc]


def analyse_random_graph(edges: Sequence[Edge], prop: str, model: str, rnd: random.Random) -> List[dict]:
    partners = replacement_partners(edges, model)
    layers = valid_by_size(edges, prop)
    qs = sorted(q for q in layers if len(layers[q]) >= 2)
    if not qs:
        return []
    chosen_qs = sorted(set(rnd.sample(qs, min(2, len(qs))) + [qs[-1]]))
    results = []
    for q in chosen_qs:
        mb, roots = minimum_buffers(layers, q, partners)
        positive = sorted(p for p, b in mb.items() if b > 0)
        zero = sorted(p for p, b in mb.items() if b == 0)
        picks = rnd.sample(positive, min(3, len(positive))) + rnd.sample(zero, min(2, len(zero)))
        triples = sorted((s, t, mb[(s, t)]) for s, t in picks)
        top = layers[q]
        if len(mb) < len(top) * (len(top) - 1) // 2:
            triples += unreachable_sample(top, roots, rnd, 1)
        moves = moves_for(triples, layers, q, partners)
        results.append({"property": prop, "moveModel": model, "q": q, "pairs": [[s, t, b, moves[(s, t)]] for s, t, b in triples]})
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden", "golden-v1.json.gz"))
    args = parser.parse_args()

    started = time.time()
    rnd = random.Random(SEED)
    atlas = []
    explicit_total = 0
    for index, graph in enumerate(graph_atlas_g()):
        n = graph.number_of_nodes()
        if n > 6 or graph.number_of_edges() == 0:
            continue
        edges = canonical_edges(graph)
        results = []
        for prop in PROPERTIES:
            for model in MOVE_MODELS:
                results.extend(analyse_atlas_graph(edges, prop, model, rnd))
        explicit_total += sum(len(r["explicit"]) for r in results)
        atlas.append({"atlasIndex": index, "n": n, "edges": [list(e) for e in edges], "results": results})

    random_section = []
    for i in range(RANDOM_GRAPHS):
        n = 7 if i % 2 == 0 else 8
        edges = random_graph(rnd, n)
        results = []
        for prop in PROPERTIES:
            for model in MOVE_MODELS:
                results.extend(analyse_random_graph(edges, prop, model, rnd))
        random_section.append({"n": n, "edges": [list(e) for e in edges], "results": results})

    payload = {
        "format": "reconfiglab-golden",
        "version": 1,
        "seed": SEED,
        "generator": "reference/generate_golden.py",
        "atlas": atlas,
        "random": random_section,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    with open(args.out, "wb") as f:
        with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0) as gz:
            gz.write(raw)

    hist_total: Counter = Counter()
    by_n: Dict[int, Counter] = defaultdict(Counter)
    for g in atlas:
        for r in g["results"]:
            for b, c in r["histogram"].items():
                hist_total[(r["property"], r["moveModel"], b)] += c
                if r["moveModel"] == "token-jumping":
                    by_n[g["n"]][b] += c
    print(f"atlas graphs: {len(atlas)}; explicit pairs (b* > 0 or unreachable): {explicit_total}")
    print("pairs by (property, model, minimum buffer):", dict(sorted(hist_total.items())))
    print("token-jumping pairs by vertex count and minimum buffer:", {n: dict(sorted(c.items())) for n, c in sorted(by_n.items())})
    print(f"random graphs: {len(random_section)}; random pairs: {sum(len(r['pairs']) for g in random_section for r in g['results'])}")
    print(f"wrote {args.out} ({os.path.getsize(args.out):,} bytes compressed, {len(raw):,} raw) in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
