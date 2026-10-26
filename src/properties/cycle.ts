import type { IndexedGraph } from "../domain/graph";
import { find, resetScratch } from "./scratch";
import type { GraphProperty } from "./types";

/** Non-empty simple cycle: connected, with every incident vertex of degree exactly two. */
export const cycleProperty: GraphProperty = {
    id: "cycle",
    name: "Cycle",
    noun: "cycle",
    allowsEmpty: false,
    isValid: (mask, graph) => isCycle(mask, graph),
    explainInvalid: (mask, graph) => explainCycleInvalid(mask, graph),
};

function isCycle(mask: number, graph: IndexedGraph): boolean {
    if (mask === 0) return false;
    const { parent, degree } = resetScratch(graph.n);
    let edges = 0;
    let vertices = 0;
    let merges = 0;
    let rest = mask;
    while (rest !== 0) {
        const low = rest & -rest;
        rest ^= low;
        const i = 31 - Math.clz32(low);
        const u = graph.edgeU[i];
        const v = graph.edgeV[i];
        if (degree[u]++ === 0) vertices++;
        if (degree[v]++ === 0) vertices++;
        if (degree[u] > 2 || degree[v] > 2) return false;
        const ru = find(parent, u);
        const rv = find(parent, v);
        if (ru !== rv) {
            parent[ru] = rv;
            merges++;
        }
        edges++;
    }
    // With every degree <= 2, |E| = |V| forces every degree to be exactly 2.
    return edges >= 3 && edges === vertices && merges === vertices - 1;
}

function explainCycleInvalid(mask: number, graph: IndexedGraph): string | null {
    if (isCycle(mask, graph)) return null;
    if (mask === 0) return "no edges are selected";
    const degree = new Int32Array(graph.n);
    let edges = 0;
    for (let i = 0; i < graph.m; i++) {
        if (!(mask & (1 << i))) continue;
        degree[graph.edgeU[i]]++;
        degree[graph.edgeV[i]]++;
        edges++;
    }
    if (edges < 3) return "a cycle needs at least three edges";
    for (let v = 0; v < graph.n; v++) {
        if (degree[v] > 0 && degree[v] !== 2)
            return `vertex ${graph.vertexLabels[v]} has degree ${degree[v]}`;
    }
    return "selected edges are disconnected";
}
