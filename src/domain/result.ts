import type { MoveModelId } from './moveModel';

export type SolveMode = 'budget' | 'find-minimum';

export type SolverStatus = 'invalid-input' | 'reachable' | 'not-reachable' | 'cancelled' | 'internal-error';

export type MoveType = 'initial' | 'token-jump' | 'token-slide' | 'buffer-store' | 'buffer-retrieve';

export interface Step {
  /** One-based. */
  index: number;
  moveType: MoveType;
  removedEdgeId?: string;
  addedEdgeId?: string;
  /** Resulting configuration, in canonical edge order. */
  configurationEdgeIds: string[];
  bufferOccupancy: number;
}

export interface ValidationIssue {
  /** Field path, e.g. `source`, `graph.edges[3].u`. */
  field: string;
  message: string;
}

interface ResultBase {
  mode: SolveMode;
  property: string;
  /** Model used for this solve; absent only on results written by older versions. */
  moveModel?: MoveModelId;
  sourceSize: number;
  targetSize: number;
  /** Expansions; cumulative across passes in find-minimum mode. */
  exploredStates: number;
  elapsedMs: number;
  solverVersion: string;
}

export interface ReachableResult extends ResultBase {
  status: 'reachable';
  /** Budget searched; in find-minimum mode, the minimum found. */
  budget: number;
  isMinimum?: true;
  moveCount: number;
  steps: Step[];
}

export interface NotReachableResult extends ResultBase {
  status: 'not-reachable';
  /** Exhausted budget (budget mode only). */
  budget?: number;
  /** Present only in find-minimum mode: no budget works under the model. */
  bufferResult?: 'infinite';
}

export interface InvalidInputResult extends ResultBase {
  status: 'invalid-input';
  errors: ValidationIssue[];
}

export interface CancelledResult extends ResultBase {
  status: 'cancelled';
}

export interface InternalErrorResult extends ResultBase {
  status: 'internal-error';
  message: string;
}

export type SolverResult =
  | ReachableResult
  | NotReachableResult
  | InvalidInputResult
  | CancelledResult
  | InternalErrorResult;

export interface SolveRequest {
  mode: SolveMode;
  /** Required for `budget` mode; ignored for `find-minimum`. */
  budget: number;
}

export interface SolveProgress {
  budget: number;
  expandedStates: number;
  queueSize: number;
  elapsedMs: number;
}
