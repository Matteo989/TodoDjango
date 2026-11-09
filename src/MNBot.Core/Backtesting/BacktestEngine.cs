using MNBot.Core.Domain;
using MNBot.Core.Risk;
using MNBot.Core.Strategies;

namespace MNBot.Core.Backtesting;

public sealed class BacktestMarketData
{
    public required InstrumentSpec Instrument { get; init; }
    /// <summary>Bougies de l'unité d'entrée (1h), triées.</summary>
    public required IReadOnlyList<Candle> EntryCandles { get; init; }
    /// <summary>Bougies de l'unité de tendance (4h), triées.</summary>
    public required IReadOnlyList<Candle> TrendCandles { get; init; }
}

public sealed class BacktestOptions
{
    public required RiskSettings Risk { get; init; }
    /// <summary>Spread moyen simulé (fraction du prix). La moitié est payée à chaque ordre.</summary>
    public decimal SpreadPct { get; init; } = 0.0005m;
    /// <summary>Les transactions ne sont autorisées qu'à partir de cette date (l'historique antérieur sert au calcul des indicateurs).</summary>
    public DateTime? TradeFromUtc { get; init; }
    public DateTime? TradeToUtc { get; init; }
}

public sealed record BacktestTrade(
    string Symbol,
    DateTime EntryTime,
    decimal EntryPrice,
    DateTime ExitTime,
    decimal ExitPrice,
    decimal Quantity,
    decimal Fees,
    decimal Pnl,
    decimal RMultiple,
    string ExitReason);

public sealed record EquityPoint(DateTime Time, decimal Equity);

public sealed record BacktestMetrics(
    decimal InitialCapital,
    decimal FinalEquity,
    decimal NetProfit,
    decimal ReturnPct,
    int Trades,
    int Wins,
    int Losses,
    decimal WinRate,
    decimal ProfitFactor,
    decimal MaxDrawdown,
    decimal MaxDrawdownPct,
    decimal TotalFees,
    decimal AverageTrade,
    decimal AverageR,
    decimal ExposurePct,
    int SignalsDetected,
    int SignalsRejectedByRisk,
    DateTime? From,
    DateTime? To);

public sealed record BacktestResult(
    string StrategyId,
    string StrategyName,
    BacktestMetrics Metrics,
    IReadOnlyList<BacktestTrade> Trades,
    IReadOnlyList<EquityPoint> Equity,
    IReadOnlyList<string> RejectionSamples);

