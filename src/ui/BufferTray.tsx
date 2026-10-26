import type { MoveModelId } from "../domain/moveModel";
import type { Step } from "../domain/result";

const DIRECT_MOVES: Record<MoveModelId, string> = {
    "token-jumping": "Token Jumping",
    "token-sliding": "Token Sliding",
};

export function BufferTray({
    step,
    budget,
    explanation,
    active,
    moveModel,
}: {
    step: Step | null;
    budget: number;
    explanation: string | null;
    active: boolean;
    moveModel: MoveModelId;
}) {
    const occupancy = active && step ? step.bufferOccupancy : 0;
    const slots = Math.max(budget, occupancy);
    return (
        <section className="card buffer-tray" aria-labelledby="buffer-heading">
            <h2 id="buffer-heading">Buffer tray</h2>
            <div
                className="tray"
                aria-label={`Buffer holds ${occupancy} of ${budget} tokens`}
            >
                {slots === 0 ? (
                    <span className="muted">
                        Budget 0 — {DIRECT_MOVES[moveModel]} only, no buffer
                        slots.
                    </span>
                ) : (
                    Array.from({ length: slots }, (_, i) => (
                        <span
                            key={i}
                            className={`token ${i < occupancy ? "filled" : "empty"}`}
                            aria-hidden="true"
                        >
                            {i < occupancy ? "●" : "○"}
                        </span>
                    ))
                )}
            </div>
            <div className="tray-count">
                <strong>{occupancy}</strong> token{occupancy === 1 ? "" : "s"}{" "}
                held{budget > 0 ? ` (budget ${budget})` : ""}
            </div>
            <p className="tray-explanation">
                {active && explanation
                    ? explanation
                    : "Tokens are anonymous edge-tokens temporarily removed from the selected subgraph. A retrieve may place a token on any unselected host edge."}
            </p>
        </section>
    );
}
