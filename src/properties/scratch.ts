/** Shared union-find and degree buffers so hot validity checks do not allocate per mask. */
let parent = new Int32Array(64);
let degree = new Int32Array(64);

export interface Scratch {
    parent: Int32Array;
    degree: Int32Array;
}

/** Resets the buffers for n vertices. Callers must finish with them before the next reset. */
export function resetScratch(n: number): Scratch {
    if (parent.length < n) {
        parent = new Int32Array(n * 2);
        degree = new Int32Array(n * 2);
    }
    for (let i = 0; i < n; i++) {
        parent[i] = i;
        degree[i] = 0;
    }
    return { parent, degree };
}

export function find(parent: Int32Array, x: number): number {
    while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    return x;
}
