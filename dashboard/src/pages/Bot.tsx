import { api, usePoll } from "../api";
import { Card, StatusBadge, ModeBadge, ActionButton, Checks, Empty } from "../components/ui";
import { fmtDate, ago, fmtPrice, fmtSigned, tone } from "../format";

export default function Bot({ status, reload }: { status: any; reload: () => void }) {
  const { data: symbols } = usePoll<any[]>("/market/symbols", 15000, ["signal"]);
  const s = status;
  const run = async (path: string) => { await api(path, { method: "POST" }); reload(); };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid cols-3">
        <Card title="Statut du moteur">
          <div className="stack">
            <div className="row"><StatusBadge status={s?.status} /><ModeBadge mode={s?.mode} /></div>
            <dl className="kv">
              <dt>Plateforme</dt><dd>{s?.exchange}</dd>
              <dt>Actifs</dt><dd>{s?.symbols?.join(", ")}</dd>
              <dt>Démarré</dt><dd>{fmtDate(s?.startedAt)}</dd>
              <dt>Dernier cycle</dt><dd>{ago(s?.lastLoop)}</dd>
              <dt>Dashboard connectés</dt><dd>{s?.dashboardClients}</dd>
            </dl>
            {s?.pauseReasons?.length > 0 && <div className="notice warn">{s.pauseReasons.map((r: string) => <div key={r}>{r}</div>)}</div>}
          </div>
        </Card>

        <Card title="Commandes">
          <div className="stack">
            {s?.status === "EmergencyStopped" ? (
              <>
                <div className="notice danger">Arrêt d'urgence actif : toutes les positions ont été fermées et le bot est bloqué.</div>
                <ActionButton className="btn" confirm="Lever l'arrêt d'urgence ? Le bot restera arrêté jusqu'à un démarrage manuel." onClick={() => run("/bot/rearm")}>Réarmer</ActionButton>
              </>
            ) : s?.status === "Running" ? (
              <ActionButton className="btn" onClick={() => run("/bot/stop")}>⏸ Arrêter le bot</ActionButton>
            ) : (
              <ActionButton className="btn success" confirm={s?.mode === "Live" ? "Démarrer le bot en mode ARGENT RÉEL ?" : undefined} onClick={() => run("/bot/start")}>▶ Démarrer le bot</ActionButton>
            )}
            <div className="small muted">« Arrêter » bloque les nouveaux achats. Les positions ouvertes restent surveillées et protégées par leur stop-loss et take-profit.</div>
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
            <ActionButton className="btn danger" disabled={s?.status === "EmergencyStopped"}
              confirm="ARRÊT D'URGENCE : toutes les positions vont être vendues immédiatement au prix du marché et le bot sera bloqué. Continuer ?"
              onClick={() => run("/bot/emergency-stop")}>⛔ Arrêt d'urgence</ActionButton>
          </div>
        </Card>

        <Card title="Stratégies">
          <div className="stack">
            {s?.strategies?.map((st: any) => (
              <label key={st.id} className="row" style={{ justifyContent: "space-between", cursor: "pointer" }}>
                <span><div>{st.name}</div><div className="small faint mono">{st.id}</div></span>
                <input type="checkbox" checked={st.enabled} onChange={async (e) => { await api(`/strategies/${st.id}/enabled`, { body: { enabled: e.target.checked } }); reload(); }} />
              </label>
            ))}
            <div className="small muted">Seules les stratégies cochées sont utilisées par le moteur. Les variantes servent surtout au backtesting. Les paramètres se modifient dans config/mnbot.json, jamais automatiquement.</div>
          </div>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Dernier signal">
          {s?.lastSignal ? (
            <div className="stack">
              <div className="row"><span className={`badge ${s.lastSignal.action === "EnterLong" ? "up" : "down"}`}>{s.lastSignal.action === "EnterLong" ? "Achat" : "Vente"}</span><strong>{s.lastSignal.symbol}</strong><span className="muted small">{fmtDate(s.lastSignal.timeUtc)}</span></div>
              <div>{s.lastSignal.reason}</div>
              <div className="small muted">Suite donnée : {s.lastSignal.outcome ?? "—"}</div>
              <Checks checks={s.lastSignal.checks} />
            </div>
          ) : <Empty>Aucun signal d'achat ou de vente pour l'instant.</Empty>}
        </Card>
        <Card title="Dernière transaction">
          {s?.lastTrade ? (
            <dl className="kv">
              <dt>Actif</dt><dd>{s.lastTrade.symbol}</dd>
              <dt>Statut</dt><dd>{s.lastTrade.status === "Open" ? "Ouverte" : "Clôturée"}</dd>
              <dt>Entrée</dt><dd>{fmtPrice(s.lastTrade.entryPrice)} € · {fmtDate(s.lastTrade.entryTimeUtc)}</dd>
              {s.lastTrade.exitPrice && <><dt>Sortie</dt><dd>{fmtPrice(s.lastTrade.exitPrice)} € · {fmtDate(s.lastTrade.exitTimeUtc)}</dd></>}
              {s.lastTrade.exitReason && <><dt>Motif</dt><dd className="small">{s.lastTrade.exitReason}</dd></>}
              {s.lastTrade.status === "Closed" && <><dt>Résultat</dt><dd className={tone(s.lastTrade.realizedPnl)}>{fmtSigned(s.lastTrade.realizedPnl)}</dd></>}
            </dl>
          ) : <Empty>Aucune transaction.</Empty>}
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Erreurs">
          {s?.lastError ? <div className="notice danger"><div>{s.lastError}</div><div className="small muted">{fmtDate(s.lastErrorAt, true)}</div></div> : <div className="muted">Aucune erreur récente.</div>}
        </Card>
        <Card title="Analyse en cours par actif">
          <div className="stack">
            {symbols?.map((x) => (
              <div key={x.symbol}><strong>{x.symbol}</strong> <span className="small muted">— bougie {fmtDate(x.lastClosedCandle)}</span><div className="small">{x.lastEvaluation?.reason ?? "En attente"}</div></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
