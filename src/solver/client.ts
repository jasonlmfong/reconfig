import { SOLVER_VERSION } from "../domain/constants";
import type { Problem } from "../domain/problem";
import type {
    SolveProgress,
    SolveRequest,
    SolverResult,
} from "../domain/result";
import { messages } from "../validation/messages";
import { verifySequence } from "../verify/verifySequence";
import type { MainToWorker, WorkerToMain } from "./protocol";

/** The subset of `Worker` the client relies on (lets tests substitute a fake). */
export interface WorkerLike {
    postMessage(message: MainToWorker): void;
    terminate(): void;
    onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: ((event: MessageEvent) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

const defaultFactory: WorkerFactory = () =>
    new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
    }) as unknown as WorkerLike;

function resultBase(problem: Problem, request: SolveRequest) {
    return {
        mode: request.mode,
        property: problem.property,
        moveModel: problem.moveModel ?? "token-jumping",
        sourceSize: new Set(problem.sourceEdgeIds).size,
        targetSize: new Set(problem.targetEdgeIds).size,
        exploredStates: 0,
        elapsedMs: 0,
        solverVersion: SOLVER_VERSION,
    };
}

/** Non-conclusive result for a run that could not complete; never a reachability claim. */
export function failedRunResult(
    problem: Problem,
    request: SolveRequest,
    message = messages.workerFailed()
): SolverResult {
    return {
        ...resultBase(problem, request),
        status: "internal-error",
        message,
    };
}

interface Pending {
    requestId: number;
    problem: Problem;
    request: SolveRequest;
    startedAt: number;
    lastProgress: SolveProgress | null;
    resolve: (result: SolverResult) => void;
    onProgress?: (progress: SolveProgress) => void;
}

/**
 * Runs solves in a module Web Worker. Cancel terminates the worker and creates a fresh one;
 * cancellation and worker failure never produce `not-reachable`. Every reachable result is
 * checked with `verifySequence` before it is returned.
 */
export class SolverClient {
    private worker: WorkerLike | null = null;
    private pending: Pending | null = null;
    private nextId = 1;

    constructor(
        private readonly factory: WorkerFactory = defaultFactory,
        private readonly now: () => number = () => performance.now()
    ) {}

    get busy(): boolean {
        return this.pending !== null;
    }

    solve(
        problem: Problem,
        request: SolveRequest,
        onProgress?: (p: SolveProgress) => void
    ): Promise<SolverResult> {
        if (this.pending) {
            return Promise.reject(new Error("A solve is already running."));
        }
        const requestId = this.nextId++;
        return new Promise<SolverResult>((resolve) => {
            const pending: Pending = {
                requestId,
                problem,
                request,
                startedAt: this.now(),
                lastProgress: null,
                resolve,
                onProgress,
            };
            this.pending = pending;
            try {
                this.ensureWorker().postMessage({
                    type: "solve",
                    requestId,
                    problem,
                    request,
                });
            } catch {
                // Worker construction or message cloning failed: report a failed run, never a negative result.
                this.handleFailure();
            }
        });
    }

    cancel(): void {
        const pending = this.pending;
        this.resetWorker(true);
        if (pending)
            this.finish(pending, this.syntheticResult(pending, "cancelled"));
    }

    dispose(): void {
        const pending = this.pending;
        this.resetWorker(false);
        if (pending)
            this.finish(pending, this.syntheticResult(pending, "cancelled"));
    }

    private ensureWorker(): WorkerLike {
        if (this.worker) return this.worker;
        const worker = this.factory();
        worker.onmessage = (event) => this.handleMessage(event.data);
        worker.onerror = (event) => {
            event.preventDefault?.();
            this.handleFailure();
        };
        worker.onmessageerror = () => this.handleFailure();
        this.worker = worker;
        return worker;
    }

    private resetWorker(recreate: boolean): void {
        if (this.worker) {
            this.worker.onmessage = null;
            this.worker.onerror = null;
            this.worker.onmessageerror = null;
            this.worker.terminate();
        }
        this.worker = null;
        if (!recreate) return;
        // Recreate eagerly so the next solve starts without delay.
        try {
            this.ensureWorker();
        } catch {
            this.worker = null;
        }
    }

    private handleMessage(message: WorkerToMain): void {
        const pending = this.pending;
        if (!pending || message.requestId !== pending.requestId) return;
        if (message.type === "progress") {
            pending.lastProgress = message.progress;
            pending.onProgress?.(message.progress);
            return;
        }
        this.finish(pending, this.checkResult(pending, message.result));
    }

    private handleFailure(): void {
        const pending = this.pending;
        this.resetWorker(true);
        if (pending)
            this.finish(
                pending,
                this.syntheticResult(pending, "internal-error")
            );
    }

    private checkResult(pending: Pending, result: SolverResult): SolverResult {
        const problems: string[] = [];
        if (result.mode !== pending.request.mode) {
            problems.push(
                `result mode ${result.mode} does not match requested mode ${pending.request.mode}`
            );
        }
        if (result.status !== "reachable") {
            if (problems.length === 0) return result;
        } else {
            if (
                pending.request.mode === "budget" &&
                result.budget !== pending.request.budget
            ) {
                problems.push(
                    `result budget ${result.budget} does not match requested budget ${pending.request.budget}`
                );
            }
            // isMinimum cannot be replayed; it rests on the solver's exhaustive lower-budget passes.
            problems.push(...verifySequence(pending.problem, result).errors);
        }
        if (problems.length === 0) return result;
        return {
            mode: result.mode,
            property: result.property,
            moveModel: result.moveModel,
            sourceSize: result.sourceSize,
            targetSize: result.targetSize,
            exploredStates: result.exploredStates,
            elapsedMs: result.elapsedMs,
            solverVersion: result.solverVersion,
            status: "internal-error",
            message: `The solver returned a result that failed verification: ${problems.join("; ")}.`,
        };
    }

    private syntheticResult(
        pending: Pending,
        status: "cancelled" | "internal-error"
    ): SolverResult {
        const base = {
            ...resultBase(pending.problem, pending.request),
            exploredStates: pending.lastProgress?.expandedStates ?? 0,
            elapsedMs: this.now() - pending.startedAt,
        };
        return status === "cancelled"
            ? { ...base, status: "cancelled" }
            : {
                  ...base,
                  status: "internal-error",
                  message: messages.workerFailed(),
              };
    }

    private finish(pending: Pending, result: SolverResult): void {
        if (this.pending !== pending) return;
        this.pending = null;
        pending.resolve(result);
    }
}
