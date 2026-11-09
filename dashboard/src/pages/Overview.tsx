import { useMemo } from "react";
import { usePoll } from "../api";
import { Card, Stat, Empty, ErrorNote } from "../components/ui";
import { EquityChart } from "../components/Charts";
import { fmtEur, fmtSigned, fmtPct, fmtPctPlain, fmtDate, fmtPrice, tone } from "../format";

export default function Overview({ go }: { go: (page: string) => void }) {
  const { data: o, error } = usePoll<any>("/overview", 15000, ["position"]);
  const { data: symbols } = usePoll<any[]>("/market/symbols", 10000, ["tickers"]);
  const { data: alerts } = usePoll<any[]>("/alerts?limit=8", 20000, ["alert"]);
  const { data: trades } = usePoll<any[]>("/trades?limit=5", 30000, ["position"]);

  const curve = useMemo(() => (o?.equityCurve?.length ? [{ name: "Capital", color: "#4c8dff", points: o.equityCurve }] : []), [o]);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorNote error={error} />
      <div className="grid cols-4">
        <Stat label="Capital total" value={fmtEur(o?.equity)} sub={`Départ ${fmtEur(o?.initialCapital)}`} />
        <Stat label="Capital disponible pour trader" value={fmtEur(o?.available)} sub={`Liquidités ${fmtEur(o?.cash)}`} />
        <Stat label="Gains / pertes" value={fmtSigned(o?.totalPnl)} valueTone={o?.totalPnl} sub={`${fmtPct(o?.totalPct)} depuis le début`} />
        <Stat label="Transactions" value={o?.trades ?? "—"} sub={`Réussite ${fmtPctPlain(o?.winRate, 0)} · frais ${fmtEur(o?.fees)}`} />
      </div>
      <div className="grid cols-4">
        <Stat label="Performance du jour" value={fmtSigned(o?.dailyPnl)} valueTone={o?.dailyPnl} sub={fmtPct(o?.dailyPct)} />
        <Stat label="Performance de la semaine" value={fmtSigned(o?.weeklyPnl)} valueTone={o?.weeklyPnl} sub={fmtPct(o?.weeklyPct)} />
        <Stat label="Performance globale" value={fmtPct(o?.totalPct)} valueTone={o?.totalPct} sub={o?.mode === "Live" ? "Compte réel" : "Compte simulé"} />
        <Stat label="Positions ouvertes" value={o?.openPositions ?? "—"} sub={`Capital exposé ${fmtEur(o?.exposure)}`} />
      </div>

      <div className="grid cols-3">
        <Card title="Courbe du capital" className="span-2">
          {curve.length ? <EquityChart series={curve} baseline={o?.initialCapital} height={260} /> : <Empty>La courbe apparaîtra après quelques minutes de fonctionnement.</Empty>}
        </Card>
        <Card title="Marchés surveillés" right={<button className="btn sm ghost" onClick={() => go("trading")}>Graphiques →</button>}>
          <div className="stack">
            {symbols?.map((s) => (
              <div key={s.symbol} className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.symbol}</div>
                  <div className="small muted">{s.lastEvaluation?.action === "EnterLong" ? "Signal d'achat" : s.lastEvaluation ? "Pas de signal" : "En attente"}</div>
                </div>
                <div className="num" style={{ fontSize: 17, fontWeight: 650 }}>{fmtPrice(s.ticker?.last)} €</div>
              </div>
            )) ?? <Empty>Chargement…</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Dernières transactions" flush right={<button className="btn sm ghost" onClick={() => go("trading")}>Tout voir →</button>}>
          {trades?.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Actif</th><th>Sortie</th><th>Motif</th><th className="r">Résultat</th></tr></thead>
              <tbody>{trades.map((t) => (
                <tr key={t.id}><td>{t.symbol}</td><td>{fmtDate(t.exitTimeUtc)}</td><td className="small muted">{t.exitReason}</td><td className={`r ${tone(t.pnl)}`}>{fmtSigned(t.pnl)}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <Empty>Aucune transaction clôturée pour l'instant. C'est normal : la stratégie est sélective.</Empty>}
        </Card>
        <Card title="Alertes récentes" right={<button className="btn sm ghost" onClick={() => go("journal")}>Journal →</button>}>
          {alerts?.length ? alerts.map((a) => (
            <div className="alert-line" key={a.id}>
              <span className={`small ${a.level === "Critical" ? "down" : a.level === "Warning" ? "" : "muted"}`} style={a.level === "Warning" ? { color: "var(--warn)" } : undefined}>{fmtDate(a.timeUtc)}</span>
              <span>{a.message}</span>
            </div>
          )) : <Empty>Aucune alerte.</Empty>}
        </Card>
      </div>
    </div>
  );
}
