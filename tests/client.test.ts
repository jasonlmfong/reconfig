import { describe, expect, it } from "vitest";
import type { Problem } from "../src/domain/problem";
import type { SolverResult } from "../src/domain/result";
import { fixtureB } from "../src/examples/fixtures";
import { SolverClient, type WorkerLike } from "../src/solver/client";
import type { MainToWorker, WorkerToMain } from "../src/solver/protocol";
import { solveProblem } from "../src/solver/solve";
import { messages } from "../src/validation/messages";
import { problemOf } from "./helpers";

/** In-process stand-in for the module worker. `auto` answers with the real solver. */
class FakeWorker implements WorkerLike {
    onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    posted: MainToWorker[] = [];
    terminated = false;

    constructor(
        private readonly auto: boolean,
        private readonly transform?: (r: SolverResult) => SolverResult
    ) {}

    postMessage(message: MainToWorker): void {
        this.posted.push(message);
        if (!this.auto) return;
        queueMicrotask(() => {
            const result = solveProblem(message.problem, message.request);
            this.emit({
                type: "progress",
                requestId: message.requestId,
                progress: {
                    budget: 0,
                    expandedStates: 1,
                    queueSize: 0,
                    elapsedMs: 0,
                },
            });
            this.emit({
                type: "result",
                requestId: message.requestId,
                result: this.transform ? this.transform(result) : result,
            });
        });
    }

    terminate(): void {
        this.terminated = true;
    }

    emit(message: WorkerToMain): void {
        if (!this.terminated)
            this.onmessage?.({ data: message } as MessageEvent<WorkerToMain>);
    }

    crash(): void {
        this.onerror?.({ preventDefault() {} } as ErrorEvent);
    }
}

const problem: Problem = problemOf(fixtureB());

describe("SolverClient (worker protocol)", () => {
    it("returns verified results and forwards progress", async () => {
        const workers: FakeWorker[] = [];
        const client = new SolverClient(() => {
            const w = new FakeWorker(true);
            workers.push(w);
            return w;
        });
        const progress: number[] = [];
        const result = await client.solve(
            problem,
            { mode: "find-minimum", budget: 0 },
            (p) => progress.push(p.expandedStates)
        );
        expect(result.status).toBe("reachable");
        expect(progress).toEqual([1]);
        expect(workers).toHaveLength(1);
        expect(workers[0].posted[0]).toMatchObject({
            type: "solve",
            request: { mode: "find-minimum" },
        });
        expect(client.busy).toBe(false);
    });

    it("cancel terminates the worker, creates a fresh one, and never reports not-reachable", async () => {
        const workers: FakeWorker[] = [];
        const client = new SolverClient(() => {
            const w = new FakeWorker(false);
            workers.push(w);
            return w;
        });
        const pending = client.solve(problem, { mode: "budget", budget: 0 });
        workers[0].emit({
            type: "progress",
            requestId: 1,
            progress: {
                budget: 0,
                expandedStates: 42,
                queueSize: 3,
                elapsedMs: 10,
            },
        });
        client.cancel();
        const result = await pending;
        expect(result.status).toBe("cancelled");
        expect(result.exploredStates).toBe(42);
        expect(workers[0].terminated).toBe(true);
        expect(workers).toHaveLength(2);
        expect(workers[1].terminated).toBe(false);
        // A late message from the terminated worker is ignored.
        workers[0].terminated = false;
        workers[0].emit({
            type: "result",
            requestId: 1,
            result: solveProblem(problem, { mode: "budget", budget: 0 }),
        });
        expect(client.busy).toBe(false);
    });

    it("a worker crash yields internal-error, not a negative result", async () => {
        const workers: FakeWorker[] = [];
        const client = new SolverClient(() => {
            const w = new FakeWorker(false);
            workers.push(w);
            return w;
        });
        const pending = client.solve(problem, {
            mode: "find-minimum",
            budget: 0,
        });
        workers[0].crash();
        const result = await pending;
        expect(result.status).toBe("internal-error");
        expect(result.status === "internal-error" && result.message).toBe(
            messages.workerFailed()
        );
        expect(workers).toHaveLength(2);
    });

    it("a sequence that fails verification is reported as internal-error, never displayed", async () => {
        const client = new SolverClient(
            () =>
                new FakeWorker(true, (r) => {
                    if (r.status !== "reachable") return r;
                    return {
                        ...r,
                        steps: r.steps.slice(0, -1),
                        moveCount: r.moveCount - 1,
                    };
                })
        );
        const result = await client.solve(problem, {
            mode: "budget",
            budget: 1,
        });
        expect(result.status).toBe("internal-error");
        expect(result.status === "internal-error" && result.message).toContain(
            "failed verification"
        );
    });

    it("rejects a result whose budget differs from the request", async () => {
        const client = new SolverClient(
            () =>
                new FakeWorker(true, (r) =>
                    r.status === "reachable" ? { ...r, budget: 2 } : r
                )
        );
        const result = await client.solve(problem, {
            mode: "budget",
            budget: 1,
        });
        expect(result.status).toBe("internal-error");
    });

    it("rejects a result whose mode differs from the request, even when it is negative", async () => {
        const client = new SolverClient(
            () => new FakeWorker(true, (r) => ({ ...r, mode: "find-minimum" }))
        );
        const result = await client.solve(problem, {
            mode: "budget",
            budget: 0,
        });
        expect(result.status).toBe("internal-error");
        expect(result.status === "internal-error" && result.message).toContain(
            "result mode find-minimum does not match requested mode budget"
        );
    });

    it("dispose terminates the worker without starting a replacement", async () => {
        const workers: FakeWorker[] = [];
        const client = new SolverClient(() => {
            const w = new FakeWorker(false);
            workers.push(w);
            return w;
        });
        const pending = client.solve(problem, { mode: "budget", budget: 0 });
        client.dispose();
        expect((await pending).status).toBe("cancelled");
        expect(workers).toHaveLength(1);
        expect(workers[0].terminated).toBe(true);
    });

    it("refuses concurrent solves", async () => {
        const client = new SolverClient(() => new FakeWorker(false));
        const first = client.solve(problem, { mode: "budget", budget: 0 });
        await expect(
            client.solve(problem, { mode: "budget", budget: 0 })
        ).rejects.toThrow("already running");
        client.cancel();
        expect((await first).status).toBe("cancelled");
    });

    it("resolves internal-error (and frees the client) when the worker cannot be created or messaged", async () => {
        const throwing = new SolverClient(() => {
            throw new Error("module workers blocked");
        });
        const r1 = await throwing.solve(problem, { mode: "budget", budget: 1 });
        expect(r1.status).toBe("internal-error");
        expect(throwing.busy).toBe(false);

        class UncloneableWorker extends FakeWorker {
            override postMessage(): void {
                throw new Error("DataCloneError");
            }
        }
        const uncloneable = new SolverClient(
            () => new UncloneableWorker(false)
        );
        const r2 = await uncloneable.solve(problem, {
            mode: "find-minimum",
            budget: 0,
        });
        expect(r2.status).toBe("internal-error");
        expect(uncloneable.busy).toBe(false);
    });
});
