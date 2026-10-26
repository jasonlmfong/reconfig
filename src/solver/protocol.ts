import type { Problem } from '../domain/problem';
import type { SolveProgress, SolveRequest, SolverResult } from '../domain/result';

/** Typed postMessage protocol between the main thread and the solver worker. */
export interface SolveMessage {
  type: 'solve';
  requestId: number;
  problem: Problem;
  request: SolveRequest;
}

export type MainToWorker = SolveMessage;

export interface ProgressMessage {
  type: 'progress';
  requestId: number;
  progress: SolveProgress;
}

export interface ResultMessage {
  type: 'result';
  requestId: number;
  result: SolverResult;
}

export type WorkerToMain = ProgressMessage | ResultMessage;

/** Minimum interval between progress messages posted by the worker. */
export const PROGRESS_THROTTLE_MS = 100;
