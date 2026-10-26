import type { EditorState } from '../editor/state';
import { budgetUpperBound, isResultStale } from '../editor/state';
import { formatMs, resultChip } from './describe';

export interface SolveClusterProps {
  state: EditorState;
  canSolve: boolean;
  onBudgetChange: (budget: number) => void;
  onSolve: () => void;
  onFindMinimum: () => void;
  onCancel: () => void;
}

export function SolveCluster({ state, canSolve, onBudgetChange, onSolve, onFindMinimum, onCancel }: SolveClusterProps) {
  const running = state.run.status === 'running';
  const upper = budgetUpperBound(state);
  const sliderDisabled = !canSolve || running;
  const chip = resultChip(state.result, isResultStale(state));
  const progress = state.run.progress;

  return (
    <section className="card solve-cluster" aria-labelledby="solve-heading">
      <h2 id="solve-heading">Solve</h2>
      <label className="budget">
        <span className="budget-label">
          Buffer budget <output className="budget-value">{state.budget}</output>
          <span className="muted"> (0–{upper})</span>
        </span>
        <input
          type="range"
          min={0}
          max={upper}
          step={1}
          value={state.budget}
          disabled={sliderDisabled}
          aria-valuetext={`Budget ${state.budget}`}
          onChange={(e) => onBudgetChange(Number(e.target.value))}
        />
      </label>
      <div className="button-row solve-buttons">
        {running ? (
          <button type="button" className="cancel" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <>
            <button type="button" className="primary" disabled={!canSolve} onClick={onSolve}>
              Solve
            </button>
            <button type="button" disabled={!canSolve} onClick={onFindMinimum}>
              Find minimum buffer
            </button>
          </>
        )}
      </div>
      {!canSolve && !running && <p className="hint">Fix the issues above to enable solving.</p>}
      <div className={`result-chip tone-${running ? 'running' : chip.tone}`} role="status" aria-live="polite">
        {running ? (
          <>
            <span className="chip-icon spinner" aria-hidden="true" />
            <div>
              <div>
                {state.run.mode === 'find-minimum' ? 'Finding minimum buffer — ' : ''}Searching budget {progress?.budget ?? (state.run.mode === 'budget' ? state.budget : 0)}…
              </div>
              <div className="chip-detail">
                {(progress?.expandedStates ?? 0).toLocaleString('en-US')} states explored · queue {(progress?.queueSize ?? 0).toLocaleString('en-US')} ·{' '}
                {formatMs(progress?.elapsedMs ?? 0)}
              </div>
            </div>
          </>
        ) : (
          <>
            <span className="chip-icon" aria-hidden="true">
              {chip.icon}
            </span>
            <div>
              <div>{chip.text}</div>
              {chip.detail && <div className="chip-detail">{chip.detail}</div>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
