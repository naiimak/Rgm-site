import { useEffect, useState, type ReactNode } from 'react';

export function Avatar({ emoji, frame, size = 44, ring, active }: { emoji: string; frame?: string; size?: number; ring?: number; active?: boolean }) {
  const r = size / 2 + 3;
  const c = 2 * Math.PI * r;
  return (
    <div className={`avatar ${frame ?? ''}${active ? ' active' : ''}`} style={{ width: size, height: size, fontSize: size * 0.55 }}>
      <span>{emoji}</span>
      {ring !== undefined && (
        <svg className="ring" viewBox={`0 0 ${size + 8} ${size + 8}`} style={{ width: size + 8, height: size + 8 }} aria-hidden>
          <circle cx={size / 2 + 4} cy={size / 2 + 4} r={r} fill="none" stroke="currentColor" strokeWidth="3"
            strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, ring)))} transform={`rotate(-90 ${size / 2 + 4} ${size / 2 + 4})`} />
        </svg>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Stand-in for a rewarded video ad. In the store builds this is Google AdMob, and the reward is
 * granted only after the ad network confirms completion to the server.
 */
export function FakeAd({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(3);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <div className="modal-backdrop">
      <div className="modal ad">
        <div className="ad-screen">
          <div className="ad-label">Rewarded ad</div>
          <p>Your ad would play here.</p>
          <p className="muted">Store builds use Google AdMob; rewards are confirmed by the server.</p>
        </div>
        {left > 0 ? <button className="btn ghost" onClick={onCancel}>Skip (no reward) · {left}</button> : <button className="btn primary" onClick={onDone}>Claim reward</button>}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle-row">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle" aria-hidden />
    </label>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack ? <button className="icon-btn" onClick={onBack} aria-label="Back">←</button> : <span className="icon-btn-space" />}
      <h1>{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
