import { Fragment, useMemo, useState } from "react";

const INDICATOR_LABELS: Record<string, string> = {
  close: "Clôture", ema20: "EMA 20", ema50: "EMA 50", ema200_4h: "EMA 200 (tendance)", rsi14: "RSI 14", atr14: "ATR 14",
  volume: "Volume", volumeAvg20: "Volume moyen", close4h: "Clôture tendance", emaFast: "EMA rapide", emaSlow: "EMA lente",
  emaTrend: "EMA 200 (filtre)", channelHigh: "Plus haut à casser", channelLow: "Plus bas de sortie", trailingStop: "Stop suiveur",
};
import type { SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { api, usePoll } from "../api";
import { Card, Checks, Empty, ErrorNote, ActionButton } from "../components/ui";
import { CandleChart, RsiChart, CandleData, PriceLevel } from "../components/Charts";
import { fmtPrice, fmtDate, fmtQty, fmtSigned, fmtEur, fmtNum, tone, ago } from "../format";

export default function Trading() {
  const { data: symbols } = usePoll<any[]>("/market/symbols", 10000, ["tickers", "signal"]);
  const [symbol, setSymbol] = useState("BTC/EUR");
  const [tf, setTf] = useState("4h");
  const { data: chart, error } = usePoll<CandleData>(`/market/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, 60000, ["candles"]);
  const { data: positions, reload: reloadPositions } = usePoll<any[]>("/positions", 10000, ["position", "tickers"]);
  const { data: trades } = usePoll<any[]>("/trades?limit=100", 30000, ["position"]);
  const { data: signals } = usePoll<any[]>("/signals?limit=40", 30000, ["signal"]);
  const { data: book } = usePoll<any>(`/market/orderbook?symbol=${encodeURIComponent(symbol)}`, 15000);

  const current = symbols?.find((s) => s.symbol === symbol);
  const position = positions?.find((p) => p.symbol === symbol);

  const levels = useMemo<PriceLevel[]>(() => position ? [
    { price: position.entryPrice, color: "#8592ad", title: "Entrée" },
    { price: position.stopLoss, color: "#ef5350", title: "Stop" },
    { price: position.takeProfit, color: "#26a69a", title: "Objectif" },
  ] : [], [position]);

  const markers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!trades) return [];
    const step = tf === "1d" ? 86400 : tf === "4h" ? 14400 : 3600;
    const hour = (s: string) => (Math.floor(new Date(s).getTime() / 1000 / step) * step) as UTCTimestamp;
    const m: SeriesMarker<Time>[] = [];
    trades.filter((t) => t.symbol === symbol).forEach((t) => {
      m.push({ time: hour(t.entryTimeUtc), position: "belowBar", color: "#26a69a", shape: "arrowUp", text: "Achat" });
      if (t.exitTimeUtc) m.push({ time: hour(t.exitTimeUtc), position: "aboveBar", color: t.pnl >= 0 ? "#26a69a" : "#ef5350", shape: "arrowDown", text: fmtSigned(t.pnl) });
    });
    if (position) m.push({ time: hour(position.entryTimeUtc), position: "belowBar", color: "#4c8dff", shape: "arrowUp", text: "Achat (ouvert)" });
    return m.sort((a, b) => (a.time as number) - (b.time as number));
  }, [trades, position, symbol, tf]);

  const ind = current?.lastEvaluation?.indicators ?? {};

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorNote error={error} />
      <div className="trading-layout">
        <div className="stack">
          {symbols?.map((s) => (
            <button key={s.symbol} className={`symbol-item ${s.symbol === symbol ? "active" : ""}`} onClick={() => setSymbol(s.symbol)}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{s.symbol}</strong>
                {s.lastEvaluation?.action === "EnterLong" ? <span className="badge up">Achat</span> : <span className="badge">Attente</span>}
              </div>
              <div className="px">{fmtPrice(s.ticker?.last)} €</div>
              <div className="small muted num">Achat {fmtPrice(s.ticker?.bid)} · Vente {fmtPrice(s.ticker?.ask)}</div>
            </button>
          ))}
          <Card title="Indicateurs de la stratégie">
            <dl className="kv">
              {Object.entries(ind).filter(([, v]) => v != null).map(([k, v]) => (
                <Fragment key={k}><dt>{INDICATOR_LABELS[k] ?? k}</dt><dd>{k === "rsi14" ? fmtNum(v as number, 1) : fmtPrice(v as number)}</dd></Fragment>
              ))}
            </dl>
            {!Object.keys(ind).length && <div className="small muted">En attente de la prochaine clôture de bougie.</div>}
          </Card>
          {book && (
            <Card title="Carnet d'ordres">
              <table className="small">
                <tbody>
                  {[...book.asks].slice(0, 5).reverse().map((l: any, i: number) => <tr key={"a" + i}><td className="down">{fmtPrice(l.price)}</td><td className="r muted">{fmtQty(l.quantity)}</td></tr>)}
                  {book.bids.slice(0, 5).map((l: any, i: number) => <tr key={"b" + i}><td className="up">{fmtPrice(l.price)}</td><td className="r muted">{fmtQty(l.quantity)}</td></tr>)}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <Card title={`${symbol} · chandeliers ${tf}`} right={
            <div className="tabs">{["1h", "4h", "1d"].map((x) => <button key={x} className={tf === x ? "active" : ""} onClick={() => setTf(x)}>{x}</button>)}</div>
          }>
            <CandleChart data={chart} levels={levels} markers={markers} showEma200 height={420} />
            <RsiChart data={chart?.rsi ?? null} height={110} />
          </Card>

          <div className="grid cols-2">
            <Card title="Dernière analyse de la stratégie" right={<span className="small muted">{ago(current?.lastEvaluation?.time)}</span>}>
              {current?.lastEvaluation ? (
                <div className="stack">
                  <div>{current.lastEvaluation.reason}</div>
                  <Checks checks={current.lastEvaluation.checks} />
                </div>
              ) : <Empty>En attente de la prochaine clôture de bougie.</Empty>}
            </Card>
            <Card title="Position ouverte">
              {position ? (
                <div className="stack">
                  <dl className="kv">
                    <dt>Quantité</dt><dd>{fmtQty(position.quantity)}</dd>
                    <dt>Prix d'entrée</dt><dd>{fmtPrice(position.entryPrice)} €</dd>
                    <dt>Prix actuel</dt><dd>{fmtPrice(position.currentPrice)} €</dd>
                    <dt>Stop-loss</dt><dd className="down">{fmtPrice(position.stopLoss)} €</dd>
                    <dt>Take-profit</dt><dd className="up">{fmtPrice(position.takeProfit)} €</dd>
                    <dt>Risque initial</dt><dd>{fmtEur(position.initialRisk)}</dd>
                    <dt>Résultat latent</dt><dd className={tone(position.unrealizedPnl)}>{fmtSigned(position.unrealizedPnl)}</dd>
                  </dl>
                  <ActionButton className="btn danger sm" confirm="Fermer cette position au prix du marché ?" onClick={async () => { await api(`/positions/${position.id}/close`, { method: "POST" }); reloadPositions(); }}>
                    Fermer la position
                  </ActionButton>
                </div>
              ) : <Empty>Aucune position ouverte sur {symbol}.</Empty>}
            </Card>
          </div>
        </div>
      </div>

      <Card title="Signaux détectés" flush>
        {signals?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Bougie</th><th>Actif</th><th>Décision</th><th>Raison</th><th>Suite donnée</th></tr></thead>
            <tbody>{signals.map((s) => (
              <tr key={s.id}>
                <td className="num">{fmtDate(s.candleTimeUtc)}</td>
                <td>{s.symbol}</td>
                <td>{s.action === "EnterLong" ? <span className="badge up">Achat</span> : s.action === "ExitLong" ? <span className="badge down">Vente</span> : <span className="badge">Aucun</span>}</td>
                <td className="small">{s.reason}</td>
                <td className="small muted">{s.outcome ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>Les évaluations apparaissent à chaque clôture de bougie (toutes les 4 heures pour la stratégie active).</Empty>}
      </Card>

      <Card title="Historique des transactions" flush>
        {trades?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Actif</th><th>Entrée</th><th>Sortie</th><th className="r">Qté</th><th className="r">Prix entrée</th><th className="r">Prix sortie</th><th>Motif</th><th className="r">Frais</th><th className="r">Résultat</th><th className="r">R</th></tr></thead>
            <tbody>{trades.map((t) => (
              <tr key={t.id}>
                <td>{t.symbol}</td><td>{fmtDate(t.entryTimeUtc)}</td><td>{fmtDate(t.exitTimeUtc)}</td>
                <td className="r">{fmtQty(t.quantity)}</td><td className="r">{fmtPrice(t.entryPrice)}</td><td className="r">{fmtPrice(t.exitPrice)}</td>
                <td className="small muted">{t.exitReason}</td><td className="r">{fmtEur(t.fees)}</td>
                <td className={`r ${tone(t.pnl)}`}>{fmtSigned(t.pnl)}</td><td className={`r ${tone(t.r)}`}>{fmtNum(t.r, 2)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>Aucune transaction clôturée.</Empty>}
      </Card>
    </div>
  );
}
