import { EDGE_ENCODINGS, PALETTE, type EdgeRole } from './encoding';

const ROLES: EdgeRole[] = ['host', 'source', 'target', 'both', 'current', 'added', 'removed'];

function Sample({ role }: { role: EdgeRole }) {
  const e = EDGE_ENCODINGS[role];
  const dash = e.lineStyle === 'dashed' ? '8 4' : e.lineStyle === 'dotted' ? '2 4' : undefined;
  // The current-configuration overlay is an outline drawn around whichever role color the edge has.
  const inner = role === 'current' ? '#bbbbbb' : e.color;
  return (
    <svg width="54" height="18" viewBox="0 0 54 18" aria-hidden="true">
      {e.outline && <line x1="4" y1="9" x2="50" y2="9" stroke={PALETTE.current} strokeWidth={e.width + 6} />}
      <line x1="4" y1="9" x2="50" y2="9" stroke={inner} strokeWidth={e.width} strokeDasharray={dash} strokeLinecap={e.lineStyle === 'dotted' ? 'round' : 'butt'} />
      {e.marker === 'diamond' && <polygon points="27,2 34,9 27,16 20,9" fill={e.color} stroke="#ffffff" strokeWidth="1" />}
      {e.text && (
        <text x="27" y="13" textAnchor="middle" fontSize="12" fontWeight="700" fill="#111" stroke="#fff" strokeWidth="3" paintOrder="stroke">
          {e.text}
        </text>
      )}
    </svg>
  );
}

export function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      {ROLES.map((role) => (
        <div key={role} className="legend-item">
          <Sample role={role} />
          <span>{EDGE_ENCODINGS[role].label}</span>
        </div>
      ))}
    </div>
  );
}
