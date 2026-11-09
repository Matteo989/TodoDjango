import { useState } from "react";
import { api, usePoll } from "../api";
import { Card, Empty, Meter, ActionButton } from "../components/ui";
import { fmtDate, fmtEur, fmtQty, fmtPrice, fmtNum } from "../format";

export default function Journal({ status, reload }: { status: any; reload: () => void }) {
  const [level, setLevel] = useState("");
  const { data: alerts } = usePoll<any[]>(`/alerts?limit=200${level ? `&level=${level}` : ""}`, 15000, ["alert"]);
  const { data: orders } = usePoll<any[]>("/orders?limit=100", 30000, ["position"]);
  const { data: config } = usePoll<any>("/config", 0);
  const { data: v } = usePoll<any>("/validation", 60000);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid cols-2">
        <Card title="Validation avant trading réel">
          {v ? (
            <div className="stack">
              <div>Jours de paper trading : <strong>{v.days} / {v.requiredDays}</strong></div>
              <Meter value={v.days} max={v.requiredDays} />
              <div>Transactions simulées : <strong>{v.trades} / {v.requiredTrades}</strong></div>
              <Meter value={v.trades} max={v.requiredTrades} />
              <div className="small muted">Résultat simulé : {fmtEur(v.netPnl)} · profit factor {v.trades ? fmtNum(v.profitFactor, 2) : "—"}</div>
              {v.passed ? <div className="notice info">✔ Critères de validation atteints.</div> : <div className="notice warn">Validation en cours : {v.missing.join(" ")}</div>}
            </div>
          ) : <Empty>Chargement…</Empty>}
        </Card>
        <Card title="Passage en trading réel">
          {status?.mode !== "Live" ? (
            <div className="stack small">
              <div>Le bot fonctionne en <strong>simulation</strong> : aucun argent réel n'est utilisé.</div>
              <div className="muted">Le passage en réel se fait en trois verrous indépendants, décrits dans <span className="mono">docs/PASSAGE_EN_REEL.md</span> : clés API Kraken sans droit de retrait, <span className="mono">"Mode": "Live"</span> dans la configuration, <span className="mono">MNBOT_LIVE_TRADING_ENABLED=true</span>, puis une confirmation écrite ici.</div>
            </div>
          ) : status?.liveConfirmed ? (
            <div className="notice danger">Trading réel confirmé. Le bot peut passer des ordres avec de l'argent réel lorsqu'il est démarré.</div>
          ) : (
            <div className="stack">
              <div className="notice danger">Mode réel chargé mais non confirmé : aucun ordre réel ne sera envoyé tant que vous n'avez pas confirmé.</div>
              <label className="stack small" style={{ gap: 4 }}>Tapez exactement : <span className="mono">JE CONFIRME LE TRADING REEL</span>
                <input type="text" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
              </label>
              <label className="stack small" style={{ gap: 4 }}>Mot de passe du dashboard
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <ActionButton className="btn danger" onClick={async () => { await api("/live/confirm", { body: { phrase, password } }); reload(); }}>Confirmer le trading réel</ActionButton>
            </div>
          )}
        </Card>
      </div>

      <Card title="Journal des alertes" flush right={
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Tout</option><option value="Warning">Avertissements et +</option><option value="Critical">Critiques</option>
        </select>
      }>
        <div style={{ padding: "0 16px 8px", maxHeight: 420, overflowY: "auto" }}>
          {alerts?.length ? alerts.map((a) => (
            <div className="alert-line" key={a.id} style={{ gridTemplateColumns: "120px 90px 1fr" }}>
              <span className="small muted num">{fmtDate(a.timeUtc, true)}</span>
              <span className={`small ${a.level === "Critical" ? "down" : ""}`} style={a.level === "Warning" ? { color: "var(--warn)" } : undefined}>{a.level === "Critical" ? "Critique" : a.level === "Warning" ? "Attention" : "Info"} · {a.category}</span>
              <span>{a.message}</span>
            </div>
          )) : <Empty>Aucune alerte.</Empty>}
        </div>
      </Card>

      <Card title="Ordres envoyés" flush>
        {orders?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Mode</th><th>Actif</th><th>Sens</th><th>Statut</th><th className="r">Qté</th><th className="r">Prix moyen</th><th className="r">Frais</th><th>Référence</th><th>Erreur</th></tr></thead>
            <tbody>{orders.map((o, i) => (
              <tr key={i}>
                <td>{fmtDate(o.time, true)}</td><td>{o.mode}</td><td>{o.symbol}</td>
                <td className={o.side === "Buy" ? "up" : "down"}>{o.side === "Buy" ? "Achat" : "Vente"}</td><td>{o.status}</td>
                <td className="r">{fmtQty(Number(o.filledQty))}</td><td className="r">{fmtPrice(Number(o.avgPrice))}</td><td className="r">{fmtEur(Number(o.fee))}</td>
                <td className="mono small faint">{o.clientId}</td><td className="small down">{o.error}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>Aucun ordre envoyé.</Empty>}
      </Card>

      <Card title="Configuration active">
        {config ? (
          <div className="stack small">
            <div className="muted">Fichier modifiable : <span className="mono">{config.configFile}</span> (redémarrer le bot après modification).</div>
            <pre className="mono" style={{ margin: 0, maxHeight: 360, overflow: "auto", background: "var(--bg)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>{JSON.stringify({ bot: config.bot, risk: config.risk, kraken: config.kraken, ai: config.ai, backtest: config.backtest }, null, 2)}</pre>
          </div>
        ) : <Empty>Chargement…</Empty>}
      </Card>
    </div>
  );
}
