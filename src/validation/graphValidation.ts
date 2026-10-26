import { DEFAULT_LIMITS, MASK_BIT_LIMIT, type GraphLimits } from '../domain/constants';
import type { Graph } from '../domain/graph';
import type { ValidationIssue } from '../domain/result';
import { messages } from './messages';

/**
 * Structural checks on a host graph: caps, ID validity and uniqueness, endpoint references,
 * no loops, and no parallel edges. Field paths are relative to `prefix`.
 */
export function validateGraphStructure(
  graph: Graph,
  limits: GraphLimits = DEFAULT_LIMITS,
  prefix = 'graph',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (graph.vertices.length > limits.maxVertices || graph.edges.length > limits.maxEdges) {
    issues.push({ field: prefix, message: messages.graphLimit(limits.maxVertices, limits.maxEdges) });
  }
  if (graph.edges.length > MASK_BIT_LIMIT) {
    issues.push({ field: `${prefix}.edges`, message: `At most ${MASK_BIT_LIMIT} edges can be represented.` });
  }

  const vertexIds = new Set<string>();
  graph.vertices.forEach((v, i) => {
    const field = `${prefix}.vertices[${i}].id`;
    if (typeof v.id !== 'string' || v.id.trim() === '') {
      issues.push({ field, message: `Vertex ${i + 1} has an empty ID.` });
    } else if (vertexIds.has(v.id)) {
      issues.push({ field, message: `Vertex ID ${v.id} is used more than once.` });
    } else {
      vertexIds.add(v.id);
    }
  });

  const edgeIds = new Set<string>();
  const pairs = new Map<string, string>();
  graph.edges.forEach((e, i) => {
    const field = `${prefix}.edges[${i}]`;
    const name = typeof e.id === 'string' && e.id.trim() !== '' ? e.id : `#${i + 1}`;
    if (typeof e.id !== 'string' || e.id.trim() === '') {
      issues.push({ field: `${field}.id`, message: `Edge ${i + 1} has an empty ID.` });
    } else if (edgeIds.has(e.id)) {
      issues.push({ field: `${field}.id`, message: `Edge ID ${e.id} is used more than once.` });
    } else {
      edgeIds.add(e.id);
    }
    let endpointsOk = true;
    for (const end of ['u', 'v'] as const) {
      if (!vertexIds.has(e[end])) {
        issues.push({ field: `${field}.${end}`, message: `Edge ${name} references an unknown vertex.` });
        endpointsOk = false;
      }
    }
    if (!endpointsOk) return;
    if (e.u === e.v) {
      issues.push({ field, message: `Edge ${name} is a self-loop; loops are not allowed.` });
      return;
    }
    const key = JSON.stringify(e.u < e.v ? [e.u, e.v] : [e.v, e.u]);
    const other = pairs.get(key);
    if (other !== undefined) {
      issues.push({ field, message: `Edge ${name} duplicates edge ${other}; parallel edges are not allowed.` });
    } else {
      pairs.set(key, name);
    }
  });
  return issues;
}
