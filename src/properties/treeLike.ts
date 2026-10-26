import type { IndexedGraph } from "../domain/graph";
import { find, resetScratch } from "./scratch";

/**
 * Fast check that the selected edges form a non-empty tree (connected and acyclic, isolated
 * host vertices ignored) whose vertices all have degree at most `maxDegree`.
 */
export function isBoundedDegreeTree(
    mask: number,
    graph: IndexedGraph,
    maxDegree: number
): boolean {
    if (mask === 0) return false;
    const { parent, degree } = resetScratch(graph.n);
    let edges = 0;
    let vertices = 0;
    let rest = mask;
    while (rest !== 0) {
        const low = rest & -rest;
        rest ^= low;
        const i = 31 - Math.clz32(low);
        const u = graph.edgeU[i];
        const v = graph.edgeV[i];
        if (degree[u]++ === 0) vertices++;
        if (degree[v]++ === 0) vertices++;
        if (degree[u] > maxDegree || degree[v] > maxDegree) return false;
        const ru = find(parent, u);
        const rv = find(parent, v);
        if (ru === rv) return false;
        parent[ru] = rv;
        edges++;
    }
    // Acyclic with |V_F| = |E_F| + 1 implies connected.
    return vertices === edges + 1;
}

/** Slower, explanatory analysis used for live validation messages. */
export function explainTreeLike(
    mask: number,
    graph: IndexedGraph,
    maxDegree: number
): string | null {
    if (mask === 0) return "no edges are selected";
    const deg = new Array<number>(graph.n).fill(0);
    const adjacency: number[][] = Array.from({ length: graph.n }, () => []);
    let edges = 0;
    for (let i = 0; i < graph.m; i++) {
        if (!(mask & (1 << i))) continue;
        const u = graph.edgeU[i];
        const v = graph.edgeV[i];
        deg[u]++;
        deg[v]++;
        adjacency[u].push(v);
        adjacency[v].push(u);
        edges++;
    }
    for (let v = 0; v < graph.n; v++) {
        if (deg[v] > maxDegree)
            return `vertex ${graph.vertexLabels[v]} has degree ${deg[v]}`;
    }
    const incident = deg.map((d, v) => (d > 0 ? v : -1)).filter((v) => v >= 0);
    const seen = new Set<number>([incident[0]]);
    const stack = [incident[0]];
    while (stack.length > 0) {
        const x = stack.pop()!;
        for (const y of adjacency[x]) {
            if (!seen.has(y)) {
                seen.add(y);
                stack.push(y);
            }
        }
    }
    const connected = seen.size === incident.length;
    if (connected && edges !== incident.length - 1)
        return "selected edges contain a cycle";
    if (!connected) {
        // A disconnected selection may also contain a cycle; report the cycle first because it is
        // the more specific defect.
        const components = countComponents(incident, adjacency);
        if (edges > incident.length - components)
            return "selected edges contain a cycle";
        return "selected edges are disconnected";
    }
    return null;
}

function countComponents(vertices: number[], adjacency: number[][]): number {
    const seen = new Set<number>();
    let components = 0;
    for (const start of vertices) {
        if (seen.has(start)) continue;
        components++;
        seen.add(start);
        const stack = [start];
        while (stack.length > 0) {
            const x = stack.pop()!;
            for (const y of adjacency[x]) {
                if (!seen.has(y)) {
                    seen.add(y);
                    stack.push(y);
                }
            }
        }
    }
    return components;
}
