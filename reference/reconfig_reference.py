"""Independent reference implementation for ReconfigLab (handoff section 9).

This module deliberately shares no algorithm with the TypeScript solver:

* Property validity is decided with networkx (``nx.is_tree`` plus a degree check for paths,
  ``nx.is_forest`` for forests) instead of a hand-written union-find.
* Minimum buffers are computed by sweeping budgets upward and maintaining connected
  components of the configuration graph with union-find, instead of per-budget BFS.
* Shortest move counts (needed only for recorded pairs) use a plain BFS over Python ints.

Model (normative, handoff section 3): a configuration is a non-empty edge subset satisfying the
property. With q = |S| = |T| and budget b, legal configurations have q - b <= |F| <= q. A move is
a direct replacement (swap one selected edge for one unselected edge; under Token Sliding the two
edges must share an endpoint), a store (remove one edge), or a retrieve (add any one edge), and
every configuration must satisfy the property.
"""

from __future__ import annotations

from collections import deque
from typing import Dict, Iterable, List, Sequence, Tuple

import networkx as nx

Edge = Tuple[int, int]
PROPERTIES = ("path", "tree", "forest")
MOVE_MODELS = ("token-jumping", "token-sliding")
Partners = List[List[int]]


def popcount(x: int) -> int:
    return bin(x).count("1")


def is_valid(edges: Sequence[Edge], mask: int, prop: str) -> bool:
    """Path: non-empty simple path. Tree: non-empty tree. Forest: non-empty acyclic. Isolated host vertices are ignored."""
    selected = [edges[i] for i in range(len(edges)) if mask >> i & 1]
    if not selected:
        return False
    h = nx.Graph()
    h.add_edges_from(selected)
    if prop == "forest":
        return nx.is_forest(h)
    if not nx.is_tree(h):
        return False
    if prop == "path" and max(d for _, d in h.degree()) > 2:
        return False
    return True


def replacement_partners(edges: Sequence[Edge], model: str) -> Partners:
    """For each edge index i, the edge indices a token on edge i may move to in one direct move."""
    m = len(edges)
    if model == "token-jumping":
        return [[j for j in range(m) if j != i] for i in range(m)]
    if model == "token-sliding":
        return [[j for j in range(m) if j != i and set(edges[i]) & set(edges[j])] for i in range(m)]
    raise ValueError(model)


def valid_by_size(edges: Sequence[Edge], prop: str) -> Dict[int, List[int]]:
    """All valid configurations grouped by size."""
    layers: Dict[int, List[int]] = {}
    for mask in range(1, 1 << len(edges)):
        if is_valid(edges, mask, prop):
            layers.setdefault(popcount(mask), []).append(mask)
    return layers


class UnionFind:
    def __init__(self) -> None:
        self.parent: Dict[int, int] = {}

    def add(self, x: int) -> None:
        self.parent.setdefault(x, x)

    def find(self, x: int) -> int:
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if ra < rb:
                ra, rb = rb, ra
            self.parent[ra] = rb


def _replace_neighbors(mask: int, partners: Partners) -> Iterable[int]:
    for i, targets in enumerate(partners):
        if mask >> i & 1:
            without = mask ^ (1 << i)
            for j in targets:
                if not (mask >> j & 1):
                    yield without | (1 << j)


def budget_sweep(layers: Dict[int, List[int]], q: int, partners: Partners) -> List[Dict[int, int]]:
    """
    For budgets b = 0 .. q - 1 returns, per budget, a map from each size-q configuration to its
    component root in the configuration graph restricted to sizes q - b .. q. Layers are added one
    at a time, and union-find merges components incrementally.
    """
    m = len(partners)
    uf = UnionFind()
    added: set = set()
    snapshots: List[Dict[int, int]] = []
    top = layers.get(q, [])
    for b in range(q):
        size = q - b
        layer = layers.get(size, [])
        layer_set = set(layer)
        for x in layer:
            uf.add(x)
            added.add(x)
        for x in layer:
            for y in _replace_neighbors(x, partners):
                if y in layer_set:
                    uf.union(x, y)
        if b > 0:
            # Store/retrieve moves between the new layer and the layer above it.
            above = set(layers.get(size + 1, []))
            for x in layer:
                for j in range(m):
                    if not (x >> j & 1):
                        y = x | (1 << j)
                        if y in above:
                            uf.union(x, y)
        snapshots.append({x: uf.find(x) for x in top})
    return snapshots


def minimum_buffers(layers: Dict[int, List[int]], q: int, partners: Partners) -> Tuple[Dict[Tuple[int, int], int], Dict[int, int]]:
    """
    Minimum buffer for every reachable unordered pair (S, T), S < T, of size-q configurations,
    plus the component root of each size-q configuration at the largest budget q - 1. Pairs that
    are absent are unreachable under every budget.
    """
    top = sorted(layers.get(q, []))
    snapshots = budget_sweep(layers, q, partners)
    result: Dict[Tuple[int, int], int] = {}
    previous: Dict[int, int] | None = None
    for b, roots in enumerate(snapshots):
        groups: Dict[int, List[int]] = {}
        for x in top:
            groups.setdefault(roots[x], []).append(x)
        for members in groups.values():
            if len(members) < 2:
                continue
            if previous is None:
                for i, s in enumerate(members):
                    for t in members[i + 1 :]:
                        result[(s, t)] = 0
                continue
            # Only pairs whose components were different at b - 1 are new at b.
            by_old: Dict[int, List[int]] = {}
            for x in members:
                by_old.setdefault(previous[x], []).append(x)
            if len(by_old) < 2:
                continue
            olds = list(by_old.values())
            for i in range(len(olds)):
                for j in range(i + 1, len(olds)):
                    for s in olds[i]:
                        for t in olds[j]:
                            result[(min(s, t), max(s, t))] = b
        previous = roots
    return result, snapshots[-1] if snapshots else {}


def bfs_distances(start: int, b: int, q: int, valid: set, partners: Partners) -> Dict[int, int]:
    """Shortest move counts from ``start`` to every configuration reachable under budget b."""
    m = len(partners)
    dist = {start: 0}
    queue = deque([start])
    while queue:
        x = queue.popleft()
        k = popcount(x)
        candidates: List[int] = []
        if k > q - b:
            candidates.extend(x ^ (1 << i) for i in range(m) if x >> i & 1)
        candidates.extend(_replace_neighbors(x, partners))
        if k < q:
            candidates.extend(x | (1 << j) for j in range(m) if not (x >> j & 1))
        for y in candidates:
            if y in dist or y not in valid:
                continue
            ky = popcount(y)
            if ky < q - b or ky > q:
                continue
            dist[y] = dist[x] + 1
            queue.append(y)
    return dist


def canonical_edges(graph: nx.Graph) -> List[Edge]:
    """Edge list in a fixed order with vertices relabelled 0..n-1 by sorted node order."""
    index = {v: i for i, v in enumerate(sorted(graph.nodes()))}
    return sorted(tuple(sorted((index[u], index[v]))) for u, v in graph.edges())
