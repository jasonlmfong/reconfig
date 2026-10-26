import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_BYTES } from '../src/domain/constants';
import { serializeProject, type ProjectFile } from '../src/domain/project';
import { createInitialState, editorReducer, toProjectFile } from '../src/editor/state';
import { fixtureB, spider } from '../src/examples/fixtures';
import { parseProjectText, validateProjectObject } from '../src/validation/importProject';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function importOk(text: string) {
  const outcome = parseProjectText(text);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
  return outcome;
}

function errorsFor(mutate: (p: Record<string, any>) => void) {
  const p = clone(fixtureB()) as unknown as Record<string, any>;
  mutate(p);
  const outcome = validateProjectObject(p);
  expect(outcome.ok).toBe(false);
  return outcome.ok ? [] : outcome.errors;
}

describe('Fixture F — import/export round trip', () => {
  it('preserves IDs, edge order, selections, property, budget, and positions', () => {
    let state = createInitialState(fixtureB());
    state = editorReducer(state, { type: 'setBudget', budget: 2 });
    state = editorReducer(state, { type: 'moveVertex', id: 'A', x: 123.456, y: -7.25 });
    state = editorReducer(state, { type: 'setProperty', property: 'tree' });
    const exported = toProjectFile(state);
    const text = serializeProject(exported);

    const outcome = importOk(text);
    expect(outcome.discardedLastResult).toBe(false);
    const fresh = editorReducer(createInitialState(), { type: 'loadProject', project: outcome.project });
    const again = toProjectFile(fresh);
    expect(again).toEqual(exported);
    expect(again.graph.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    expect(again.graph.vertices.find((v) => v.id === 'A')).toEqual({ id: 'A', label: 'A', x: 123.456, y: -7.25 });
    expect(again.property).toBe('tree');
    expect(again.bufferBudget).toBe(2);
    expect(again.sourceEdgeIds).toEqual(['e1', 'e2', 'e3', 'e6']);
    expect(again.targetEdgeIds).toEqual(['e1', 'e3', 'e4', 'e5']);
  });

  it('preserves a non-alphabetical canonical edge order', () => {
    const p = clone(spider(2));
    p.graph.edges.reverse();
    const outcome = importOk(JSON.stringify(p));
    expect(outcome.project.graph.edges.map((e) => e.id)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
    // Selections are normalized to canonical edge order.
    expect(outcome.project.sourceEdgeIds).toEqual(['e6', 'e5', 'e2', 'e1']);
  });

  it('accepts projects without coordinates or budget and lays vertices out', () => {
    const p = clone(fixtureB()) as Partial<ProjectFile> & Record<string, any>;
    for (const v of p.graph!.vertices) {
      delete v.x;
      delete v.y;
    }
    delete p.bufferBudget;
    const outcome = importOk(JSON.stringify(p));
    expect(outcome.project.bufferBudget).toBe(0);
    const state = editorReducer(createInitialState(), { type: 'loadProject', project: outcome.project });
    expect(Object.keys(state.positions).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('discards an untrusted lastResult and clamps the budget', () => {
    const p = { ...clone(fixtureB()), bufferBudget: 99, lastResult: { status: 'reachable', steps: [] } };
    const outcome = importOk(JSON.stringify(p));
    expect(outcome.discardedLastResult).toBe(true);
    expect(outcome.budgetClamped).toBe(true);
    expect(outcome.project.bufferBudget).toBe(3);
    expect('lastResult' in outcome.project).toBe(false);
    expect(importOk(JSON.stringify({ ...clone(fixtureB()), bufferBudget: -2 })).project.bufferBudget).toBe(0);
  });

  it('keeps labels and project names as untrusted plain text', () => {
    const p = clone(fixtureB());
    p.projectName = '<img src=x onerror=alert(1)>';
    p.graph.vertices[0].label = '<script>alert(1)</script>';
    const outcome = importOk(JSON.stringify(p));
    expect(outcome.project.projectName).toBe('<img src=x onerror=alert(1)>');
    expect(outcome.project.graph.vertices[0].label).toBe('<script>alert(1)</script>');
  });
});

describe('import validation — one failing case per §6.1 rule', () => {
  const fields = (errors: { field: string; message: string }[]) => errors.map((e) => e.field);

  it('rejects malformed files before parsing', () => {
    const tooBig = parseProjectText(' '.repeat(MAX_IMPORT_BYTES + 1));
    expect(tooBig.ok).toBe(false);
    expect(!tooBig.ok && tooBig.errors[0].message).toBe('Import failed: file is larger than 256 KB.');
    const notJson = parseProjectText('{nope');
    expect(!notJson.ok && notJson.errors[0].message).toBe('Import failed: file is not valid JSON.');
    const array = parseProjectText('[]');
    expect(!array.ok && array.errors[0].field).toBe('$');
  });

  it('schemaVersion must be supported', () => {
    expect(fields(errorsFor((p) => (p.schemaVersion = 2)))).toContain('schemaVersion');
    expect(fields(errorsFor((p) => delete p.schemaVersion))).toContain('schemaVersion');
  });

  it('property must be a known value', () => {
    const errors = errorsFor((p) => (p.property = 'mystery'));
    expect(fields(errors)).toEqual(['property']);
    expect(errors[0].message).toContain('unknown property "mystery"');
  });

  it('vertex IDs must be non-empty strings', () => {
    expect(fields(errorsFor((p) => (p.graph.vertices[0].id = '')))).toContain('graph.vertices[0].id');
    expect(fields(errorsFor((p) => (p.graph.vertices[1].id = 7)))).toContain('graph.vertices[1].id');
  });

  it('vertex IDs must be unique', () => {
    const errors = errorsFor((p) => (p.graph.vertices[1].id = 'A'));
    expect(errors.some((e) => e.field === 'graph.vertices[1].id' && e.message === 'Import failed: vertex ID A is used more than once.')).toBe(true);
  });

  it('edge IDs must be non-empty and unique', () => {
    expect(fields(errorsFor((p) => (p.graph.edges[0].id = '  ')))).toContain('graph.edges[0].id');
    const dup = errorsFor((p) => (p.graph.edges[1].id = 'e1'));
    expect(dup.some((e) => e.message === 'Import failed: edge ID e1 is used more than once.')).toBe(true);
  });

  it('edge endpoints must reference existing vertices', () => {
    const errors = errorsFor((p) => p.graph.edges.push({ id: 'e7', u: 'A', v: 'Q' }));
    expect(errors).toContainEqual({ field: 'graph.edges[6].v', message: 'Import failed: edge e7 references an unknown vertex.' });
    expect(fields(errorsFor((p) => (p.graph.edges[0].u = 3)))).toContain('graph.edges[0]');
  });

  it('loops are rejected', () => {
    const errors = errorsFor((p) => p.graph.edges.push({ id: 'e7', u: 'C', v: 'C' }));
    expect(errors[0].message).toBe('Import failed: edge e7 is a self-loop; loops are not allowed.');
  });

  it('parallel edges are rejected in either order', () => {
    const errors = errorsFor((p) => p.graph.edges.push({ id: 'e7', u: 'F', v: 'A' }));
    expect(errors[0].message).toBe('Import failed: edge e7 duplicates edge e1; parallel edges are not allowed.');
  });

  it('does not mistake distinct endpoint pairs for parallel edges when IDs contain separators', () => {
    const outcome = validateProjectObject({
      schemaVersion: 1,
      property: 'path',
      graph: {
        vertices: ['a', 'b\u0000c', 'a\u0000b', 'c'].map((id) => ({ id, label: 'x' })),
        edges: [
          { id: 'x1', u: 'a', v: 'b\u0000c' },
          { id: 'x2', u: 'a\u0000b', v: 'c' },
        ],
      },
      sourceEdgeIds: ['x1'],
      targetEdgeIds: ['x2'],
    });
    expect(outcome.ok).toBe(true);
  });

  it('selections must reference existing edges without duplicates', () => {
    expect(errorsFor((p) => (p.sourceEdgeIds = ['e1', 'e9']))).toContainEqual({
      field: 'sourceEdgeIds[1]',
      message: 'Import failed: sourceEdgeIds references unknown edge e9.',
    });
    expect(errorsFor((p) => (p.targetEdgeIds = ['e1', 'e1']))).toContainEqual({
      field: 'targetEdgeIds[1]',
      message: 'Import failed: targetEdgeIds lists edge e1 more than once.',
    });
    expect(fields(errorsFor((p) => (p.sourceEdgeIds = 'e1')))).toContain('sourceEdgeIds');
    expect(fields(errorsFor((p) => (p.targetEdgeIds = [1])))).toContain('targetEdgeIds[0]');
  });

  it('vertex and edge counts respect the caps', () => {
    const tooManyVertices = errorsFor((p) => {
      for (let i = 0; i < 7; i++) p.graph.vertices.push({ id: `X${i}`, label: `X${i}` });
    });
    expect(tooManyVertices[0].message).toBe('Import failed: graph limit reached: supports at most 12 vertices and 22 edges.');
    const tooManyEdges = errorsFor((p) => {
      for (let i = 0; i < 17; i++) p.graph.edges.push({ id: `x${i}`, u: 'A', v: 'B' });
    });
    expect(fields(tooManyEdges)).toEqual(['graph']);
  });

  it('coordinates, when present, are finite numbers', () => {
    expect(fields(errorsFor((p) => (p.graph.vertices[0].x = '12')))).toContain('graph.vertices[0].x');
    expect(fields(errorsFor((p) => (p.graph.vertices[2].y = null)))).toContain('graph.vertices[2].y');
  });

  it('labels, names, budget, and graph shape are type-checked', () => {
    expect(fields(errorsFor((p) => (p.graph.vertices[0].label = 5)))).toContain('graph.vertices[0].label');
    expect(fields(errorsFor((p) => (p.projectName = 5)))).toContain('projectName');
    expect(fields(errorsFor((p) => (p.bufferBudget = 'two')))).toContain('bufferBudget');
    expect(fields(errorsFor((p) => (p.graph = null)))).toContain('graph');
    expect(fields(errorsFor((p) => (p.graph.edges = {})))).toContain('graph.edges');
  });

  it('accepts the canonical example unchanged', () => {
    expect(validateProjectObject(clone(fixtureB())).ok).toBe(true);
  });
});
