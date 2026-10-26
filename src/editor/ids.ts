import type { Graph } from "../domain/graph";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Next unused vertex ID (also avoiding `reserved`): the first free letter, then V1, V2, ... */
export function nextVertexId(
    graph: Graph,
    reserved: Iterable<string> = []
): string {
    const used = new Set([...graph.vertices.map((v) => v.id), ...reserved]);
    for (const letter of LETTERS) {
        if (!used.has(letter)) return letter;
    }
    for (let k = 1; ; k++) {
        if (!used.has(`V${k}`)) return `V${k}`;
    }
}

/** Next edge ID `e{n}` with n one greater than the largest numeric suffix in use. */
export function nextEdgeId(graph: Graph): string {
    const used = new Set(graph.edges.map((e) => e.id));
    let max = 0;
    for (const e of graph.edges) {
        const match = /^e(\d+)$/.exec(e.id);
        if (match) max = Math.max(max, Number(match[1]));
    }
    let k = max + 1;
    while (used.has(`e${k}`)) k++;
    return `e${k}`;
}