/// <summary>
/// Moteur de backtest événementiel. Utilise exactement la même stratégie, le même calcul de taille
/// de position et les mêmes limites de risque que le moteur temps réel.
///
/// Hypothèses (conservatrices) :
///  - un signal détecté à la clôture d'une bougie est exécuté à l'ouverture de la bougie suivante ;
///  - achat = ouverture + ½ spread + glissement ; vente = prix − ½ spread − glissement ; frais taker à chaque ordre ;
///  - si le stop et l'objectif sont touchés dans la même bougie, on suppose que le stop a été touché en premier ;
///  - en cas de gap sous le stop, la sortie se fait au prix d'ouverture.
/// </summary>
public sealed class BacktestEngine
{
    public BacktestResult Run(IStrategy strategy, IReadOnlyList<BacktestMarketData> markets, BacktestOptions options)
    {
        var risk = new RiskManager(options.Risk);
        var s = options.Risk;
        var halfSpread = options.SpreadPct / 2m;
        var buyCost = halfSpread + s.SlippageRate;
        var sellCost = halfSpread + s.SlippageRate;
        var entryTf = strategy.EntryTimeframe;
        var trendTf = strategy.TrendTimeframe;

        var states = markets.Select(m => new MarketState(m)).ToList();
        var timeline = markets.SelectMany(m => m.EntryCandles.Select(c => c.OpenTime)).Distinct().OrderBy(t => t).ToList();

        decimal cash = s.InitialCapital;
        var open = new List<Position>();
        var closed = new List<Position>();
        var trades = new List<BacktestTrade>();
        var equity = new List<EquityPoint>();
        var rejections = new List<string>();
        int signals = 0, rejected = 0, barsInMarket = 0, barsTotal = 0;
        long posId = 0;

        foreach (var t in timeline)
        {
            var inWindow = (options.TradeFromUtc is null || t >= options.TradeFromUtc) && (options.TradeToUtc is null || t < options.TradeToUtc);

            // 1) Événements pendant la bougie t (ordres en attente puis stops/objectifs)
            foreach (var st in states)
            {
                if (!st.TryAdvanceTo(t, out var bar)) continue;
                var pos = open.FirstOrDefault(p => p.Symbol == st.Symbol);

                if (st.PendingExit && pos is not null)
                {
                    ClosePosition(pos, bar.Open * (1 - sellCost), t, "Signal de sortie");
                    pos = null;
                }
                st.PendingExit = false;

                if (st.PendingEntry is { } pe && pos is null)
                {
                    st.PendingEntry = null;
                    var fill = bar.Open * (1 + buyCost);
                    var stop = fill - pe.StopDistance;
                    var tp = fill + pe.RewardRisk * pe.StopDistance;
                    var snap = risk.Evaluate(t, cash, open, closed, sym => LastClose(states, sym));
                    var sizing = PositionSizer.Calculate(fill, stop, tp, st.Data.Instrument, snap.AvailableForTrading, s, snap.RiskBudget);
                    if (snap.CanOpenNewPosition && sizing.Accepted)
                    {
                        var fee = sizing.Quantity * fill * s.TakerFeeRate;
                        cash -= sizing.Quantity * fill + fee;
                        pos = new Position
                        {
                            Id = ++posId, Symbol = st.Symbol, StrategyId = strategy.Id, Mode = TradingMode.Paper,
                            Quantity = sizing.Quantity, EntryPrice = fill, EntryFee = fee, EntryTimeUtc = t,
                            StopLoss = stop, TakeProfit = tp, InitialRisk = sizing.NetRisk,
                        };
                        open.Add(pos);
                    }
                    else
                    {
                        rejected++;
                        if (rejections.Count < 20)
                            rejections.Add($"{t:yyyy-MM-dd HH:mm} {st.Symbol} : {(snap.CanOpenNewPosition ? sizing.RejectReason : string.Join(" ", snap.BlockingReasons))}");
                    }
                }

                if (pos is not null)
                {
                    if (bar.Open <= pos.StopLoss)
                        ClosePosition(pos, bar.Open * (1 - sellCost), t, "Stop-loss (gap)");
                    else if (bar.Low <= pos.StopLoss)
                        ClosePosition(pos, pos.StopLoss * (1 - sellCost), t, "Stop-loss");
                    else if (bar.High >= pos.TakeProfit)
                        ClosePosition(pos, pos.TakeProfit * (1 - sellCost), t, "Take-profit");
                }
            }

            // 2) Décision à la clôture de la bougie t (uniquement avec les données disponibles à cet instant)
            foreach (var st in states)
            {
                if (st.CurrentIndex < 0 || st.Data.EntryCandles[st.CurrentIndex].OpenTime != t) continue;
                var decisionTime = t + entryTf.ToTimeSpan();
                var pos = open.FirstOrDefault(p => p.Symbol == st.Symbol);
                if (pos is null && !inWindow) continue;

                var entryView = new PrefixView<Candle>(st.Data.EntryCandles, st.CurrentIndex + 1);
                var trendCount = st.ClosedTrendCount(decisionTime, trendTf);
                var trendView = new PrefixView<Candle>(st.Data.TrendCandles, trendCount);
                var eval = strategy.Evaluate(new StrategyContext(st.Symbol, entryView, trendView, pos, decisionTime));

                if (eval.Action == SignalAction.ExitLong && pos is not null) st.PendingExit = true;
                else if (eval.Action == SignalAction.EnterLong && pos is null && eval.StopDistance is { } sd)
                {
                    signals++;
                    st.PendingEntry = new PendingEntry(sd, eval.RewardRisk);
                }
            }

            // 3) Valeur du portefeuille à la clôture
            decimal mv = 0;
            foreach (var p in open) mv += p.Quantity * (LastClose(states, p.Symbol) ?? p.EntryPrice) * (1 - s.TakerFeeRate);
            if (inWindow)
            {
                equity.Add(new EquityPoint(t + entryTf.ToTimeSpan(), cash + mv));
                barsTotal++;
                if (open.Count > 0) barsInMarket++;
            }
        }

        // Clôture des positions restantes au dernier prix connu
        foreach (var p in open.ToList())
        {
            var last = LastClose(states, p.Symbol) ?? p.EntryPrice;
            ClosePosition(p, last * (1 - sellCost), timeline.LastOrDefault(), "Fin du backtest");
        }
        if (equity.Count > 0) equity[^1] = equity[^1] with { Equity = cash };

        return new BacktestResult(strategy.Id, strategy.Name,
            ComputeMetrics(s.InitialCapital, cash, trades, equity, signals, rejected, barsInMarket, barsTotal),
            trades, Downsample(equity, 1500), rejections);

        void ClosePosition(Position p, decimal price, DateTime time, string reason)
        {
            var fee = p.Quantity * price * s.TakerFeeRate;
            cash += p.Quantity * price - fee;
            p.ExitPrice = price; p.ExitFee = fee; p.ExitTimeUtc = time; p.ExitReason = reason; p.Status = PositionStatus.Closed;
            open.Remove(p);
            closed.Add(p);
            trades.Add(new BacktestTrade(p.Symbol, p.EntryTimeUtc, p.EntryPrice, time, price, p.Quantity,
                p.EntryFee + fee, p.RealizedPnl, p.RMultiple, reason));
        }
    }

