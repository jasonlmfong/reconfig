import type { IndexedGraph } from "../domain/graph";
import { find, resetScratch } from "./scratch";
import type { GraphProperty } from "./types";

/** Non-empty acyclic selected subgraph; disconnected forests are allowed. */
export const forestProperty: GraphProperty = {
    id: "forest",
    name: "Forest",
    noun: "forest",
    allowsEmpty: false,
    isValid: (mask, graph) => isForest(mask, graph),
    explainInvalid: (mask, graph) => explainForest(mask, graph),
};

function isForest(mask: number, graph: IndexedGraph): boolean {
    if (mask === 0) return false;
    const { parent } = resetScratch(graph.n);
    let rest = mask;
    while (rest !== 0) {
        const bit = rest & -rest;
        rest ^= bit;
        const i = 31 - Math.clz32(bit);
        const u = find(parent, graph.edgeU[i]);
        const v = find(parent, graph.edgeV[i]);
        if (u === v) return false;
        parent[u] = v;
    }
    return true;
}

function explainForest(mask: number, graph: IndexedGraph): string | null {
    if (mask === 0) return "no edges are selected";
    return isForest(mask, graph) ? null : "selected edges contain a cycle";
}
