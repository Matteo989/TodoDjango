using MNBot.Core.Backtesting;
using MNBot.Core.Domain;
using MNBot.Core.Indicators;
using MNBot.Core.Risk;
using MNBot.Core.Strategies;

namespace MNBot.Tests;

public class StrategyAndBacktestTests
{
    private static (List<Candle> H1, List<Candle> H4) Market(int hours = 4000, int seed = 7, double drift = 0.0003)
    {
        var h1 = TestData.RandomWalk(hours, drift: drift, seed: seed);
        return (h1, CandleTools.Aggregate(h1, Timeframe.H1, Timeframe.H4));
    }

    private static int ClosedTrendCount(List<Candle> h4, DateTime decision) => h4.Count(c => c.CloseTime(Timeframe.H4) <= decision);

    [Fact]
    public void Strategy_ReportsInsufficientHistory()
    {
        var (h1, h4) = Market(100);
        var e = new TrendPullbackStrategy().Evaluate(new StrategyContext("BTC/EUR", h1, h4, null, DateTime.UtcNow));
        Assert.Equal(SignalAction.None, e.Action);
        Assert.Contains("insuffisant", e.Reason);
    }

    [Fact]
    public void EntrySignals_SatisfyEveryRule_CheckedIndependently()
    {
        var (h1, h4) = Market();
        var p = new TrendPullbackParameters();
        var strategy = new TrendPullbackStrategy(p);
        var signals = 0;
        for (var i = 400; i < h1.Count; i++)
        {
            var decision = h1[i].CloseTime(Timeframe.H1);
            var entry = new PrefixView<Candle>(h1, i + 1);
            var trend = new PrefixView<Candle>(h4, ClosedTrendCount(h4, decision));
            var e = strategy.Evaluate(new StrategyContext("BTC/EUR", entry, trend, null, decision));
            if (e.Action != SignalAction.EnterLong) continue;
            signals++;

            Assert.All(e.Checks, c => Assert.True(c.Passed, c.Name));
            var ind = e.Indicators;
            Assert.True(ind["close4h"] > ind["ema200_4h"]);
            Assert.True(ind["ema20"] > ind["ema50"]);
            Assert.True(ind["rsi14"] > 50m);
            Assert.True(ind["close"] > ind["ema20"]);
            Assert.True(ind["volume"] >= ind["volumeAvg20"]);
            Assert.Equal(Math.Round(e.Price - 1.5m * ind["atr14"]!.Value, 10), Math.Round(e.StopLoss!.Value, 10));
            Assert.Equal(Math.Round(e.Price + 2m * (e.Price - e.StopLoss!.Value), 10), Math.Round(e.TakeProfit!.Value, 10));
        }
        Assert.True(signals > 0, "Aucun signal sur la série de test : le test ne vérifie rien.");
    }

    [Fact]
    public void NoBuySignal_InDowntrend()
    {
        var (h1, h4) = Market(3000, seed: 3, drift: -0.0008);
        var strategy = new TrendPullbackStrategy();
        for (var i = 2000; i < h1.Count; i += 3)
        {
            var decision = h1[i].CloseTime(Timeframe.H1);
            var trend = new PrefixView<Candle>(h4, ClosedTrendCount(h4, decision));
            var e = strategy.Evaluate(new StrategyContext("BTC/EUR", new PrefixView<Candle>(h1, i + 1), trend, null, decision));
            if (e.Action == SignalAction.EnterLong)
                Assert.True(e.Indicators["close4h"] > e.Indicators["ema200_4h"]); // jamais contre la tendance de fond
        }
    }

    [Fact]
    public void Evaluation_IsIdenticalWhetherOrNotFutureCandlesExist()
    {
        var (h1, h4) = Market();
        var strategy = new TrendPullbackStrategy();
        var i = 1500;
        var decision = h1[i].CloseTime(Timeframe.H1);
        var withFuture = strategy.Evaluate(new StrategyContext("BTC/EUR", new PrefixView<Candle>(h1, i + 1), new PrefixView<Candle>(h4, ClosedTrendCount(h4, decision)), null, decision));
        var exact = strategy.Evaluate(new StrategyContext("BTC/EUR", h1.Take(i + 1).ToList(), h4.Where(c => c.CloseTime(Timeframe.H4) <= decision).ToList(), null, decision));
        Assert.Equal(exact.Action, withFuture.Action);
        Assert.Equal(exact.Indicators["ema20"], withFuture.Indicators["ema20"]);
        Assert.Equal(exact.Indicators["ema200_4h"], withFuture.Indicators["ema200_4h"]);
    }

    [Fact]
    public void ExitSignal_WhenShortTermTrendBreaks()
    {
        var (h1, h4) = Market(3000, seed: 11);
        var strategy = new TrendPullbackStrategy();
        var position = new Position { Symbol = "BTC/EUR", Quantity = 0.001m, EntryPrice = 50000, StopLoss = 1, TakeProfit = 1_000_000 };
        for (var i = 1000; i < h1.Count; i++)
        {
            var decision = h1[i].CloseTime(Timeframe.H1);
            var e = strategy.Evaluate(new StrategyContext("BTC/EUR", new PrefixView<Candle>(h1, i + 1), new PrefixView<Candle>(h4, ClosedTrendCount(h4, decision)), position, decision));
            Assert.NotEqual(SignalAction.EnterLong, e.Action); // jamais de renforcement d'une position
            if (e.Action == SignalAction.ExitLong)
                Assert.True(e.Indicators["ema20"] < e.Indicators["ema50"] || e.Indicators["close4h"] < e.Indicators["ema200_4h"]);
        }
    }

