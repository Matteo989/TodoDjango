import { useState } from "react";
import { api, usePoll } from "../api";
import { Card, ActionButton, Empty } from "../components/ui";
import { fmtPct, fmtNum, fmtEur, fmtPctPlain } from "../format";

export default function Analysis({ aiAvailable }: { aiAvailable: boolean }) {
  const { data: market } = usePoll<any[]>("/analysis/market", 60000, ["candles"]);
  const { data: perf } = usePoll<any>("/analysis/performance", 60000, ["position"]);
  const [ai, setAi] = useState<{ comment: string } | null>(null);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="notice info">
        Ce module observe et explique. Il n'a <strong>aucun accès</strong> aux ordres, aux fonds ni aux règles de gestion du risque :
        toutes les décisions d'exécution restent prises par le moteur déterministe.
      </div>

      <div className="grid cols-2">
        {market?.map((m) => (
          <Card key={m.symbol} title={`Conditions de marché · ${m.symbol}`}>
            <div className="stack">
              <div className="row">
                <span className={`badge ${m.trend4h === "haussière" ? "up" : "down"}`}>Tendance 4h {m.trend4h}</span>
                <span className={`badge ${m.trend1h === "haussière" ? "up" : "down"}`}>Tendance 1h {m.trend1h}</span>
                <span className="badge">Momentum {m.momentum}</span>
                <span className="badge">Volatilité {m.volatility}</span>
              </div>
              <div>{m.text}</div>
              <dl className="kv">
                <dt>Variation 24h</dt><dd>{fmtPct(m.change24hPct)}</dd>
                <dt>RSI 14</dt><dd>{fmtNum(m.rsi, 1)}</dd>
                <dt>ATR en % du prix</dt><dd>{fmtPctPlain(m.atrPct, 2)}</dd>
                <dt>Distance à l'EMA20</dt><dd>{fmtPct(m.distanceToEma20Pct)}</dd>
                <dt>Volume</dt><dd>{m.volumeState}</dd>
              </dl>
              {m.anomalies.length > 0 && <div className="notice warn">{m.anomalies.map((a: string) => <div key={a}>⚠ {a}</div>)}</div>}
            </div>
          </Card>
        )) ?? <Card><Empty>Chargement…</Empty></Card>}
      </div>

      <div className="grid cols-2">
        <Card title="Analyse des résultats de la stratégie">
          {perf ? (
            <div className="stack">
              <dl className="kv">
                <dt>Transactions</dt><dd>{perf.trades}</dd>
                <dt>Taux de réussite</dt><dd>{fmtPctPlain(perf.winRate, 0)}</dd>
                <dt>Résultat net</dt><dd>{fmtEur(perf.netPnl)}</dd>
                <dt>Frais</dt><dd>{fmtEur(perf.totalFees)}</dd>
                <dt>Profit factor</dt><dd>{perf.trades ? fmtNum(perf.profitFactor, 2) : "—"}</dd>
              </dl>
              {perf.observations.map((o: string) => <div key={o} className="small">• {o}</div>)}
              <h2 style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>PISTES D'AMÉLIORATION</h2>
              {perf.suggestions.map((o: string) => <div key={o} className="small">→ {o}</div>)}
            </div>
          ) : <Empty>Chargement…</Empty>}
        </Card>
        <Card title="Commentaire rédigé par Claude" right={aiAvailable ? <span className="badge up">actif</span> : <span className="badge">inactif</span>}>
          <div className="stack">
            <ActionButton className="btn primary" onClick={async () => setAi(await api("/analysis/ai", { method: "POST" }))}>Générer un commentaire</ActionButton>
            {!aiAvailable && <div className="small muted">Pour l'activer, ajoutez votre clé ANTHROPIC_API_KEY dans le fichier .env puis redémarrez le bot. Sans clé, l'analyse déterministe ci-contre reste disponible.</div>}
            {ai && <pre className="prose">{ai.comment}</pre>}
          </div>
        </Card>
      </div>
    </div>
  );
}
