/**
 * Visual encodings (§4.2). Okabe-Ito colors, each reinforced by a non-color channel
 * (line style, width, marker, or text label). Shared by the canvas stylesheet, the legend,
 * and the color-vision-deficiency test.
 */
export type EdgeRole = 'host' | 'source' | 'target' | 'both' | 'current' | 'added' | 'removed';

export interface EdgeEncoding {
  role: EdgeRole;
  label: string;
  color: string;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  width: number;
  marker: 'none' | 'diamond';
  /** Text shown on the edge in addition to its ID. */
  text: string;
  /** Black outline around the line (current configuration during playback). */
  outline: boolean;
}

export const PALETTE = {
  host: '#999999',
  source: '#0072B2',
  target: '#D55E00',
  both: '#CC79A7',
  added: '#009E73',
  current: '#000000',
  pending: '#E69F00',
} as const;

export const EDGE_ENCODINGS: Record<EdgeRole, EdgeEncoding> = {
  host: { role: 'host', label: 'Host edge', color: PALETTE.host, lineStyle: 'solid', width: 2, marker: 'none', text: '', outline: false },
  source: { role: 'source', label: 'Source only', color: PALETTE.source, lineStyle: 'solid', width: 5, marker: 'none', text: '', outline: false },
  target: { role: 'target', label: 'Target only', color: PALETTE.target, lineStyle: 'dashed', width: 5, marker: 'none', text: '', outline: false },
  both: { role: 'both', label: 'Source and target', color: PALETTE.both, lineStyle: 'solid', width: 5, marker: 'diamond', text: '', outline: false },
  current: { role: 'current', label: 'Current configuration (black outline)', color: PALETTE.current, lineStyle: 'solid', width: 5, marker: 'none', text: '', outline: true },
  added: { role: 'added', label: 'Added this step', color: PALETTE.added, lineStyle: 'solid', width: 8, marker: 'none', text: '+', outline: true },
  removed: { role: 'removed', label: 'Removed this step', color: PALETTE.host, lineStyle: 'dotted', width: 3, marker: 'none', text: '×', outline: false },
};
