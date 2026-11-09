import { useEffect, useRef } from "react";
import {
  createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, LineStyle, SeriesMarker, Time, UTCTimestamp,
} from "lightweight-charts";

const theme = {
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8592ad", fontSize: 11 },
  grid: { vertLines: { color: "rgba(30,41,66,0.6)" }, horzLines: { color: "rgba(30,41,66,0.6)" } },
  rightPriceScale: { borderColor: "#1e2942" },
  timeScale: { borderColor: "#1e2942", timeVisible: true, secondsVisible: false },
  crosshair: { mode: CrosshairMode.Normal },
  localization: { locale: "fr-FR" },
};

const UP = "#26a69a";
const DOWN = "#ef5350";

function useResponsiveChart(height: number) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    chart.current = createChart(ref.current, { ...theme, width: ref.current.clientWidth, height });
    const ro = new ResizeObserver(() => { if (ref.current) chart.current?.applyOptions({ width: ref.current.clientWidth }); });
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.current?.remove(); chart.current = null; };
  }, [height]);
  return { ref, chart };
}

export interface CandleData {
  candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
  ema20: { time: number; value: number }[];
  ema50: { time: number; value: number }[];
  ema200: { time: number; value: number }[];
  rsi: { time: number; value: number }[];
}

export interface PriceLevel { price: number; color: string; title: string }

export function CandleChart({ data, levels = [], markers = [], showEma200 = false, height = 420 }: {
  data: CandleData | null; levels?: PriceLevel[]; markers?: SeriesMarker<Time>[]; showEma200?: boolean; height?: number;
}) {
  const { ref, chart } = useResponsiveChart(height);
  const series = useRef<{ c?: ISeriesApi<"Candlestick">; v?: ISeriesApi<"Histogram">; e20?: ISeriesApi<"Line">; e50?: ISeriesApi<"Line">; e200?: ISeriesApi<"Line"> }>({});
  const lines = useRef<any[]>([]);
  const fitted = useRef(false);

  useEffect(() => {
    const ch = chart.current;
    if (!ch) return;
    series.current = {
      c: ch.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN }),
      v: ch.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }),
      e20: ch.addLineSeries({ color: "#f2b134", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      e50: ch.addLineSeries({ color: "#4c8dff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      e200: ch.addLineSeries({ color: "#c084fc", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
    };
    ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    fitted.current = false;
  }, [chart, height]);

  useEffect(() => {
    const s = series.current;
    if (!data || !s.c) return;
    const t = (x: number) => x as UTCTimestamp;
    s.c.setData(data.candles.map((k) => ({ time: t(k.time), open: k.open, high: k.high, low: k.low, close: k.close })));
    s.v!.setData(data.candles.map((k) => ({ time: t(k.time), value: k.volume, color: k.close >= k.open ? "rgba(38,166,154,0.35)" : "rgba(239,83,80,0.35)" })));
    s.e20!.setData(data.ema20.map((p) => ({ time: t(p.time), value: p.value })));
    s.e50!.setData(data.ema50.map((p) => ({ time: t(p.time), value: p.value })));
    s.e200!.setData(showEma200 ? data.ema200.map((p) => ({ time: t(p.time), value: p.value })) : []);
    s.c.setMarkers(markers);
    lines.current.forEach((l) => s.c!.removePriceLine(l));
    lines.current = levels.map((l) => s.c!.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.title }));
    if (!fitted.current && data.candles.length) {
      chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.candles.length - 150), to: data.candles.length + 3 });
      fitted.current = true;
    }
  }, [data, levels, markers, showEma200, chart]);

  return (
    <div className="chart-box">
      <div className="legend">
        <span style={{ color: "#f2b134" }}>EMA 20</span>
        <span style={{ color: "#4c8dff" }}>EMA 50</span>
        {showEma200 && <span style={{ color: "#c084fc" }}>EMA 200</span>}
      </div>
      <div ref={ref} />
    </div>
  );
}

export function RsiChart({ data, height = 120 }: { data: { time: number; value: number }[] | null; height?: number }) {
  const { ref, chart } = useResponsiveChart(height);
  const s = useRef<ISeriesApi<"Line"> | null>(null);
  useEffect(() => {
    const ch = chart.current;
    if (!ch) return;
    s.current = ch.addLineSeries({ color: "#4c8dff", lineWidth: 1, priceLineVisible: false });
    s.current.createPriceLine({ price: 50, color: "#5b6784", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
    s.current.createPriceLine({ price: 70, color: "rgba(239,83,80,0.4)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
    s.current.createPriceLine({ price: 30, color: "rgba(38,166,154,0.4)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
  }, [chart, height]);
  useEffect(() => {
    if (!data || !s.current) return;
    s.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 150), to: data.length + 3 });
  }, [data, chart]);
  return (
    <div className="chart-box">
      <div className="legend"><span style={{ color: "#4c8dff" }}>RSI 14</span></div>
      <div ref={ref} />
    </div>
  );
}

/** Courbe de capital (une ou plusieurs séries). */
export function EquityChart({ series: input, height = 240, baseline }: {
  series: { name: string; color: string; points: { time: string; equity: number }[] }[]; height?: number; baseline?: number;
}) {
  const { ref, chart } = useResponsiveChart(height);
  useEffect(() => {
    const ch = chart.current;
    if (!ch) return;
    const created: ISeriesApi<"Line">[] = [];
    input.forEach((s, idx) => {
      const ls = ch.addLineSeries({ color: s.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: input.length > 1 ? s.name : "" });
      const seen = new Set<number>();
      const pts = s.points
        .map((p) => ({ time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp, value: p.equity }))
        .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
        .sort((a, b) => a.time - b.time);
      ls.setData(pts);
      if (idx === 0 && baseline != null) ls.createPriceLine({ price: baseline, color: "#5b6784", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "départ" });
      created.push(ls);
    });
    ch.timeScale().fitContent();
    return () => { created.forEach((s) => { try { ch.removeSeries(s); } catch { /* graphique déjà détruit */ } }); };
  }, [input, chart, baseline]);
  return <div ref={ref} />;
}
