import type { SolverResult } from '../domain/result';
import { PROPERTIES } from '../properties';
import { formatMs } from './describe';

export function Statistics({ result, stale }: { result: SolverResult | null; stale: boolean }) {
  if (!result) {
    return (
      <section className="card stats" aria-labelledby="stats-heading">
        <h2 id="stats-heading">Result</h2>
        <p className="muted">Set a budget and press Solve, or press Find minimum buffer.</p>
      </section>
    );
  }
  const budget =
    'budget' in result && result.budget !== undefined
      ? String(result.budget)
      : result.status === 'not-reachable' && result.bufferResult === 'infinite'
        ? '∞ (all budgets searched)'
        : '—';
  const moves = result.status === 'reachable' ? String(result.moveCount) : '—';
  const property = PROPERTIES[result.property as keyof typeof PROPERTIES]?.name ?? result.property;
  return (
    <section className={`card stats ${stale ? 'stale' : ''}`} aria-labelledby="stats-heading">
      <h2 id="stats-heading">Result{stale ? ' (stale)' : ''}</h2>
      <dl>
        <dt>Action</dt>
        <dd>{result.mode === 'find-minimum' ? 'Find minimum buffer' : 'Solve at budget'}</dd>
        <dt>{result.status === 'reachable' && result.isMinimum ? 'Minimum budget' : 'Budget searched'}</dt>
        <dd>{budget}</dd>
        <dt>Moves</dt>
        <dd>{moves}</dd>
        <dt>States explored</dt>
        <dd>{result.exploredStates.toLocaleString('en-US')}</dd>
        <dt>Elapsed</dt>
        <dd>{formatMs(result.elapsedMs)}</dd>
        <dt>Property</dt>
        <dd>{property}</dd>
        <dt>Sizes</dt>
        <dd>
          source {result.sourceSize}, target {result.targetSize}
        </dd>
      </dl>
    </section>
  );
}