    private static RiskSettings LooseRisk() => new()
    {
        // Frais nuls et seuils assouplis pour obtenir des transactions sur les données synthétiques
        TakerFeeRate = 0, SlippageRate = 0, MaxFeeShareOfReward = 1, MinNetRewardRisk = 0.5m, TimeZone = "UTC",
    };

    [Fact]
    public void Backtest_AccountingIsConsistent()
    {
        var (h1, h4) = Market(6000, seed: 21);
        var data = new BacktestMarketData { Instrument = TestData.Eth with { Symbol = "BTC/EUR", MinQuantity = 0.00001m }, EntryCandles = h1, TrendCandles = h4 };
        var r = new BacktestEngine().Run(new TrendPullbackStrategy(), new[] { data }, new BacktestOptions { Risk = LooseRisk(), SpreadPct = 0 });
        Assert.True(r.Trades.Count > 0, "aucune transaction");
        Assert.Equal(r.Metrics.InitialCapital + r.Trades.Sum(t => t.Pnl), r.Metrics.FinalEquity, 6);
        Assert.Equal(r.Trades.Count, r.Metrics.Wins + r.Metrics.Losses);
        // une seule position à la fois : les transactions ne se chevauchent pas
        var ordered = r.Trades.OrderBy(t => t.EntryTime).ToList();
        for (var i = 1; i < ordered.Count; i++) Assert.True(ordered[i].EntryTime >= ordered[i - 1].ExitTime);
        // la perte maximale d'une transaction stoppée reste proche du risque autorisé (pas de frais ici)
        Assert.All(r.Trades.Where(t => t.ExitReason == "Stop-loss"), t => Assert.True(t.Pnl >= -0.51m, $"perte {t.Pnl}"));
    }

    [Fact]
    public void Backtest_IsDeterministic()
    {
        var (h1, h4) = Market(3000, seed: 5);
        var data = new BacktestMarketData { Instrument = TestData.Eth with { Symbol = "BTC/EUR", MinQuantity = 0.00001m }, EntryCandles = h1, TrendCandles = h4 };
        var a = new BacktestEngine().Run(new TrendPullbackStrategy(), new[] { data }, new BacktestOptions { Risk = LooseRisk() });
        var b = new BacktestEngine().Run(new TrendPullbackStrategy(), new[] { data }, new BacktestOptions { Risk = LooseRisk() });
        Assert.Equal(a.Metrics, b.Metrics);
    }

    [Fact]
    public void Backtest_StopIsAssumedFirstWhenBothLevelsHitInSameCandle()
    {
        // Données construites : tendance montante régulière, puis une bougie qui touche à la fois stop et objectif.
        var strategy = new AlwaysBuyStrategy();
        var t0 = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var h1 = new List<Candle>
        {
            new(t0, 100, 101, 99, 100, 10),
            new(t0.AddHours(1), 100, 130, 70, 100, 10), // stop 90 et objectif 120 touchés
            new(t0.AddHours(2), 100, 101, 99, 100, 10),
        };
        var data = new BacktestMarketData { Instrument = TestData.Eth with { Symbol = "X/EUR", MinQuantity = 0.0001m, MinCost = 0 }, EntryCandles = h1, TrendCandles = Array.Empty<Candle>() };
        var r = new BacktestEngine().Run(strategy, new[] { data }, new BacktestOptions { Risk = LooseRisk(), SpreadPct = 0 });
        Assert.NotEmpty(r.Trades);
        Assert.Equal("Stop-loss", r.Trades[0].ExitReason);
        Assert.Equal(90m, r.Trades[0].ExitPrice);
    }

    [Fact]
    public void Backtest_EntersAtNextCandleOpen_NotAtSignalClose()
    {
        var strategy = new AlwaysBuyStrategy();
        var t0 = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var h1 = new List<Candle>
        {
            new(t0, 100, 101, 99, 100, 10),
            new(t0.AddHours(1), 104, 105, 103, 104, 10),
            new(t0.AddHours(2), 104, 105, 103, 104, 10),
        };
        var data = new BacktestMarketData { Instrument = TestData.Eth with { Symbol = "X/EUR", MinQuantity = 0.0001m, MinCost = 0 }, EntryCandles = h1, TrendCandles = Array.Empty<Candle>() };
        var r = new BacktestEngine().Run(strategy, new[] { data }, new BacktestOptions { Risk = LooseRisk(), SpreadPct = 0 });
        Assert.Equal(104m, r.Trades[0].EntryPrice);
        Assert.Equal(t0.AddHours(1), r.Trades[0].EntryTime);
    }

    /// <summary>Stratégie de test : achète dès qu'elle n'a pas de position (stop à 10, objectif à 20 au-dessus).</summary>
    private sealed class AlwaysBuyStrategy : IStrategy
    {
        public string Id => "always"; public string Name => "always"; public string Description => "";
        public Timeframe EntryTimeframe => Timeframe.H1; public Timeframe TrendTimeframe => Timeframe.H4;
        public int RequiredEntryCandles => 1; public int RequiredTrendCandles => 0; public object Parameters => new();
        public StrategyEvaluation Evaluate(StrategyContext ctx) => ctx.OpenPosition is null
            ? new StrategyEvaluation(SignalAction.EnterLong, ctx.EntryCandles[^1].Close, 10m, null, null, 2m, Array.Empty<SignalCheck>(), "test", new Dictionary<string, decimal?>())
            : new StrategyEvaluation(SignalAction.None, 0, null, null, null, 0, Array.Empty<SignalCheck>(), "", new Dictionary<string, decimal?>());
    }
}
