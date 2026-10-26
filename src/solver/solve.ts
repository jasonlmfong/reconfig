import { DEFAULT_LIMITS, SOLVER_VERSION, type GraphLimits } from '../domain/constants';
import { indexGraph, type IndexedGraph } from '../domain/graph';
import { edgeIdsFromMask, maskFromEdgeIds, popcount } from '../domain/mask';
import type { Problem } from '../domain/problem';
import type { SolveProgress, SolveRequest, SolverResult, Step } from '../domain/result';
import { maxBudget, PROPERTIES, type GraphProperty } from '../properties';
import { validateProblem } from '../validation/problemValidation';
import { MOVE_MODELS } from '../moveModels';
import { createSearchContext, findMinimumBuffer, searchAtBudget } from './search';

export interface SolveOptions {
  /** Test hook: replace the registered property (e.g. a stub). */
  property?: GraphProperty;
  limits?: GraphLimits;
  onProgress?: (progress: SolveProgress) => void;
  progressInterval?: number;
  now?: () => number;
}

const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Runs one solver action synchronously and returns a typed result (§6.2). */
export function solveProblem(problem: Problem, request: SolveRequest, options: SolveOptions = {}): SolverResult {
  const now = options.now ?? defaultNow;
  const started = now();
  const property = options.property ?? PROPERTIES[problem.property];
  const base = {
    mode: request.mode,
    property: property?.id ?? String(problem.property),
    moveModel: problem.moveModel ?? 'token-jumping',
    sourceSize: new Set(problem.sourceEdgeIds).size,
    targetSize: new Set(problem.targetEdgeIds).size,
    exploredStates: 0,
    elapsedMs: 0,
    solverVersion: SOLVER_VERSION,
  };

  try {
    const check = validateProblem(problem, options.limits ?? DEFAULT_LIMITS, options.property);
    const errors = [...check.issues];
    if (check.canSolve && request.mode === 'budget') {
      const upper = maxBudget(property, check.q);
      if (!Number.isInteger(request.budget) || request.budget < 0 || request.budget > upper) {
        errors.push({ field: 'bufferBudget', message: `Buffer budget must be an integer from 0 to ${upper}.` });
      }
    }
    if (errors.length > 0 || !check.canSolve) {
      return { ...base, status: 'invalid-input', errors, elapsedMs: now() - started };
    }

    const graph = indexGraph(problem.graph);
    const ctx = createSearchContext(
      graph,
      property,
      maskFromEdgeIds(problem.sourceEdgeIds, graph),
      maskFromEdgeIds(problem.targetEdgeIds, graph),
      MOVE_MODELS[problem.moveModel ?? 'token-jumping'],
    );
    const onProgress = options.onProgress;
    const hooks = {
      progressInterval: options.progressInterval,
      onProgress: onProgress
        ? (budget: number, expandedStates: number, queueSize: number) =>
            onProgress({ budget, expandedStates, queueSize, elapsedMs: now() - started })
        : undefined,
    };

    if (request.mode === 'budget') {
      const pass = searchAtBudget(ctx, request.budget, hooks);
      const common = { ...base, exploredStates: pass.expanded, budget: request.budget };
      if (!pass.reachable || !pass.path) {
        return { ...common, status: 'not-reachable', elapsedMs: now() - started };
      }
      const steps = buildSteps(pass.path, graph, ctx.q, ctx.moveModel.id);
      return { ...common, status: 'reachable', moveCount: steps.length - 1, steps, elapsedMs: now() - started };
    }

    const min = findMinimumBuffer(ctx, hooks);
    if (min.budget === null || !min.pass?.path) {
      return {
        ...base,
        status: 'not-reachable',
        bufferResult: 'infinite',
        exploredStates: min.totalExpanded,
        elapsedMs: now() - started,
      };
    }
    const steps = buildSteps(min.pass.path, graph, ctx.q, ctx.moveModel.id);
    return {
      ...base,
      status: 'reachable',
      budget: min.budget,
      isMinimum: true,
      moveCount: steps.length - 1,
      steps,
      exploredStates: min.totalExpanded,
      elapsedMs: now() - started,
    };
  } catch (err) {
    return {
      ...base,
      status: 'internal-error',
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: now() - started,
    };
  }
}

/** Converts a mask path into one-based steps that name the edges changed by each move. */
export function buildSteps(path: number[], graph: IndexedGraph, q: number, model: 'token-jumping' | 'token-sliding' = 'token-jumping'): Step[] {
  return path.map((mask, i): Step => {
    const configurationEdgeIds = edgeIdsFromMask(mask, graph);
    const bufferOccupancy = q - popcount(mask);
    if (i === 0) return { index: 1, moveType: 'initial', configurationEdgeIds, bufferOccupancy };
    const prev = path[i - 1];
    const removed = prev & ~mask;
    const added = mask & ~prev;
    const removedEdgeId = removed ? edgeIdsFromMask(removed, graph)[0] : undefined;
    const addedEdgeId = added ? edgeIdsFromMask(added, graph)[0] : undefined;
    if (removedEdgeId !== undefined && addedEdgeId !== undefined) {
      return { index: i + 1, moveType: model === 'token-sliding' ? 'token-slide' : 'token-jump', removedEdgeId, addedEdgeId, configurationEdgeIds, bufferOccupancy };
    }
    if (removedEdgeId !== undefined) {
      return { index: i + 1, moveType: 'buffer-store', removedEdgeId, configurationEdgeIds, bufferOccupancy };
    }
    return { index: i + 1, moveType: 'buffer-retrieve', addedEdgeId, configurationEdgeIds, bufferOccupancy };
  });
}
