import type { IndexedGraph } from '../domain/graph';
import type { MoveModelId } from '../domain/moveModel';

/** Typed policy for which one-token replacements are legal in a reconfiguration model. */
export interface MoveModel {
  readonly id: MoveModelId;
  readonly name: string;
  readonly description: string;
  canReplace(removedEdge: number, addedEdge: number, graph: IndexedGraph): boolean;
}
