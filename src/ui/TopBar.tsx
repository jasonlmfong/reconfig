import { useRef, useState, type ChangeEvent } from 'react';
import { EXAMPLES } from '../examples/fixtures';

export interface TopBarProps {
  projectName: string;
  vertexCount: number;
  edgeCount: number;
  maxVertices: number;
  maxEdges: number;
  locked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canExportResult: boolean;
  onRenameProject: (name: string) => void;
  onNew: () => void;
  onLoadExample: (id: string) => void;
  onImportFile: (file: File) => void;
  onExportProject: () => void;
  onExportResult: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function TopBar(props: TopBarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [draftName, setDraftName] = useState<string | null>(null);
  const atVertexCap = props.vertexCount >= props.maxVertices;
  const atEdgeCap = props.edgeCount >= props.maxEdges;

  const commitName = () => {
    if (draftName !== null && draftName.trim() !== '') props.onRenameProject(draftName.trim());
    setDraftName(null);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">ReconfigLab</span>
        <input
          className="project-name"
          aria-label="Project name"
          value={draftName ?? props.projectName}
          disabled={props.locked}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraftName(null);
          }}
        />
      </div>
      <div className="toolbar" role="toolbar" aria-label="Project">
        <button type="button" onClick={props.onNew} disabled={props.locked}>
          New
        </button>
        <select
          aria-label="Load example"
          value=""
          disabled={props.locked}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            if (e.target.value) props.onLoadExample(e.target.value);
          }}
        >
          <option value="">Load example…</option>
          {EXAMPLES.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={props.locked}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) props.onImportFile(file);
          }}
        />
        <button type="button" onClick={props.onExportProject}>
          Export
        </button>
        <button type="button" onClick={props.onExportResult} disabled={!props.canExportResult} title="Export the current, verified solver result as JSON">
          Export result
        </button>
        <span className="divider" aria-hidden="true" />
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo} title="Redo (Ctrl+Y)">
          Redo
        </button>
      </div>
      <div className="counters" aria-live="polite">
        <span className={atVertexCap ? 'at-cap' : undefined}>
          Vertices {props.vertexCount} / {props.maxVertices}
        </span>
        <span className={atEdgeCap ? 'at-cap' : undefined}>
          Edges {props.edgeCount} / {props.maxEdges}
        </span>
      </div>
    </header>
  );
}
