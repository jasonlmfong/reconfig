import type { IndexedGraph } from './graph';

/** Number of set bits in a 32-bit integer. */
export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** Index of the lowest set bit (mask must be non-zero). */
export function lowestBitIndex(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

export function maskFromEdgeIds(ids: Iterable<string>, graph: IndexedGraph): number {
  let mask = 0;
  for (const id of ids) {
    const i = graph.edgeIndex.get(id);
    if (i === undefined) throw new Error(`Unknown edge ${id}.`);
    mask |= 1 << i;
  }
  return mask;
}

/** Edge IDs selected by `mask`, in canonical (ascending index) order. */
export function edgeIdsFromMask(mask: number, graph: IndexedGraph): string[] {
  const ids: string[] = [];
  for (let i = 0; i < graph.m; i++) {
    if (mask & (1 << i)) ids.push(graph.edgeIds[i]);
  }
  return ids;
}
