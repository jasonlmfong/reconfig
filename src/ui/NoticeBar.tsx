import type { Notice } from '../editor/state';

export function NoticeBar({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  if (!notice) return null;
  const icon = notice.kind === 'error' ? '✕' : notice.kind === 'warning' ? '!' : 'i';
  return (
    <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="notice-body">
        <div>{notice.text}</div>
        {notice.details && notice.details.length > 0 && (
          <ul className="notice-details">
            {notice.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="notice-close" onClick={onDismiss} aria-label="Dismiss notice">
        ×
      </button>
    </div>
  );
}
