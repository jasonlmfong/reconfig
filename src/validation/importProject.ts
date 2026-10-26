import {
  DEFAULT_LIMITS,
  MAX_ID_LENGTH,
  MAX_IMPORT_BYTES,
  MAX_LABEL_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  SCHEMA_VERSION,
  type GraphLimits,
} from '../domain/constants';
import type { Edge, Graph, Vertex } from '../domain/graph';
import { PROPERTY_IDS, type PropertyId } from '../domain/problem';
import type { ProjectFile } from '../domain/project';
import { MOVE_MODELS } from '../moveModels';
import type { ValidationIssue } from '../domain/result';
import { maxBudget, PROPERTIES } from '../properties';
import { validateGraphStructure } from './graphValidation';
import { messages } from './messages';

export type ImportOutcome =
  | { ok: true; project: ProjectFile; discardedLastResult: boolean; budgetClamped: boolean }
  | { ok: false; errors: ValidationIssue[] };

function fail(field: string, detail: string): ValidationIssue {
  return { field, message: messages.importFailed(detail) };
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Parses and validates project JSON text. Every failure is reported with a field path. */
export function parseProjectText(text: string, limits: GraphLimits = DEFAULT_LIMITS): ImportOutcome {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_IMPORT_BYTES) {
    return { ok: false, errors: [fail('$', `file is larger than ${Math.round(MAX_IMPORT_BYTES / 1024)} KB.`)] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: [fail('$', 'file is not valid JSON.')] };
  }
  return validateProjectObject(raw, limits);
}

export function validateProjectObject(raw: unknown, limits: GraphLimits = DEFAULT_LIMITS): ImportOutcome {
  const errors: ValidationIssue[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: [fail('$', 'top level must be a JSON object.')] };
  }

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    errors.push(fail('schemaVersion', `unsupported schemaVersion ${JSON.stringify(raw.schemaVersion) ?? 'undefined'} (expected ${SCHEMA_VERSION}).`));
  }

  let projectName = 'Untitled project';
  if (raw.projectName !== undefined) {
    if (typeof raw.projectName !== 'string') errors.push(fail('projectName', 'projectName must be a string.'));
    else projectName = raw.projectName.slice(0, MAX_PROJECT_NAME_LENGTH);
  }

  const property = raw.property;
  if (typeof property !== 'string' || !PROPERTY_IDS.includes(property as PropertyId)) {
    errors.push(fail('property', `unknown property ${JSON.stringify(property) ?? 'undefined'} (expected one of ${PROPERTY_IDS.join(', ')}).`));
  }

  const moveModel = raw.moveModel === undefined ? 'token-jumping' : raw.moveModel;
  if (typeof moveModel !== 'string' || !Object.hasOwn(MOVE_MODELS, moveModel)) {
    errors.push(fail('moveModel', `unknown move model ${JSON.stringify(moveModel)} (expected one of ${Object.keys(MOVE_MODELS).join(', ')}).`));
  }

  const graph = readGraph(raw.graph, limits, errors);

  const sourceEdgeIds = readSelection(raw.sourceEdgeIds, 'sourceEdgeIds', graph, errors);
  const targetEdgeIds = readSelection(raw.targetEdgeIds, 'targetEdgeIds', graph, errors);

  let bufferBudget = 0;
  let budgetClamped = false;
  if (raw.bufferBudget !== undefined) {
    if (typeof raw.bufferBudget !== 'number' || !Number.isFinite(raw.bufferBudget)) {
      errors.push(fail('bufferBudget', 'bufferBudget must be a finite number.'));
    } else {
      bufferBudget = raw.bufferBudget;
    }
  }

  if (errors.length > 0 || !graph || !sourceEdgeIds || !targetEdgeIds) {
    return { ok: false, errors };
  }

  const prop = PROPERTIES[property as PropertyId];
  const upper = maxBudget(prop, sourceEdgeIds.length);
  const clamped = Math.min(upper, Math.max(0, Math.floor(bufferBudget)));
  budgetClamped = clamped !== bufferBudget;

  return {
    ok: true,
    discardedLastResult: raw.lastResult !== undefined,
    budgetClamped,
    project: {
      schemaVersion: SCHEMA_VERSION,
      projectName,
      graph,
      property: property as PropertyId,
      moveModel: moveModel as ProjectFile['moveModel'],
      sourceEdgeIds,
      targetEdgeIds,
      bufferBudget: clamped,
    },
  };
}