    private static decimal? LastClose(List<MarketState> states, string symbol)
    {
        var st = states.FirstOrDefault(x => x.Symbol == symbol);
        return st is null || st.CurrentIndex < 0 ? null : st.Data.EntryCandles[st.CurrentIndex].Close;
    }

    public static BacktestMetrics ComputeMetrics(decimal initial, decimal final, IReadOnlyList<BacktestTrade> trades,
        IReadOnlyList<EquityPoint> equity, int signals, int rejected, int barsInMarket, int barsTotal)
    {
        var wins = trades.Where(t => t.Pnl > 0).ToList();
        var losses = trades.Where(t => t.Pnl <= 0).ToList();
        var grossWin = wins.Sum(t => t.Pnl);
        var grossLoss = -losses.Sum(t => t.Pnl);
        decimal peak = initial, maxDd = 0, maxDdPct = 0;
        foreach (var e in equity)
        {
            if (e.Equity > peak) peak = e.Equity;
            var dd = peak - e.Equity;
            if (dd > maxDd) maxDd = dd;
            if (peak > 0 && dd / peak > maxDdPct) maxDdPct = dd / peak;
        }
        return new BacktestMetrics(
            InitialCapital: initial,
            FinalEquity: final,
            NetProfit: final - initial,
            ReturnPct: initial == 0 ? 0 : (final - initial) / initial,
            Trades: trades.Count,
            Wins: wins.Count,
            Losses: losses.Count,
            WinRate: trades.Count == 0 ? 0 : (decimal)wins.Count / trades.Count,
            ProfitFactor: grossLoss == 0 ? (grossWin > 0 ? 999m : 0m) : grossWin / grossLoss,
            MaxDrawdown: maxDd,
            MaxDrawdownPct: maxDdPct,
            TotalFees: trades.Sum(t => t.Fees),
            AverageTrade: trades.Count == 0 ? 0 : trades.Average(t => t.Pnl),
            AverageR: trades.Count == 0 ? 0 : trades.Average(t => t.RMultiple),
            ExposurePct: barsTotal == 0 ? 0 : (decimal)barsInMarket / barsTotal,
            SignalsDetected: signals,
            SignalsRejectedByRisk: rejected,
            From: equity.FirstOrDefault()?.Time,
            To: equity.LastOrDefault()?.Time);
    }

    private static List<EquityPoint> Downsample(List<EquityPoint> points, int max)
    {
        if (points.Count <= max) return points;
        var step = (double)points.Count / max;
        var r = new List<EquityPoint>(max + 1);
        for (double i = 0; i < points.Count; i += step) r.Add(points[(int)i]);
        if (r[^1] != points[^1]) r.Add(points[^1]);
        return r;
    }

    private sealed record PendingEntry(decimal StopDistance, decimal RewardRisk);

    private sealed class MarketState
    {
        public MarketState(BacktestMarketData data) { Data = data; }
        public BacktestMarketData Data { get; }
        public string Symbol => Data.Instrument.Symbol;
        public int CurrentIndex { get; private set; } = -1;
        private int _trendCount;
        public PendingEntry? PendingEntry { get; set; }
        public bool PendingExit { get; set; }

        public bool TryAdvanceTo(DateTime t, out Candle bar)
        {
            var next = CurrentIndex + 1;
            if (next < Data.EntryCandles.Count && Data.EntryCandles[next].OpenTime == t)
            {
                CurrentIndex = next;
                bar = Data.EntryCandles[next];
                return true;
            }
            bar = null!;
            return false;
        }

        public int ClosedTrendCount(DateTime decisionTime, Timeframe tf)
        {
            while (_trendCount < Data.TrendCandles.Count && Data.TrendCandles[_trendCount].CloseTime(tf) <= decisionTime)
                _trendCount++;
            return _trendCount;
        }
    }
}
