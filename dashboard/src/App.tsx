import { useEffect, useState, ReactNode } from "react";
import { api, connectLive, getToken, setToken, useLiveStatus, usePoll } from "./api";
import { StatusBadge, ModeBadge, ActionButton } from "./components/ui";
import { ago } from "./format";
import Overview from "./pages/Overview";
import Trading from "./pages/Trading";
import Bot from "./pages/Bot";
import Risk from "./pages/Risk";
import Backtest from "./pages/Backtest";
import Analysis from "./pages/Analysis";
import Journal from "./pages/Journal";

const icon = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

const PAGES: { id: string; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Vue générale", icon: icon("M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z") },
  { id: "trading", label: "Trading", icon: icon("M3 17l6-6 4 4 8-8M14 7h7v7") },
  { id: "bot", label: "Bot", icon: icon("M12 8V4M8 4h8M5 8h14v12H5zM9 13h.01M15 13h.01M9 17h6") },
  { id: "risk", label: "Risque", icon: icon("M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z") },
  { id: "backtest", label: "Backtesting", icon: icon("M3 3v18h18M7 15l4-4 3 3 5-6") },
  { id: "analysis", label: "Analyse IA", icon: icon("M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2zM9 21h6") },
  { id: "journal", label: "Journal & réglages", icon: icon("M4 4h16v16H4zM8 8h8M8 12h8M8 16h5") },
];

function readHash() {
  const h = location.hash.replace("#", "");
  return PAGES.some((p) => p.id === h) ? h : "overview";
}

export default function App() {
  const [auth, setAuth] = useState<{ enabled: boolean; authenticated: boolean } | null>(null);

  const checkAuth = () => api("/auth/status").then(setAuth).catch(() => setAuth({ enabled: false, authenticated: true }));
  useEffect(() => {
    checkAuth();
    const onUnauthorized = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener("mnbot-unauthorized", onUnauthorized);
    return () => window.removeEventListener("mnbot-unauthorized", onUnauthorized);
  }, []);

  if (!auth) return <div className="login"><span className="spinner" /></div>;
  if (!auth.authenticated) return <Login onDone={checkAuth} />;
  return <Shell authEnabled={auth.enabled} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="login">
      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault();
        try { const r = await api<{ token: string }>("/auth/login", { body: { password: pwd } }); setToken(r.token); onDone(); }
        catch (ex: any) { setErr(ex.message); }
      }}>
        <div className="brand" style={{ padding: 0 }}>{Logo}<div>MNBot<small>Trading algorithmique</small></div></div>
        <input type="password" placeholder="Mot de passe" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} />
        <button className="btn primary" type="submit">Se connecter</button>
        {err && <div className="small down">{err}</div>}
      </form>
    </div>
  );
}

const Logo = (
  <svg width="30" height="30" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#141d33" /><path d="M6 22 L12 14 L17 18 L26 8" stroke="#26a69a" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function Shell({ authEnabled }: { authEnabled: boolean }) {
  const [page, setPage] = useState(readHash());
  const live = useLiveStatus();
  const { data: status, reload } = usePoll<any>("/status", 8000, ["status", "position", "signal"]);

  useEffect(() => { connectLive(); }, []);
  useEffect(() => {
    const onHash = () => setPage(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (p: string) => { location.hash = p; setPage(p); window.scrollTo(0, 0); };
  const current = PAGES.find((p) => p.id === page)!;

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">{Logo}<div>MNBot<small>Kraken · Spot</small></div></div>
        {PAGES.map((p) => (
          <button key={p.id} className={`nav-item ${p.id === page ? "active" : ""}`} onClick={() => go(p.id)}>
            {p.icon}<span>{p.label}</span>
          </button>
        ))}
        <div className="sidebar-foot">
          <span className="row" style={{ gap: 6 }}><span className={`dot ${live ? "pulse" : ""}`} style={{ color: live ? "var(--up)" : "var(--down)" }} />{live ? "Temps réel connecté" : "Temps réel déconnecté"}</span>
          <span>Dernier cycle : {ago(status?.lastLoop)}</span>
          {authEnabled && <button className="btn sm ghost" onClick={async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); setToken(null); location.reload(); }}>Déconnexion</button>}
          {!authEnabled && !getToken() && <span className="faint">Accès local sans mot de passe</span>}
        </div>
      </nav>

      <main className="main">
        <div className="topbar">
          <h1>{current.label}</h1>
          <StatusBadge status={status?.status} />
          <ModeBadge mode={status?.mode} />
          {status?.pauseReasons?.length > 0 && <span className="badge warn" title={status.pauseReasons.join("\n")}>⚠ {status.pauseReasons.length} blocage(s)</span>}
          <div className="spacer" />
          {status?.status === "Running" && <ActionButton className="btn sm" onClick={async () => { await api("/bot/stop", { method: "POST" }); reload(); }}>⏸ Arrêter</ActionButton>}
          {status?.status === "Stopped" && <ActionButton className="btn sm success" confirm={status?.mode === "Live" ? "Démarrer en mode ARGENT RÉEL ?" : undefined} onClick={async () => { await api("/bot/start", { method: "POST" }); reload(); }}>▶ Démarrer</ActionButton>}
          <ActionButton className="btn sm danger" disabled={status?.status === "EmergencyStopped"}
            confirm="ARRÊT D'URGENCE : vendre immédiatement toutes les positions et bloquer le bot ?"
            onClick={async () => { await api("/bot/emergency-stop", { method: "POST" }); reload(); }}>⛔ Urgence</ActionButton>
        </div>

        {page === "overview" && <Overview go={go} />}
        {page === "trading" && <Trading />}
        {page === "bot" && <Bot status={status} reload={reload} />}
        {page === "risk" && <Risk />}
        {page === "backtest" && <Backtest />}
        {page === "analysis" && <Analysis aiAvailable={!!status?.aiAvailable} />}
        {page === "journal" && <Journal status={status} reload={reload} />}
      </main>
    </div>
  );
}
