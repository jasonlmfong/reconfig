import { SCHEMA_VERSION } from './constants';
import type { Graph } from './graph';
import type { PropertyId } from './problem';
import type { MoveModelId } from './moveModel';

/** Saved project JSON, schema version 1 (§6.1). */
export interface ProjectFile {
  schemaVersion: typeof SCHEMA_VERSION;
  projectName: string;
  graph: Graph;
  property: PropertyId;
  moveModel?: MoveModelId;
  sourceEdgeIds: string[];
  targetEdgeIds: string[];
  bufferBudget?: number;
  /** Untrusted on import; always discarded (§6.1). */
  lastResult?: unknown;
}

export function serializeProject(project: ProjectFile): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}
