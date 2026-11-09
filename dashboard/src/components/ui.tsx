import { ReactNode, useState } from "react";
import { tone } from "../format";

export function Card({ title, right, children, className = "", flush = false }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${flush ? "flush" : ""} ${className}`}>
      {title && <h2>{title}{right && <span className="right">{right}</span>}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, valueTone }: { label: string; value: ReactNode; sub?: ReactNode; valueTone?: number | null }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${valueTone !== undefined ? tone(valueTone) : ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Meter({ value, max, invert = false }: { value: number; max: number; invert?: boolean }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const cls = invert ? (pct >= 100 ? "danger" : pct >= 66 ? "warn" : "") : "";
  return <div className={`meter ${cls}`}><div style={{ width: `${pct}%` }} /></div>;
}

export function StatusBadge({ status }: { status?: string }) {
  if (status === "Running") return <span className="badge up"><span className="dot pulse" /> En marche</span>;
  if (status === "EmergencyStopped") return <span className="badge down"><span className="dot" /> Arrêt d'urgence</span>;
  return <span className="badge warn"><span className="dot" /> Arrêté</span>;
}

export function ModeBadge({ mode }: { mode?: string }) {
  return mode === "Live"
    ? <span className="badge down">ARGENT RÉEL</span>
    : <span className="badge accent">Simulation (paper)</span>;
}

export function ActionButton({ onClick, children, className = "btn", confirm, disabled }: {
  onClick: () => Promise<unknown>; children: ReactNode; className?: string; confirm?: string; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="stack" style={{ gap: 4 }}>
      <button
        className={className}
        disabled={busy || disabled}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true); setErr(null);
          try { await onClick(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
        }}
      >
        {busy && <span className="spinner" />}{children}
      </button>
      {err && <span className="small down">{err}</span>}
    </span>
  );
}

export function Checks({ checks }: { checks: { name: string; passed: boolean; detail: string }[] }) {
  if (!checks?.length) return <div className="muted small">Aucune condition évaluée.</div>;
  return (
    <div className="checks">
      {checks.map((c) => (
        <div className="check" key={c.name}>
          <span className={c.passed ? "ok" : "ko"}>{c.passed ? "✔" : "✘"}</span>
          <div><div>{c.name}</div><div className="detail">{c.detail}</div></div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="notice danger">{error}</div> : null;
}