function readGraph(raw: unknown, limits: GraphLimits, errors: ValidationIssue[]): Graph | null {
  if (!isRecord(raw)) {
    errors.push(fail('graph', 'graph must be an object with vertices and edges.'));
    return null;
  }
  const { vertices, edges } = raw;
  if (!Array.isArray(vertices)) {
    errors.push(fail('graph.vertices', 'graph.vertices must be an array.'));
  }
  if (!Array.isArray(edges)) {
    errors.push(fail('graph.edges', 'graph.edges must be an array.'));
  }
  if (!Array.isArray(vertices) || !Array.isArray(edges)) return null;
  // Enforce caps before reading any items.
  if (vertices.length > limits.maxVertices || edges.length > limits.maxEdges) {
    errors.push({ field: 'graph', message: messages.importFailed(lowerFirst(messages.graphLimit(limits.maxVertices, limits.maxEdges))) });
    return null;
  }

  const before = errors.length;
  const outVertices: Vertex[] = [];
  vertices.forEach((v: unknown, i: number) => {
    const field = `graph.vertices[${i}]`;
    if (!isRecord(v)) {
      errors.push(fail(field, `vertex ${i + 1} must be an object.`));
      return;
    }
    if (typeof v.id !== 'string' || v.id.trim() === '') {
      errors.push(fail(`${field}.id`, `vertex ${i + 1} must have a non-empty string ID.`));
      return;
    }
    if (v.id.length > MAX_ID_LENGTH) {
      errors.push(fail(`${field}.id`, `vertex ID at position ${i + 1} is longer than ${MAX_ID_LENGTH} characters.`));
      return;
    }
    let label = v.id;
    if (v.label !== undefined) {
      if (typeof v.label !== 'string') {
        errors.push(fail(`${field}.label`, `vertex ${v.id} label must be a string.`));
        return;
      }
      label = v.label.slice(0, MAX_LABEL_LENGTH);
    }
    const vertex: Vertex = { id: v.id, label };
    for (const axis of ['x', 'y'] as const) {
      const value = v[axis];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(fail(`${field}.${axis}`, `vertex ${v.id} coordinate ${axis} must be a finite number.`));
        return;
      }
      vertex[axis] = value;
    }
    outVertices.push(vertex);
  });

  const outEdges: Edge[] = [];
  edges.forEach((e: unknown, i: number) => {
    const field = `graph.edges[${i}]`;
    if (!isRecord(e)) {
      errors.push(fail(field, `edge ${i + 1} must be an object.`));
      return;
    }
    if (typeof e.id !== 'string' || e.id.trim() === '') {
      errors.push(fail(`${field}.id`, `edge ${i + 1} must have a non-empty string ID.`));
      return;
    }
    if (e.id.length > MAX_ID_LENGTH) {
      errors.push(fail(`${field}.id`, `edge ID at position ${i + 1} is longer than ${MAX_ID_LENGTH} characters.`));
      return;
    }
    if (typeof e.u !== 'string' || typeof e.v !== 'string') {
      errors.push(fail(field, `edge ${e.id} endpoints u and v must be vertex ID strings.`));
      return;
    }
    outEdges.push({ id: e.id, u: e.u, v: e.v });
  });

  if (errors.length > before) return null;

  const graph: Graph = { vertices: outVertices, edges: outEdges };
  const structural = validateGraphStructure(graph, limits);
  for (const issue of structural) {
    errors.push({ field: issue.field, message: messages.importFailed(lowerFirst(issue.message)) });
  }
  return structural.length > 0 ? null : graph;
}

function readSelection(
  raw: unknown,
  field: 'sourceEdgeIds' | 'targetEdgeIds',
  graph: Graph | null,
  errors: ValidationIssue[],
): string[] | null {
  if (!Array.isArray(raw)) {
    errors.push(fail(field, `${field} must be an array of edge IDs.`));
    return null;
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  let ok = true;
  raw.forEach((id: unknown, i: number) => {
    if (typeof id !== 'string') {
      errors.push(fail(`${field}[${i}]`, `${field} entry ${i + 1} must be a string.`));
      ok = false;
      return;
    }
    if (seen.has(id)) {
      errors.push(fail(`${field}[${i}]`, `${field} lists edge ${id} more than once.`));
      ok = false;
      return;
    }
    seen.add(id);
    if (graph && !graph.edges.some((e) => e.id === id)) {
      errors.push(fail(`${field}[${i}]`, `${field} references unknown edge ${id}.`));
      ok = false;
      return;
    }
    ids.push(id);
  });
  if (!ok || !graph) return null;
  // Normalize to canonical edge order.
  return graph.edges.filter((e) => seen.has(e.id)).map((e) => e.id);
}
