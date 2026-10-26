import type { Dispatch } from 'react';
import type { EditorAction, EditorState } from '../editor/state';
import { PROPERTIES } from '../properties';
import type { ProblemCheck, RoleCheck } from '../validation/problemValidation';

export function SourceTargetEditor({
  state,
  dispatch,
  check,
  locked,
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  check: ProblemCheck;
  locked: boolean;
}) {
  const noun = PROPERTIES[state.doc.property].noun;
  return (
    <section className="card" aria-labelledby="selection-heading">
      <h2 id="selection-heading">Source &amp; target</h2>
      <RoleRow role="source" title="Source" check={check.source} noun={noun} />
      <RoleRow role="target" title="Target" check={check.target} noun={noun} />
      <div className="validity-messages" aria-live="polite">
        {check.graphIssues.map((issue, i) => (
          <p key={`g${i}`} className="validity bad">
            ✕ {issue.message}
          </p>
        ))}
        {check.emptyMessage && <p className="validity bad">✕ {check.emptyMessage}</p>}
        {check.sizeMessage && <p className="validity bad">✕ {check.sizeMessage}</p>}
        {!check.emptyMessage && !check.sizeMessage && check.source.size > 0 && (
          <p className="validity good">✓ Sizes match ({check.source.size} = {check.target.size})</p>
        )}
      </div>
      <div className="button-row">
        <button type="button" disabled={locked || state.doc.sourceEdgeIds.length === 0} onClick={() => dispatch({ type: 'clearSelection', role: 'source' })}>
          Clear source
        </button>
        <button type="button" disabled={locked || state.doc.targetEdgeIds.length === 0} onClick={() => dispatch({ type: 'clearSelection', role: 'target' })}>
          Clear target
        </button>
        <button
          type="button"
          disabled={locked || (state.doc.sourceEdgeIds.length === 0 && state.doc.targetEdgeIds.length === 0)}
          onClick={() => dispatch({ type: 'clearSelection', role: 'both' })}
        >
          Reset both
        </button>
      </div>
    </section>
  );
}

function RoleRow({ role, title, check, noun }: { role: 'source' | 'target'; title: string; check: RoleCheck; noun: string }) {
  return (
    <div className={`role-row role-${role}`}>
      <span className={`swatch swatch-${role}`} aria-hidden="true" />
      <span className="role-title">{title}</span>
      <span className="role-count">
        {check.size} edge{check.size === 1 ? '' : 's'}
      </span>
      {check.valid ? (
        <span className="validity good">✓ valid {noun}</span>
      ) : check.message ? (
        <span className="validity bad" title={check.message}>
          ✕ {check.message}
        </span>
      ) : (
        <span className="validity muted">—</span>
      )}
    </div>
  );
}
