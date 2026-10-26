import { describe, expect, it } from 'vitest';
import { indexGraph } from '../src/domain/graph';
import { popcount } from '../src/domain/mask';
import { fixtureB, spider } from '../src/examples/fixtures';
import { pathProperty, treeProperty, type GraphProperty } from '../src/properties';
import { forEachNeighbor, type SearchContext } from '../src/solver/search';
import { contextOf, problemOf } from './helpers';

function neighbors(ctx: SearchContext, mask: number, b: number): number[] {
  const out: number[] = [];
  forEachNeighbor(ctx, mask, b, (x) => {
    out.push(x);
  });
  return out;
}

/** Straightforward restatement of §5.3's fixed neighbor order, for comparison. */
function specNeighbors(ctx: SearchContext, mask: number, b: number, property: GraphProperty): number[] {
  const m = ctx.graph.m;
  const q = ctx.q;
  const size = popcount(mask);
  const bits = [...Array(m).keys()];
  const sel = bits.filter((i) => mask & (1 << i));
  const unsel = bits.filter((i) => !(mask & (1 << i)));
  const out: number[] = [];
  if (size > q - b) for (const i of sel) out.push(mask & ~(1 << i));
  for (const i of sel) for (const j of unsel) out.push((mask & ~(1 << i)) | (1 << j));
  if (size < q) for (const j of unsel) out.push(mask | (1 << j));
  return out.filter((x) => property.isValid(x, ctx.graph));
}

describe('neighbor generation', () => {
  const problem = problemOf(fixtureB());
  const ctx = contextOf(problem, pathProperty);

  it('follows the fixed order: stores, then token jumps, then retrieves, ascending edge indices', () => {
    for (let b = 0; b <= 3; b++) {
      for (let mask = 1; mask < 1 << 6; mask++) {
        const size = popcount(mask);
        if (size > 4 || size < 4 - b || !pathProperty.isValid(mask, ctx.graph)) continue;
        expect(neighbors(ctx, mask, b)).toEqual(specNeighbors(ctx, mask, b, pathProperty));
      }
    }
  });

  it('has no stores or retrieves at budget 0, and no TJ move exists from the Fixture B source', () => {
    expect(neighbors(ctx, ctx.source, 0)).toEqual([]);
  });

  it('only stores from a full configuration and only retrieves below q', () => {
    const fromSource = neighbors(ctx, ctx.source, 1);
    expect(fromSource.length).toBeGreaterThan(0);
    for (const x of fromSource) expect(popcount(x)).toBe(3);
    // The Fixture B budget-1 sequence: store e2 is the first legal store from the source.
    expect(fromSource[0]).toBe(ctx.source & ~(1 << 1));
    const mid = 0b100101; // {e1, e3, e6}
    for (const x of neighbors(ctx, mid, 1)) expect([3, 4]).toContain(popcount(x));
  });

  it('every generated neighbor differs by exactly one or two edges and is valid', () => {
    const sctx = contextOf(problemOf(spider(3)), treeProperty);
    for (let mask = 1; mask < 1 << 9; mask++) {
      if (popcount(mask) > 6 || !treeProperty.isValid(mask, sctx.graph)) continue;
      for (const x of neighbors(sctx, mask, 3)) {
        const diff = popcount(mask ^ x);
        expect([1, 2]).toContain(diff);
        if (diff === 2) expect(popcount(x)).toBe(popcount(mask));
        expect(treeProperty.isValid(x, sctx.graph)).toBe(true);
      }
    }
  });

  it('stops when the visitor returns true', () => {
    let calls = 0;
    forEachNeighbor(ctx, ctx.source, 3, () => {
      calls++;
      return true;
    });
    expect(calls).toBe(1);
    expect(indexGraph(problem.graph).m).toBe(6);
  });
});
