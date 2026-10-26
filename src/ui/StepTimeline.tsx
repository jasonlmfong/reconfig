import { useEffect, useRef, type Dispatch } from 'react';
import type { ReachableResult } from '../domain/result';
import type { EditorAction, PlaybackState } from '../editor/state';
import { moveTypeLabel } from './describe';

export function StepTimeline({
  result,
  playback,
  dispatch,
  active,
}: {
  result: ReachableResult | null;
  playback: PlaybackState;
  dispatch: Dispatch<EditorAction>;
  active: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [playback.index]);

  const steps = result?.steps ?? [];
  const last = steps.length - 1;
  const disabled = !active || steps.length === 0;

  return (
    <section className="card timeline" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">Move sequence</h2>
      <div className="button-row playback-controls">
        <button type="button" disabled={disabled || playback.index === 0} onClick={() => dispatch({ type: 'playbackPrev' })}>
          ◀ Previous
        </button>
        {playback.playing ? (
          <button type="button" disabled={disabled} onClick={() => dispatch({ type: 'playbackPause' })}>
            ❚❚ Pause
          </button>
        ) : (
          <button type="button" disabled={disabled || last === 0} onClick={() => dispatch({ type: 'playbackPlay' })}>
            ▶ Play
          </button>
        )}
        <button type="button" disabled={disabled || playback.index >= last} onClick={() => dispatch({ type: 'playbackNext' })}>
          Next ▶
        </button>
        <button type="button" disabled={disabled} onClick={() => dispatch({ type: 'playbackReset' })}>
          Reset
        </button>
      </div>
      {steps.length === 0 ? (
        <p className="muted">Solve a reachable instance to see its move sequence.</p>
      ) : (
        <ol ref={listRef} className={`steps ${active ? '' : 'inactive'}`}>
          {steps.map((step, i) => (
            <li key={step.index} aria-current={active && i === playback.index ? 'step' : undefined}>
              <button type="button" disabled={!active} onClick={() => dispatch({ type: 'playbackGoto', index: i })}>
                <span className="step-index">{step.index}</span>
                <span className={`step-type type-${step.moveType}`}>{moveTypeLabel(step)}</span>
                <span className="step-change">
                  {step.removedEdgeId && <span className="removed">× {step.removedEdgeId}</span>}
                  {step.addedEdgeId && <span className="added">+ {step.addedEdgeId}</span>}
                </span>
                <span className="step-buffer" title="Buffer occupancy">
                  buffer {step.bufferOccupancy}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
