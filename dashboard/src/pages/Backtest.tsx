import { useEffect, useMemo, useState } from "react";
import { api, usePoll } from "../api";
import { Card, ActionButton, Empty, ErrorNote } from "../components/ui";
import { EquityChart } from "../components/Charts";
import { fmtEur, fmtSigned, fmtPctPlain, fmtNum, fmtDay, fmtDate, tone } from "../format";

const COLORS = ["#4c8dff", "#f2b134", "#c084fc", "#26a69a", "#ef5350", "#38bdf8"];

export default function Backtest() {
  const { data: inventory, reload: reloadInv } = usePoll<any[]>("/data/inventory", 0);
  const { data: runs, reload: reloadRuns } = usePoll<any[]>("/backtest/runs", 0);
  const [report, setReport] = useState<any>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [source, setSource] = useState("auto");
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"validation" | "train">("validation");

  useEffect(() => {
    if (selected == null) return;
    api(`/backtest/runs/${selected}`).then(setReport).catch((e) => setError(e.message));
  }, [selected]);
  useEffect(() => { if (selected == null && runs?.length) setSelected(runs[0].id); }, [runs, selected]);

  const curves = useMemo(() => report?.strategies?.map((s: any, i: number) => ({
    name: s.strategyId, color: COLORS[i % COLORS.length], points: s[period].equity,
  })) ?? [], [report, period]);

  const best = report?.strategies?.reduce((a: any, b: any) => (!a || b.validation.metrics.netProfit > a.validation.metrics.netProfit ? b : a), null);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorNote error={error} />
      <div className="grid cols-2">
        <Card title="1. Données historiques">
          <div className="stack">
            {inventory?.length ? (
              <table className="small">
                <thead><tr><th>Source</th><th>Actif</th><th>UT</th><th className="r">Bougies</th><th>Période</th></tr></thead>
                <tbody>{inventory.map((i, k) => <tr key={k}><td>{i.source}</td><td>{i.symbol}</td><td>{i.timeframe}</td><td className="r">{i.count}</td><td>{fmtDay(i.from)} → {fmtDay(i.to)}</td></tr>)}</tbody>
              </table>
            ) : <div className="muted">Aucun historique. Importez-le avant de lancer un backtest.</div>}
            <div className="row">
              <ActionButton className="btn" onClick={async () => { await api("/data/import", { body: { source: "binance", days: 730 } }); reloadInv(); }}>Importer 2 ans (Binance, 1h)</ActionButton>
              <ActionButton className="btn ghost" onClick={async () => { await api("/data/import", { body: { source: "binance", days: 3300 } }); reloadInv(); }}>Importer depuis 2017 (plus long)</ActionButton>
            </div>
            <div className="small muted">L'historique provient des données publiques de Binance (mêmes prix que ceux sur lesquels le bot trade). L'import long prend 1 à 3 minutes.</div>
          </div>
        </Card>
        <Card title="2. Lancer un backtest">
          <div className="stack">
            <div className="row">
              <label className="stack small" style={{ gap: 4 }}>Source
                <select value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="auto">Automatique</option><option value="binance">Binance</option>
                </select>
              </label>
              <label className="stack small" style={{ gap: 4 }}>Derniers jours (vide = tout)
                <input type="number" min={30} placeholder="tout" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 120 }} />
              </label>
            </div>
            <ActionButton className="btn primary" onClick={async () => {
              setError(null);
              const r = await api("/backtest/run", { body: { source, days: days ? Number(days) : null } });
              setReport(r); setSelected(r.id); reloadRuns();
            }}>Comparer toutes les variantes</ActionButton>
            <div className="small muted">Chaque variante est testée sur une période d'entraînement (70 % les plus anciens) puis sur une période de validation (30 % les plus récents) qu'elle n'a jamais « vue ». Frais, spread et glissement sont inclus. Compter 10 à 60 secondes.</div>
            {runs?.length ? (
              <select value={selected ?? ""} onChange={(e) => setSelected(Number(e.target.value))}>
                {runs.map((r) => <option key={r.id} value={r.id}>#{r.id} · {fmtDate(r.time)} · {r.summary}</option>)}
              </select>
            ) : null}
          </div>
        </Card>
      </div>

      {report ? (
        <>
          <div className="notice">
            <strong>Backtest #{report.id}</strong> — {report.symbols.join(" + ")} · source {report.source} · {fmtDay(report.dataFrom)} → {fmtDay(report.dataTo)} ·
            séparation au {fmtDay(report.splitTime)} · spread {fmtPctPlain(report.spreadPct, 2)} · frais {fmtPctPlain(report.risk.takerFeeRate, 2)} · glissement {fmtPctPlain(report.risk.slippageRate, 2)}
            {best && <> · meilleure variante en validation : <strong>{best.strategyName}</strong></>}
          </div>

          <Card title="Comparaison des stratégies" flush>
            <div className="table-wrap"><table>
              <thead>
                <tr><th>Variante</th><th>Période</th><th className="r">Trades</th><th className="r">Réussite</th><th className="r">Profit factor</th><th className="r">Résultat net</th><th className="r">Drawdown max</th><th className="r">Frais</th><th className="r">Signaux / refusés</th></tr>
              </thead>
              <tbody>
                {report.strategies.flatMap((s: any, i: number) => (["train", "validation"] as const).map((p) => {
                  const m = s[p].metrics;
                  return (
                    <tr key={s.strategyId + p} style={p === "validation" ? { background: "rgba(76,141,255,0.05)" } : undefined}>
                      <td>{p === "train" && <><span style={{ color: COLORS[i % COLORS.length] }}>●</span> {s.strategyName}</>}</td>
                      <td className="small muted">{p === "train" ? "Entraînement" : "Validation"}</td>
                      <td className="r">{m.trades}</td>
                      <td className="r">{fmtPctPlain(m.winRate, 0)}</td>
                      <td className="r">{m.trades ? (m.profitFactor >= 999 ? "∞" : fmtNum(m.profitFactor, 2)) : "—"}</td>
                      <td className={`r ${tone(m.netProfit)}`}>{fmtSigned(m.netProfit)}</td>
                      <td className="r down">{m.maxDrawdown ? "−" + fmtEur(m.maxDrawdown) : "—"}</td>
                      <td className="r">{fmtEur(m.totalFees)}</td>
                      <td className="r muted">{m.signalsDetected} / {m.signalsRejectedByRisk}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table></div>
          </Card>

          <div className="grid cols-3">
            <Card title="Courbe du capital" className="span-2" right={
              <div className="tabs"><button className={period === "train" ? "active" : ""} onClick={() => setPeriod("train")}>Entraînement</button><button className={period === "validation" ? "active" : ""} onClick={() => setPeriod("validation")}>Validation</button></div>
            }>
              <EquityChart series={curves} baseline={report.risk.initialCapital} height={280} />
            </Card>
            <Card title="À retenir">
              <div className="stack small">
                {report.notes.map((n: string) => <div key={n}>• {n}</div>)}
                {report.strategies.map((s: any) => s.train.rejectionSamples.length > 0 && (
                  <div key={s.strategyId}><strong>{s.strategyId}</strong> — exemples de refus : <span className="muted">{s.train.rejectionSamples.slice(0, 2).join(" · ")}</span></div>
                ))}
              </div>
            </Card>
          </div>
        </>
      ) : <Card><Empty>Importez l'historique puis lancez un backtest pour voir les résultats.</Empty></Card>}
    </div>
  );
}
